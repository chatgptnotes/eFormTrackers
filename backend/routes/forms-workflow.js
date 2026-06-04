const { Router } = require('express');
const env = require('../config/env');
const pool = require('../db/pool');
const { jotformFetch, resolveApiKey } = require('../lib/jotform');
const { readKeyType } = require('../lib/key-type');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { pMapLimit } = require('../lib/concurrency');
const {
  formIdRequiredQuerySchema,
  formIdOptionalQuerySchema,
  formAndSubmissionQuerySchema,
} = require('../schemas/forms');

const router = Router();

router.use(requireAuth);

const JOTFORM_INBOX = `${env.JOTFORM_HOST}/inbox`;

// ── GET /api/team-form-ids ──
// Returns the form IDs that belong to the Testing team (env.JOTFORM_TEAM_ID).
// Always uses the default key + teamID — independent of x-jotform-key-type
// header — so Production callers can subtract these from their enterprise
// list to get a pure Production-only view (excluding shared Testing forms).
const teamFormIdsCache = { ids: null, at: 0 };
const TEAM_FORM_IDS_TTL = 5 * 60 * 1000;

router.get('/team-form-ids', async (req, res, next) => {
  try {
    if (!env.JOTFORM_TEAM_ID) return res.json({ ids: [] });
    if (teamFormIdsCache.ids && Date.now() - teamFormIdsCache.at < TEAM_FORM_IDS_TTL) {
      res.setHeader('Cache-Control', 'private, max-age=60');
      return res.json({ ids: teamFormIdsCache.ids, cached: true });
    }
    // Force keyType='default' so teamID is appended and we get team-scoped forms.
    const data = await jotformFetch('user/forms', { params: { limit: 1000 }, keyType: 'default' });
    const ids = (data.content || []).map(f => String(f.id)).filter(Boolean);
    teamFormIdsCache.ids = ids;
    teamFormIdsCache.at = Date.now();
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({ ids });
  } catch (err) { next(err); }
});

// ── GET /api/active-form-ids ──
// Returns the form metadata (id + title + count) in scope for the active key.
// Testing: forms in the configured team (user/forms?teamID).
// Production: enterprise/forms MINUS the Testing team forms (pure separation).
// Frontend uses this to know which form_ids to query in jf_submissions —
// removing the need for the frontend to call /api/jotform directly.
const activeFormsCache = { default: null, gdmo: null };
const ACTIVE_FORMS_TTL = 5 * 60 * 1000;

router.get('/active-form-ids', async (req, res, next) => {
  try {
    // Serve from synced jf_forms table — no live JotForm API call needed.
    // Poller keeps jf_forms up to date every POLL_INTERVAL_MINUTES.
    const { rows } = await pool.query(
      `SELECT form_id AS id, title, status FROM jf_forms ORDER BY title`
    );
    const forms = rows.map(f => ({
      id: String(f.id),
      title: String(f.title || `Form ${f.id}`),
    }));
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({ keyType: 'default', forms });
  } catch (err) { next(err); }
});

// ── GET /api/form-workflow?formId=xxx ──
const workflowCache = {};
const CACHE_TTL = 60 * 60 * 1000;

function detectStepType(label) {
  const t = label.toLowerCase();
  if (/\b(task|todo|to-do|action item|procurement|finance|payment|processing|raise po|raise order)\b/.test(t))
    return 'task';
  if (/\b(fill|complete form|evaluation|evaluate|assessment|review form|submit form)\b/.test(t))
    return 'form';
  return 'approval';
}

