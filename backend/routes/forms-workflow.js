const { Router } = require('express');
const env = require('../config/env');
const { jotformFetch } = require('../lib/jotform');
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

    const cached = workflowCache[formId];
    if (cached && Date.now() - cached.at < CACHE_TTL) {
      res.setHeader('Cache-Control', 'private, max-age=60');
      return res.json({ formId, steps: cached.steps, cached: true });
    }

    if (!env.JOTFORM_API_KEY) {
      return res.json({ formId, steps: [], source: 'no-api-key' });
    }

    const qData = await jotformFetch(`form/${formId}/questions`);
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
      const propsData = await jotformFetch(`form/${formId}/properties`);
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

    workflowCache[formId] = { steps, at: Date.now() };
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({ formId, steps });
  } catch (err) { next(err); }
});

// ── GET /api/detect-approvers?formId=xxx ──
router.get('/detect-approvers', validate(formIdOptionalQuerySchema, 'query'), async (req, res, next) => {
  try {
    if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });

    const targetFormId = req.query.formId;
    let forms = [];
    if (targetFormId) {
      forms = [{ id: targetFormId }];
    } else {
      const formsData = await jotformFetch('user/forms', { params: { limit: '100', status: 'ENABLED' } });
      forms = (formsData.content || []).map(f => ({ id: String(f.id) }));
    }

    // JotForm has no batch endpoint for questions or submissions across forms,
    // so run per-form work with bounded concurrency. Within each form the two
    // independent fetches (questions + submissions) run in parallel.
    const perForm = await pMapLimit(forms, 5, async (form) => {
      const qData = await jotformFetch(`form/${form.id}/questions`);
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

    const subData = await jotformFetch(`submission/${submissionId}`, { params: { addWorkflowStatus: '1' } });
    const content = subData?.content || {};
    const workflowInstanceID = content?.workflowInstanceID || content?.workflow_instance_id;

    if (!workflowInstanceID) return res.json({ approvalUrl: null, formId, submissionId, reason: 'no workflow instance' });

    const instData = await jotformFetch(`workflow/instance/${workflowInstanceID}`);
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

    if (taskType === 'workflow_assign_form') {
      // Check prefill
      const prefillEnabled = String(element.prefillEnabled || '') === 'Yes';
      if (prefillEnabled && taskFormID) {
        try {
          const prefillData = await jotformFetch(`form/${taskFormID}/prefills`);
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

    res.json({ approvalUrl: null, formId, submissionId, reason: 'no accessLink or token available' });
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
