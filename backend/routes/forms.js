const { Router } = require('express');
const env = require('../config/env');
const { jotformFetch } = require('../lib/jotform');
const { detectLevelFields } = require('../lib/detect-fields');
const { requireAuth } = require('../middleware/auth');

const router = Router();

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

router.get('/form-workflow', requireAuth, async (req, res, next) => {
  try {
    const formId = req.query.formId;
    if (!formId) return res.status(400).json({ error: 'formId required' });

    const cached = workflowCache[formId];
    if (cached && Date.now() - cached.at < CACHE_TTL) {
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
    } catch (_) { /* non-critical */ }

    workflowCache[formId] = { steps, at: Date.now() };
    res.json({ formId, steps });
  } catch (err) { next(err); }
});

// ── POST /api/ensure-fields?formId=xxx ──
router.post('/ensure-fields', requireAuth, async (req, res, next) => {
  try {
    if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });
    const formId = req.query.formId;
    if (!formId) return res.status(400).json({ error: 'formId required' });

    const qData = await jotformFetch(`form/${formId}/questions`);
    const questions = qData.content || {};

    const existing = {};
    let overallStatusFieldId = null;
    let detectedLevelCount = 0;

    for (const [qid, q] of Object.entries(questions)) {
      const lbl = (q.text || q.name || '').toLowerCase();
      const lvlMatch = lbl.match(/(?:^|\b)(?:l|level)\s*(\d+)(?:\b|$)/);
      if (lvlMatch) {
        const lvl = parseInt(lvlMatch[1]);
        if (!existing[lvl]) existing[lvl] = {};
        if ((lbl.includes('evaluator') && lbl.includes('email')) || (lbl.includes('approver') && lbl.includes('email'))) {
          if (!existing[lvl].e) existing[lvl].e = qid;
        } else if (lbl.includes('status') || lbl.includes('decision') || lbl.includes('approval')) {
          if (!existing[lvl].s) existing[lvl].s = qid;
        } else if (lbl.includes('approver') || lbl.includes('approved by')) {
          if (!existing[lvl].a) existing[lvl].a = qid;
        } else if (lbl.includes('date') || lbl.includes('time')) {
          if (!existing[lvl].d) existing[lvl].d = qid;
        }
        if (lvl > detectedLevelCount) detectedLevelCount = lvl;
      }
      if (q.type === 'control_dropdown' && lbl.match(/\b(level|approval|task|step|evaluation)\b/)) {
        const stepLvlMatch = lbl.match(/(?:level|l)\s*(\d+)/);
        if (stepLvlMatch) {
          const lvl = parseInt(stepLvlMatch[1]);
          if (lvl > detectedLevelCount) detectedLevelCount = lvl;
        }
      }
      const hasLevel = /(?:^|\s)(?:l|level|stage)\s*\d+(?:\s|$)/.test(lbl);
      if (!hasLevel && (lbl === 'status' || lbl === 'overall status' || lbl === 'final status' || lbl === 'approval status' || (lbl.includes('overall') && lbl.includes('status')))) {
        overallStatusFieldId = qid;
      }
    }

    const numLevels = detectedLevelCount || 1;
    let allExist = !!overallStatusFieldId;
    for (let lvl = 1; lvl <= numLevels; lvl++) {
      if (!existing[lvl]?.s || !existing[lvl]?.e) { allExist = false; break; }
    }

    if (allExist) {
      const fields = [];
      for (let lvl = 1; lvl <= numLevels; lvl++) {
        fields.push({
          level: lvl, statusFieldId: existing[lvl].s,
          approverFieldId: existing[lvl].a || '', dateFieldId: existing[lvl].d || '',
          evaluatorEmailFieldId: existing[lvl].e || '',
        });
      }
      return res.json({ fields, overallStatusFieldId, created: false });
    }

    // Create missing fields
    const questionsToAdd = {};
    let idx = 0;
    for (let lvl = 1; lvl <= numLevels; lvl++) {
      if (!existing[lvl]?.s) { questionsToAdd[idx] = { type: 'control_textbox', text: `L${lvl} Status`, name: `l${lvl}Status`, hidden: 'Yes', order: String(900 + lvl * 10) }; idx++; }
      if (!existing[lvl]?.a) { questionsToAdd[idx] = { type: 'control_textbox', text: `L${lvl} Approver`, name: `l${lvl}Approver`, hidden: 'Yes', order: String(901 + lvl * 10) }; idx++; }
      if (!existing[lvl]?.d) { questionsToAdd[idx] = { type: 'control_textbox', text: `L${lvl} Date`, name: `l${lvl}Date`, hidden: 'Yes', order: String(902 + lvl * 10) }; idx++; }
      if (!existing[lvl]?.e) { questionsToAdd[idx] = { type: 'control_textbox', text: `L${lvl} Evaluator Email`, name: `l${lvl}EvaluatorEmail`, hidden: 'Yes', order: String(903 + lvl * 10) }; idx++; }
    }
    if (!overallStatusFieldId) { questionsToAdd[idx] = { type: 'control_textbox', text: 'Overall Status', name: 'overallStatus', hidden: 'Yes', order: '999' }; idx++; }

    const params = new URLSearchParams();
    for (const [i, q] of Object.entries(questionsToAdd)) {
      for (const [key, val] of Object.entries(q)) {
        params.append(`questions[${i}][${key}]`, val);
      }
    }

    const teamParam = env.JOTFORM_TEAM_ID ? `?teamID=${env.JOTFORM_TEAM_ID}` : '';
    const createUrl = `${env.JOTFORM_BASE}/form/${formId}/questions${teamParam}`;
    const createRes = await fetch(createUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'APIKEY': env.JOTFORM_API_KEY },
      body: params.toString(),
    });
    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      return res.status(500).json({ error: `Failed to create fields: ${createRes.status}`, detail: errData });
    }
    const createData = await createRes.json();

    // Re-fetch to get new field IDs
    const q2Data = await jotformFetch(`form/${formId}/questions`);
    const updatedQ = q2Data.content || {};
    const finalFields = {};
    let finalOverall = null;

    for (const [qid, q] of Object.entries(updatedQ)) {
      const lbl = (q.text || q.name || '').toLowerCase();
      const lvlMatch = lbl.match(/(?:^|\b)(?:l|level)\s*(\d+)(?:\b|$)/);
      if (lvlMatch) {
        const lvl = parseInt(lvlMatch[1]);
        if (!finalFields[lvl]) finalFields[lvl] = {};
        if ((lbl.includes('evaluator') && lbl.includes('email')) || (lbl.includes('approver') && lbl.includes('email'))) {
          if (!finalFields[lvl].e) finalFields[lvl].e = qid;
        } else if (lbl.includes('status')) { if (!finalFields[lvl].s) finalFields[lvl].s = qid; }
        else if (lbl.includes('approver')) { if (!finalFields[lvl].a) finalFields[lvl].a = qid; }
        else if (lbl.includes('date')) { if (!finalFields[lvl].d) finalFields[lvl].d = qid; }
      }
      const hasLevel = /(?:^|\s)(?:l|level|stage)\s*\d+(?:\s|$)/.test(lbl);
      if (!hasLevel && (lbl === 'overall status' || lbl === 'status' || lbl === 'final status')) finalOverall = qid;
    }

    const fields = [];
    for (let lvl = 1; lvl <= numLevels; lvl++) {
      fields.push({
        level: lvl, statusFieldId: finalFields[lvl]?.s || '',
        approverFieldId: finalFields[lvl]?.a || '', dateFieldId: finalFields[lvl]?.d || '',
        evaluatorEmailFieldId: finalFields[lvl]?.e || '',
      });
    }

    res.json({ fields, overallStatusFieldId: finalOverall, created: true, createResponse: createData });
  } catch (err) { next(err); }
});