router.get('/form-workflow', validate(formIdRequiredQuerySchema, 'query'), async (req, res, next) => {
  try {
    const formId = req.query.formId;
    const keyType = readKeyType(req);
    // Cache key includes keyType — same formId resolved against default vs gdmo
    // returns different shapes (different teams / scopes), so they must not collide.
    const cacheKey = `${keyType}:${formId}`;

    const cached = workflowCache[cacheKey];
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      res.setHeader('Cache-Control', 'private, max-age=60');
      return res.json({ formId, steps: cached.steps, cached: true });
    }

    if (!resolveApiKey(keyType)) {
      return res.json({ formId, steps: [], source: 'no-api-key' });
    }

    const qData = await jotformFetch(`form/${formId}/questions`, { keyType });
    const questions = qData.content || {};

    const candidates = [];
    for (const [qid, q] of Object.entries(questions)) {
      if (q.type !== 'control_dropdown' || !q.text) continue;
      const t = q.text.toLowerCase();
      if (/\b(level|approval|task|step|evaluation|finance|form completion|todo)\b/.test(t)) {
        candidates.push({ qid, text: q.text, order: parseInt(q.order || '999') });
      }
    }
    candidates.sort((a, b) => a.order - b.order);

    const steps = candidates.map((c, i) => ({
      level: i + 1, type: detectStepType(c.text), label: c.text, questionId: c.qid,
    }));

    // Try form properties for assignee emails
    try {
      const propsData = await jotformFetch(`form/${formId}/properties`, { keyType });
      const props = propsData.content || {};
      if (props.flow || props.approverEmails || props.conditions) {
        const flowData = props.flow || props.approverEmails || props.conditions;
        const flowStr = typeof flowData === 'string' ? flowData : JSON.stringify(flowData);
        const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const emails = flowStr.match(emailPattern) || [];
        for (let i = 0; i < Math.min(emails.length, steps.length); i++) {
          if (!steps[i].assigneeEmail) steps[i].assigneeEmail = emails[i];
        }
      }
      for (const [key, value] of Object.entries(props)) {
        if (typeof value !== 'string') continue;
        const lvlPropMatch = key.match(/(?:approver|assignee|evaluator)[_\s]*(\d+)/i);
        if (lvlPropMatch) {
          const lvl = parseInt(lvlPropMatch[1]);
          const step = steps.find(s => s.level === lvl);
          if (step && !step.assigneeEmail && value.includes('@')) step.assigneeEmail = value;
        }
      }
    } catch (e) {
      req.log.warn({ err: e, formId }, '[forms] form properties fetch failed');
    }

    workflowCache[cacheKey] = { steps, at: Date.now() };
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({ formId, steps });
  } catch (err) { next(err); }
});

// ── GET /api/detect-approvers?formId=xxx ──
router.get('/detect-approvers', validate(formIdOptionalQuerySchema, 'query'), async (req, res, next) => {
  try {
    const keyType = readKeyType(req);
    if (!resolveApiKey(keyType)) return res.status(500).json({ error: `JotForm API key for "${keyType}" not set` });

    const targetFormId = req.query.formId;
    let forms = [];
    if (targetFormId) {
      forms = [{ id: targetFormId }];
    } else {
      const formsData = await jotformFetch('user/forms', { params: { limit: '100', status: 'ENABLED' }, keyType });
      forms = (formsData.content || []).map(f => ({ id: String(f.id) }));
    }

    // JotForm has no batch endpoint for questions or submissions across forms,
    // so run per-form work with bounded concurrency. Within each form the two
    // independent fetches (questions + submissions) run in parallel.
    const perForm = await pMapLimit(forms, 5, async (form) => {
      const qData = await jotformFetch(`form/${form.id}/questions`, { keyType });
      const questions = qData.content || {};

      const approverFields = [];
      for (const [qid, q] of Object.entries(questions)) {
        const lbl = (q.text || q.name || '');
        const lvlMatch = lbl.match(/(?:^|\b)(?:l|level)\s*(\d+)\s*(?:approver|approved\s*by|reviewer)/i);
        if (lvlMatch) approverFields.push({ qid, level: parseInt(lvlMatch[1]) });
      }
      if (approverFields.length === 0) return [];

      const subData = await jotformFetch(`form/${form.id}/submissions`, {
        params: { limit: '100', orderby: 'created_at', direction: 'DESC' },
        keyType,
      });
      const submissions = subData.content || [];

      const approverCounts = {};
      for (const sub of submissions) {
        const answers = sub.answers || {};
        for (const af of approverFields) {
          const answer = answers[af.qid]?.answer;
          if (!answer || typeof answer !== 'string') continue;
          const match = answer.match(/By:\s*([^(|]+?)\s*\(([^)]+@[^)]+)\)/);
          let name, email;
          if (match) { name = match[1].trim(); email = match[2].trim(); }
          else {
            const nameOnly = answer.match(/By:\s*([^(|]+?)(?:\s*\||$)/);
            if (nameOnly) { name = nameOnly[1].trim(); email = ''; }
            else continue;
          }
          if (!name) continue;
          const key = `${form.id}:${af.level}:${email || name}`;
          if (!approverCounts[key]) approverCounts[key] = { name, email: email || '', count: 0 };
          approverCounts[key].count++;
        }
      }

      const out = [];
      for (const af of approverFields) {
        const candidates = Object.entries(approverCounts)
          .filter(([k]) => k.startsWith(`${form.id}:${af.level}:`))
          .map(([, v]) => v)
          .sort((a, b) => b.count - a.count);
        if (candidates.length > 0) {
          out.push({
            formId: form.id, level: af.level,
            approverName: candidates[0].name, approverEmail: candidates[0].email,
            count: candidates[0].count,
          });
        }
      }
      return out;
    });

    const detectedApprovers = perForm.flat();
    res.json({ detectedApprovers });
  } catch (err) { next(err); }
});

