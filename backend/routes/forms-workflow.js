const { Router } = require('express');
const env = require('../config/env');
const pool = require('../db/pool');
const { jotformFetch, resolveApiKey } = require('../lib/jotform');
const { readKeyType } = require('../lib/key-type');
const { validate } = require('../middleware/validate');
const { requireAuth } = require('../middleware/auth');
const { extractTask } = require('../lib/workflow-task');
const { pMapLimit } = require('../lib/concurrency');
const {
  formIdRequiredQuerySchema,
  formIdOptionalQuerySchema,
  formAndSubmissionQuerySchema,
} = require('../schemas/forms');

const router = Router();

router.use(requireAuth);

const JOTFORM_INBOX = `${env.JOTFORM_HOST}/inbox`;

// ── Email token link resolution ──
// JotForm only sends the /share/{token} access link in the assignment email.
// These helpers fetch the recent email event log, find the email for the
// given submission addressed to the logged-in user, and extract the action URL.

const emailTokenCache = new Map(); // `${userEmail}:${submissionId}` → { link, at }
const EMAIL_TOKEN_TTL = 15 * 60 * 1000;

function extractEmailLinks(html) {
  if (!html) return [];
  const results = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (url.startsWith('http')) results.push({ url, text });
  }
  return results;
}

async function resolveEmailTokenLink(submissionId, formId, userEmail) {
  const logsData = await jotformFetch('enterprise/system-logs', {
    params: { 'event[0]': 'email', limit: 50, sortWay: 'DESC' },
    keyType: 'gdmo',
    timeoutMs: 15000,
  });
  const entries = Array.isArray(logsData.content) ? logsData.content
    : Array.isArray(logsData.data) ? logsData.data
    : Array.isArray(logsData) ? logsData : [];

  // Find log entries whose raw JSON mentions this submission or form ID
  const candidates = entries.filter(e => {
    const s = JSON.stringify(e).toLowerCase();
    return s.includes(String(submissionId).toLowerCase()) ||
           (formId && s.includes(String(formId).toLowerCase()));
  });

  for (const entry of candidates.slice(0, 5)) {
    const emailId = String(
      entry.emailId || entry.email_id || entry.emailID || entry.id || entry.resource_id || ''
    );
    if (!emailId) continue;

    const emailData = await jotformFetch(`emailq/${emailId}`, { keyType: 'gdmo', timeoutMs: 10000 });
    const c = emailData.content || emailData;

    // Verify this email was sent to the requesting user
    const toRaw = c.to || c.recipient || c.email || c.recipientEmail || '';
    const toAddr = String(Array.isArray(toRaw) ? toRaw.join(',') : toRaw).toLowerCase();
    if (!toAddr.includes(userEmail)) continue;

    // Extract links from the email body; prefer task/form/share URLs
    const body = c.body || c.html || c.message || '';
    const links = extractEmailLinks(body);

    const preferred = links.find(l => {
      const u = l.url.toLowerCase();
      const t = l.text.toLowerCase();
      return u.includes('/share/') || u.includes('/approval-form/')
        || t.includes('fill') || t.includes('complete') || t.includes('open task')
        || t.includes('view task') || t.includes('start');
    }) || links.find(l => {
      const u = l.url.toLowerCase();
      return u.includes(env.JOTFORM_HOST && env.JOTFORM_HOST.replace(/^https?:\/\//, ''))
        || u.includes('jotform');
    });

    if (preferred) return preferred.url;
  }
  return null;
}

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
    const keyType = 'default';
    const inboxUrl = `${env.JOTFORM_HOST}/inbox/${formId}/${submissionId}`;

    // Step 1: Read active task from DB (workflow_tasks JSONB) — no API call needed.
    // JotForm never exposes the /share/{token} access link via API (only via email),
    // so the best we can do is the inbox link when accessLink is empty.
    const { rows: subRows } = await pool.query(
      `SELECT workflow_tasks,
              COALESCE(raw_data->>'workflowInstanceID', raw_data->>'workflow_instance_id') AS wid
       FROM jf_submissions WHERE jotform_submission_id = $1`,
      [submissionId]
    );

    const myEmail = (req.session.email || '').toLowerCase();
    const dbTasks = Array.isArray(subRows[0]?.workflow_tasks) ? subRows[0].workflow_tasks : [];
    const activeDbTasks = dbTasks.filter(t => String(t.status).toUpperCase() === 'ACTIVE');
    // Prefer the task assigned to THIS user (parallel steps have several
    // ACTIVE tasks). A personal /share/{token} link must only ever go to its
    // own assignee — for everyone else the inbox is the right destination.
    const myDbTask = activeDbTasks.find(t => String(t.assigneeEmail || '').toLowerCase() === myEmail);
    const activeDbTask = myDbTask || activeDbTasks[0];

    // Shared email-token lookup (cached). The /share/{token} URL for any user
    // other than the API key's own account exists ONLY in the email JotForm
    // sent them — the workflow API returns an empty accessLink for everyone else.
    const lookupEmailLink = async () => {
      const userEmail = (req.session.email || '').toLowerCase();
      if (!userEmail) return null;
      const cacheKey = `${userEmail}:${submissionId}`;
      const cached = emailTokenCache.get(cacheKey);
      if (cached && Date.now() - cached.at < EMAIL_TOKEN_TTL) return cached.link || null;
      try {
        const link = await resolveEmailTokenLink(submissionId, formId, userEmail);
        emailTokenCache.set(cacheKey, { link, at: Date.now() });
        return link;
      } catch (emailErr) {
        req.log?.warn({ err: emailErr, submissionId }, '[email-url] email token lookup failed');
        return null;
      }
    };

    if (myDbTask) {
      // Use access link from DB if present
      if (myDbTask.accessLink) {
        return res.json({ approvalUrl: myDbTask.accessLink, formId, submissionId, source: 'db-access-link' });
      }
      // No stored link — try the user's own assignment email for the token link
      const emailLink = await lookupEmailLink();
      if (emailLink) {
        return res.json({ approvalUrl: emailLink, formId, submissionId, source: 'email-token' });
      }
      // For assign-form tasks: construct form URL from stored internalFormID
      if (myDbTask.type === 'workflow_assign_form' && myDbTask.internalFormID) {
        const taskId = myDbTask.taskId || '';
        return res.json({
          approvalUrl: `${env.JOTFORM_HOST}/${myDbTask.internalFormID}?workflowAssignFormTask=1&taskID=${taskId}`,
          formId, submissionId, source: 'db-form-url',
        });
      }
      // All other task types (workflow_assign_task, workflow_approval): inbox
      return res.json({ approvalUrl: inboxUrl, formId, submissionId, source: 'inbox-active-task' });
    }

    if (activeDbTask) {
      // The active step is pending with someone else — never hand out their
      // personal token link. The inbox shows the submission read-only.
      return res.json({ approvalUrl: inboxUrl, formId, submissionId, source: 'inbox-not-assignee' });
    }

    // Step 2: DB has no active task — try live JotForm API for fresher data.
    try {
      const workflowInstanceID = subRows[0]?.wid;
      if (workflowInstanceID) {
        const instData = await jotformFetch(`workflow/instance/${workflowInstanceID}`, { keyType });
        const taskList = instData?.content?.taskList || [];
        // Same user-scoping as the DB path: only this user's own active task
        // may yield a personal link.
        const activeTask = taskList.find(t =>
          String(t.status).toUpperCase() === 'ACTIVE' &&
          String(extractTask(t).assigneeEmail).toLowerCase() === myEmail
        );

        if (activeTask) {
          const element = activeTask.element || {};
          const props = activeTask.properties || {};
          const taskFormID = element.internalFormID || element.resourceID || element.formID || props.formID;
          const taskId = String(activeTask.id || '');
          const accessLink = String(activeTask.accessLink || props.accessLink || element.accessLink || '');
          const taskType = String(element.type || '');

          if (accessLink) return res.json({ approvalUrl: accessLink, formId, submissionId, source: 'api-access-link' });
          if (taskType === 'workflow_assign_form' && taskFormID) {
            return res.json({
              approvalUrl: `${env.JOTFORM_HOST}/${taskFormID}?workflowAssignFormTask=1&taskID=${taskId}`,
              formId, submissionId, source: 'api-form-url',
            });
          }
        }
      }
    } catch (apiErr) {
      req.log.warn({ err: apiErr, submissionId }, '[email-url] JotForm API lookup failed, using inbox');
    }

    // Step 3: try to get the original token link from the JotForm assignment email.
    // The /share/{token} URL is only in the email body — fetch it from emailq.
    const emailLink = await lookupEmailLink();
    if (emailLink) {
      return res.json({ approvalUrl: emailLink, formId, submissionId, source: 'email-token' });
    }

    res.json({
      approvalUrl: `${env.JOTFORM_HOST}/inbox/${formId}/${submissionId}`,
      formId, submissionId, source: 'inbox-fallback',
    });
  } catch (err) {
    // Never block the user — always return inbox as last resort.
    const fId = req.query.formId;
    const sId = req.query.submissionId;
    req.log?.warn({ err }, '[email-url] unexpected error, falling back to inbox');
    res.json({ approvalUrl: `${env.JOTFORM_HOST}/inbox/${fId}/${sId}`, formId: fId, submissionId: sId, source: 'inbox-error-fallback' });
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