// ── GET /api/detect-approvers?formId=xxx ──
router.get('/detect-approvers', requireAuth, async (req, res, next) => {
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

    const detectedApprovers = [];

    for (const form of forms) {
      const qData = await jotformFetch(`form/${form.id}/questions`);
      const questions = qData.content || {};

      const approverFields = [];
      for (const [qid, q] of Object.entries(questions)) {
        const lbl = (q.text || q.name || '');
        const lvlMatch = lbl.match(/(?:^|\b)(?:l|level)\s*(\d+)\s*(?:approver|approved\s*by|reviewer)/i);
        if (lvlMatch) approverFields.push({ qid, level: parseInt(lvlMatch[1]) });
      }
      if (approverFields.length === 0) continue;

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

      for (const af of approverFields) {
        const candidates = Object.entries(approverCounts)
          .filter(([k]) => k.startsWith(`${form.id}:${af.level}:`))
          .map(([, v]) => v)
          .sort((a, b) => b.count - a.count);
        if (candidates.length > 0) {
          detectedApprovers.push({
            formId: form.id, level: af.level,
            approverName: candidates[0].name, approverEmail: candidates[0].email,
            count: candidates[0].count,
          });
        }
      }
    }

    res.json({ detectedApprovers });
  } catch (err) { next(err); }
});