// ── GET /api/email-url?formId=xxx&submissionId=yyy ──
router.get('/email-url', validate(formAndSubmissionQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { formId, submissionId } = req.query;
    const keyType = readKeyType(req);

    const subData = await jotformFetch(`submission/${submissionId}`, { params: { addWorkflowStatus: '1' }, keyType });
    const content = subData?.content || {};
    const workflowInstanceID = content?.workflowInstanceID || content?.workflow_instance_id;

    if (!workflowInstanceID) return res.json({ approvalUrl: null, formId, submissionId, reason: 'no workflow instance' });

    const instData = await jotformFetch(`workflow/instance/${workflowInstanceID}`, { keyType });
    const taskList = instData?.content?.taskList || [];
    const activeTask = taskList.find(t => String(t.status).toUpperCase() === 'ACTIVE');

    if (!activeTask) return res.json({ approvalUrl: null, formId, submissionId, reason: 'no active task' });

    const element = activeTask.element || {};
    const props = activeTask.properties || {};
    const taskFormID = element.internalFormID || element.resourceID || element.formID || props.formID;
    const taskId = String(activeTask.id || '');
    const accessLink = String(activeTask.accessLink || props.accessLink || element.accessLink || '');
    const shareMatch = accessLink.match(/\/share\/(.+)$/);
    const accessToken = shareMatch ? shareMatch[1] : '';
    const taskType = String(element.type || '');

    if (taskType === 'workflow_assign_task' && taskId) {
      const deeplink = `jotform://workflow/${submissionId}/${formId}/${taskId}`;
      return res.json({
        approvalUrl: `${env.JOTFORM_HOST}/deeplink?deeplink=${encodeURIComponent(deeplink)}`,
        formId, submissionId, source: 'workflow-task-deeplink',
      });
    }

    if (taskType === 'workflow_assign_form') {
      // Check prefill
      const prefillEnabled = String(element.prefillEnabled || '') === 'Yes';
      if (prefillEnabled && taskFormID) {
        try {
          const prefillData = await jotformFetch(`form/${taskFormID}/prefills`, { keyType });
          const prefills = prefillData?.content || [];
          for (const p of prefills) {
            const urls = p.urls || [];
            const match = urls.find(u => u.settings?.id === submissionId);
            if (match) {
              return res.json({
                approvalUrl: `${env.JOTFORM_HOST}/${taskFormID}/prefill/${match.id}?workflowAssignFormTask=1&taskID=${taskId}`,
                formId, submissionId, source: 'prefill-api',
              });
            }
          }
        } catch (e) {
          req.log.warn({ err: e, formId, submissionId }, '[forms] prefill API fetch failed');
        }
      }
      return res.json({
        approvalUrl: `${env.JOTFORM_HOST}/${taskFormID}?workflowAssignFormTask=1&taskID=${taskId}`,
        formId, submissionId, source: 'constructed-form',
      });
    }

    // Approval / assigned-task types
    if (accessLink) return res.json({ approvalUrl: accessLink, formId, submissionId, source: 'accessLink' });
    if (taskFormID && taskId && accessToken) {
      return res.json({
        approvalUrl: `${env.JOTFORM_HOST}/approval-form/${taskFormID}/task/${taskId}/access-token/${encodeURIComponent(accessToken)}`,
        formId, submissionId, source: 'constructed-path',
      });
    }

    // JotForm doesn't expose the per-task access token via any API — the
    // /share/{token} link is sent only in the assignment EMAIL. Without it we
    // can't construct an /approval-form/... URL, but the assignee can still
    // open the submission's JotForm inbox page and act on the task natively
    // (it uses their JotForm session). This matches submission.taskUrl in the
    // mapper and the DirectorDashboard "View Task" button.
    res.json({
      approvalUrl: `${env.JOTFORM_HOST}/inbox/${formId}/${submissionId}`,
      formId, submissionId, source: 'inbox-fallback',
      note: 'JotForm did not expose an access token for this task type; opening the submission in the JotForm inbox where the assignee can act on it.',
    });
  } catch (err) {
    res.json({ approvalUrl: null, formId: req.query.formId, submissionId: req.query.submissionId, error: String(err) });
  }
});

// ── GET /api/form-url?formId=xxx&submissionId=yyy ──
router.get('/form-url', validate(formAndSubmissionQuerySchema, 'query'), (req, res) => {
  const { formId, submissionId } = req.query;
  res.json({ formUrl: `${JOTFORM_INBOX}/${formId}/${submissionId}`, formId, submissionId, source: 'inbox' });
});

// ── GET /api/task-url?formId=xxx&submissionId=yyy ──
router.get('/task-url', validate(formAndSubmissionQuerySchema, 'query'), (req, res) => {
  const { formId, submissionId } = req.query;
  res.json({ taskUrl: `${JOTFORM_INBOX}/${formId}/${submissionId}`, formId, submissionId, source: 'inbox' });
});

module.exports = router;