// ── POST /api/register-webhooks ──
router.post('/register-webhooks', requireAuth, async (req, res, next) => {
  try {
    if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });

    const formsData = await jotformFetch('user/forms', { params: { limit: '200', orderby: 'updated_at' } });
    const allForms = (formsData.content || []);
    const formIds = allForms.filter(f => f.status === 'ENABLED').map(f => f.id);

    if (formIds.length === 0) return res.json({ webhookURL: '', total: 0, success: 0, errors: 0, results: [] });

    const proto = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    const secretParam = env.JOTFORM_WEBHOOK_SECRET ? `?secret=${env.JOTFORM_WEBHOOK_SECRET}` : '';
    const webhookURL = `${proto}://${host}/api/webhook${secretParam}`;

    const results = [];
    for (const formId of formIds) {
      try {
        const params = new URLSearchParams();
        params.set('webhookURL', webhookURL);
        const teamParam = env.JOTFORM_TEAM_ID ? `?teamID=${env.JOTFORM_TEAM_ID}` : '';
        const url = `${env.JOTFORM_BASE}/form/${formId}/webhooks${teamParam}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'APIKEY': env.JOTFORM_API_KEY },
          body: params.toString(),
        });
        results.push({ formId, status: response.ok ? 'ok' : 'error', detail: response.ok ? undefined : `HTTP ${response.status}` });
      } catch (err) {
        results.push({ formId, status: 'error', detail: String(err) });
      }
    }

    res.json({
      webhookURL, total: formIds.length,
      success: results.filter(r => r.status === 'ok').length,
      errors: results.filter(r => r.status === 'error').length,
      results,
    });
  } catch (err) { next(err); }
});

// ── GET /api/email-url?formId=xxx&submissionId=yyy ──
router.get('/email-url', requireAuth, async (req, res, next) => {
  try {
    const { formId, submissionId } = req.query;
    if (!formId || !submissionId) return res.status(400).json({ error: 'formId and submissionId required' });

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
        } catch (_) { /* fallback */ }
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
router.get('/form-url', requireAuth, (req, res) => {
  const { formId, submissionId } = req.query;
  if (!formId || !submissionId) return res.status(400).json({ error: 'formId and submissionId required' });
  res.json({ formUrl: `${JOTFORM_INBOX}/${formId}/${submissionId}`, formId, submissionId, source: 'inbox' });
});

// ── GET /api/task-url?formId=xxx&submissionId=yyy ──
router.get('/task-url', requireAuth, (req, res) => {
  const { formId, submissionId } = req.query;
  if (!formId || !submissionId) return res.status(400).json({ error: 'formId and submissionId required' });
  res.json({ taskUrl: `${JOTFORM_INBOX}/${formId}/${submissionId}`, formId, submissionId, source: 'inbox' });
});

module.exports = router;
