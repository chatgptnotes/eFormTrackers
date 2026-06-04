const { Router } = require('express');
const pool = require('../db/pool');
const env = require('../config/env');
const { jotformFetch, resolveApiKey } = require('../lib/jotform');
const { readKeyType } = require('../lib/key-type');
const { detectLevelFields } = require('../lib/detect-fields');
const { insertNotification } = require('../lib/notifications');
const { extractTask, deriveWorkflowStatus } = require('../lib/workflow-task');
const { upsertEmailLogs } = require('../lib/email-log');
const { requireAuth } = require('../middleware/auth');
const { webhookLimiter } = require('../middleware/rateLimit');
const { emitToAll } = require('../lib/realtime');

const router = Router();

// ── Whitelisted query params for JotForm proxy ──
const ALLOWED_PARAMS = new Set(['limit', 'offset', 'orderby', 'direction', 'filter', 'id', 'addWorkflowStatus']);

// C-3: Strict allowlist — prevents authenticated users from proxying arbitrary JotForm endpoints
// using the production GDMO API key. Only paths the frontend genuinely needs are permitted.
const ALLOWED_PROXY_PATHS = new Set([
  'user/forms',
  'enterprise/forms',
  'user/labels',
  'enterprise/labels',
]);

// ── GET /api/jotform?path=user/forms ──
// Proxies JotForm reads using server-side API key — auth required.
router.get('/jotform', requireAuth, async (req, res, next) => {
  try {
    const keyType = readKeyType(req);
    if (!resolveApiKey(keyType)) {
      return res.status(500).json({ error: `JotForm API key for "${keyType}" not set` });
    }
    const apiPath = req.query.path || 'user/forms';
    if (!ALLOWED_PROXY_PATHS.has(apiPath)) {
      return res.status(400).json({ error: 'Proxy path not allowed' });
    }
    const params = {};
    for (const [key, val] of Object.entries(req.query)) {
      if (key !== 'path' && ALLOWED_PARAMS.has(key) && typeof val === 'string') {
        params[key] = val;
      }
    }
    const data = await jotformFetch(apiPath, { params, keyType });
    res.json(data);
  } catch (err) {
    if (err.status && err.data) return res.status(err.status).json(err.data);
    next(err);
  }
});

// ── POST /api/webhook ──
// JotForm webhook handler — processes a submission and upserts to DB
const fieldCache = {};
const FIELD_CACHE_TTL = 60 * 60 * 1000;

// Parse email from JotFlow action text: "Action: Approved | By: Name (email@domain.com) | ..."
function parseEmailFromActionText(text) {
  if (!text || typeof text !== 'string') return '';
  const m = text.match(/By:\s*[^(]*\(([^)]+@[^)]+)\)/);
  return m ? m[1].trim() : '';
}

function extractText(answer) {
  if (!answer) return '';
  if (typeof answer === 'string') return answer;
  if (typeof answer === 'number') return String(answer);
  if (Array.isArray(answer)) return answer.filter(Boolean).join(', ');
  if (typeof answer === 'object') {
    if (answer.first !== undefined || answer.last !== undefined)
      return [answer.first, answer.last].filter(Boolean).join(' ');
    if (answer.year && answer.month && answer.day)
      return `${answer.year}-${String(answer.month).padStart(2, '0')}-${String(answer.day).padStart(2, '0')}`;
    return Object.values(answer).filter(v => v && typeof v === 'string').join(' ');
  }
  return '';
}

async function getFieldsForForm(formId, keyType) {
  // Key by keyType too — the same formId can resolve to different fields under
  // the default vs gdmo key bucket (different tenants), so caches must not collide.
  const cacheKey = `${keyType || 'default'}:${formId}`;
  const cached = fieldCache[cacheKey];
  if (cached && Date.now() - cached.at < FIELD_CACHE_TTL) return cached.fields;

  const data = await jotformFetch(`form/${formId}/questions`, { keyType });
  const fields = detectLevelFields(data.content || {});
  fieldCache[cacheKey] = { fields, at: Date.now() };
  return fields;
}

router.post('/webhook', webhookLimiter, async (req, res, next) => {
  try {
    // Webhook secret is REQUIRED in production. Previously, an empty
    // JOTFORM_WEBHOOK_SECRET silently disabled verification → anyone on the
    // internet could POST forged submissions to /api/webhook and pollute the DB.
    if (!env.JOTFORM_WEBHOOK_SECRET) {
      if (env.NODE_ENV === 'production') {
        return res.status(503).json({ error: 'Webhook secret not configured' });
      }
      req.log.warn('[webhook] JOTFORM_WEBHOOK_SECRET unset — accepting in non-production only');
    } else if (req.query.secret !== env.JOTFORM_WEBHOOK_SECRET) {
      return res.status(403).json({ error: 'Invalid webhook secret' });
    }
    // Webhooks carry no key-type header; default (gdmo) is the only live key.
    const keyType = readKeyType(req);
    if (!resolveApiKey(keyType)) {
      return res.status(500).json({ error: `JotForm API key for "${keyType}" not set` });
    }

    let submissionId, formId;
    if (req.body) {
      const body = typeof req.body === 'string'
        ? Object.fromEntries(new URLSearchParams(req.body))
        : req.body;
      submissionId = body.submissionID || body.submissionId;
      formId = body.formID || body.formId;
    }

    if (!submissionId) {
      return res.json({ ok: true, action: 'no-submission-id' });
    }

    // Fetch submission from JotForm
    const jfData = await jotformFetch(`submission/${submissionId}`, {
      params: { addWorkflowStatus: '1' },
      keyType,
    });
    const raw = jfData.content;
    if (!raw) throw new Error('No content in JotForm response');

    if (!formId) formId = String(raw.form_id || '');
    if (!formId) throw new Error('No formId found');

    const answers = raw.answers || {};
    const get = (id) => id ? extractText(answers[id]?.answer) : '';

    const detected = await getFieldsForForm(formId, keyType);

    const levels = detected.levelFields.map(lf => ({
      id: lf.level,
      status: get(lf.statusFieldId),
      approver: get(lf.approverFieldId),
      date: get(lf.dateFieldId),
    }));

    if (levels.length === 0 && detected.overallStatusFieldId) {
      levels.push({ id: 1, status: get(detected.overallStatusFieldId), approver: '', date: '' });
    }

    let currentLevel = 1;
    let status = 'pending';
    const maxLevel = levels.length || 1;

    for (const lvl of levels) {
      const s = (lvl.status || '').toLowerCase();
      if (s === 'approved') {
        currentLevel = lvl.id + 1;
        if (lvl.id === maxLevel) { currentLevel = maxLevel; status = 'completed'; }
      } else if (s === 'rejected') {
        currentLevel = lvl.id; status = 'rejected'; break;
      } else {
        currentLevel = lvl.id; status = 'pending'; break;
      }
    }

    const submittedBy = get(detected.nameFieldId);
    const email = get(detected.emailFieldId);
    const title = get(detected.descFieldId) || `Form ${formId}`;
    const description = get(detected.descFieldId) || '';
    const department = get(detected.deptFieldId) || 'General';
    const priority = get(detected.priorityFieldId) || 'medium';
    const amount = get(detected.amountFieldId) || '';
    const formTitle = String(raw.form_title || '') || `Form ${formId}`;
    const editLink = String(raw.edit_link || '');

    const createdAt = raw.created_at || '';
    const updatedAt = raw.updated_at || '';
    const submissionDate = createdAt ? new Date(createdAt.replace(' ', 'T') + 'Z') : new Date();
    const updatedDate = updatedAt ? new Date(updatedAt.replace(' ', 'T') + 'Z') : null;
    const totalDays = Math.floor((Date.now() - submissionDate.getTime()) / (1000 * 60 * 60 * 24));

    const allFieldsBlank = levels.every(l => !l.status);
    const acted = createdAt && updatedAt && createdAt !== updatedAt;
    const needsSync = (status === 'pending' && allFieldsBlank && acted) ? true : false;

    const allAnswers = {};
    for (const [qid, q] of Object.entries(answers)) {
      const val = extractText(q.answer);
      if (val) allAnswers[qid] = val;
    }

    // Fetch workflow tasks for pending approver info
    let pendingApproverName = '';
    let pendingApproverEmail = '';
    let workflowTasks = [];
    let approvalUrl = '';
    try {
      const workflowInstanceID = raw.workflowInstanceID || raw.workflow_instance_id;
      if (workflowInstanceID) {
        const instData = await jotformFetch(`workflow/instance/${workflowInstanceID}`, { keyType });
        const taskList = instData?.content?.taskList || [];
        // Flatten to the shape readers expect (top-level assigneeEmail) — matches
        // the poller + admin-sync, so task assignees pass the visibility gate.
        workflowTasks = taskList.map((t, idx) => extractTask(t, idx + 1));

        const activeTask = taskList.find(t => String(t.status || '').toUpperCase() === 'ACTIVE');
        if (activeTask) {
          const props = activeTask.properties || {};
          const assigneeUser = props.assigneeUser || {};
          const recipients = Array.isArray(props.recipients) ? props.recipients : [];
          const firstRecipient = recipients[0] || {};

          pendingApproverName = String(assigneeUser.name || firstRecipient.name || '');
          const candidateEmail = String(props.assigneeEmail || assigneeUser.email || firstRecipient.email || '');
          pendingApproverEmail = candidateEmail.includes('@') ? candidateEmail : '';

          const element = activeTask.element || {};
          const internalFormID = element.internalFormID || element.resourceID || element.formID || props.formID;
          const taskId = String(activeTask.id || '');
          const taskType = String(element.type || '');

          if (taskType === 'workflow_assign_form') {
            approvalUrl = `${env.JOTFORM_HOST}/${internalFormID}?workflowAssignFormTask=1&taskID=${taskId}`;
          } else {
            const rawAccessLink = String(activeTask.accessLink || props.accessLink || '');
            const shareMatch = rawAccessLink.match(/\/share\/(.+)$/);
            const accessToken = shareMatch ? shareMatch[1] : '';
            if (internalFormID && taskId && accessToken) {
              approvalUrl = `${env.JOTFORM_HOST}/approval-form/${internalFormID}/task/${taskId}/access-token/${encodeURIComponent(accessToken)}`;
            } else if (rawAccessLink) {
              approvalUrl = rawAccessLink;
            }
          }
        }
      }
    } catch (wfErr) {
      req.log.warn({ err: wfErr }, 'Could not fetch workflow tasks');
    }

    // Authoritative status from the workflow engine (instance status + task list),
    // overriding the form-field heuristic above. Clears the pending approver on
    // terminal states so a finished submission isn't left "pending with" someone.
    const derivedStatus = deriveWorkflowStatus(raw.workflowStatus || raw.workflow_status, workflowTasks);
    if (derivedStatus) {
      status = derivedStatus;
      if (derivedStatus === 'completed') currentLevel = maxLevel;
      if (derivedStatus !== 'pending') { pendingApproverName = ''; pendingApproverEmail = ''; }
    }

    const levelHistory = levels.map(l => {
      // Parse email from JotFlow action text if present; fall back to the
      // pending approver email for the current active level so visibility.js
      // can match past approvers even when workflow_tasks is empty.
      const approverEmail = parseEmailFromActionText(l.approver) ||
        (l.id === currentLevel ? pendingApproverEmail : '');
      return {
        level: l.id, status: l.status || 'pending',
        approver: l.approver || pendingApproverName || '',
        approverEmail,
        date: l.date || '',
      };
    });

    const genericStatus = status === 'completed' ? 'Completed' :
      status === 'rejected' ? 'Rejected' :
      levels.some(l => l.status?.toLowerCase() === 'approved') ? 'In Progress' : 'Pending';

    // Upsert into jf_submissions
    await pool.query(
      `INSERT INTO jf_submissions (
        jotform_submission_id, form_id, form_title, title, description,
        submitted_by, submitter_name, submitter_email, department,
        submission_date, current_level, status, priority, amount,
        approver_name, approver_email, pending_approver_name, pending_approver_email,
        jotform_status, answers, workflow_tasks, level_history, edit_link,
        raw_data, created_at_jf, updated_at_jf, days_at_level, total_days,
        last_synced, needs_sync, approval_url
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,now(),$29,$30)
      ON CONFLICT (jotform_submission_id) DO UPDATE SET
        form_id=$2, form_title=$3, title=$4, description=$5,
        submitted_by=$6, submitter_name=$7, submitter_email=$8, department=$9,
        submission_date=$10, current_level=$11, status=$12, priority=$13, amount=$14,
        approver_name=$15, approver_email=$16, pending_approver_name=$17, pending_approver_email=$18,
        jotform_status=$19, answers=$20, workflow_tasks=$21, level_history=$22, edit_link=$23,
        raw_data=$24, created_at_jf=$25, updated_at_jf=$26, days_at_level=$27, total_days=$28,
        last_synced=now(), needs_sync=$29, approval_url=$30`,
      [
        submissionId, formId, formTitle, title, description,
        submittedBy, submittedBy, email, department,
        submissionDate.toISOString(), Math.min(currentLevel, maxLevel), status, priority, amount,
        pendingApproverName || levels.find(l => l.approver)?.approver || '',
        pendingApproverEmail,
        pendingApproverName, pendingApproverEmail,
        genericStatus,
        JSON.stringify(allAnswers), JSON.stringify(workflowTasks),
        JSON.stringify(levelHistory), editLink,
        JSON.stringify({ ...raw, _mapped: { levels, email, amount } }),
        submissionDate.toISOString(), updatedDate?.toISOString() || null,
        totalDays, totalDays,
        needsSync, approvalUrl || null,
      ]
    );

    // Log task assignments to email_logs
    if (workflowTasks.length > 0) {
      upsertEmailLogs(submissionId, formId, String(raw.form_title || formId), workflowTasks)
        .catch(err => req.log.warn({ err }, '[webhook] email_logs upsert failed'));
    }

    // Notify pending approver
    if (pendingApproverEmail && status === 'pending') {
      insertNotification({
        userEmail: pendingApproverEmail,
        type: 'approval_needed',
        title: 'New approval request',
        message: `${title} from ${submittedBy || 'Unknown'} (${department}) needs your approval`,
        submissionId, formId,
        data: { level: currentLevel, submittedBy, department },
      }).catch(err => req.log.warn({ err }, '[webhook] Notification failed'));
    }

    // Upsert approval history rows
    for (const lvl of levels) {
      if (lvl.status) {
        const action = lvl.status.toLowerCase().includes('approved') ? 'approved'
          : lvl.status.toLowerCase().includes('rejected') ? 'rejected'
          : 'pending';
        await pool.query(
          `INSERT INTO jf_approval_history (submission_id, form_id, level, action, approver_name, approver_email, actioned_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT ON CONSTRAINT idx_jf_approval_history_sub_level DO UPDATE SET
             action=$4, approver_name=$5, approver_email=$6, actioned_at=$7`,
          [submissionId, formId, lvl.id, action,
           lvl.approver || pendingApproverName || '', pendingApproverEmail || '',
           lvl.date ? new Date(lvl.date).toISOString() : new Date().toISOString()]
        ).catch(e => req.log.warn({ err: e, submissionId, level: lvl.id }, '[submissions] approval_history upsert failed'));
      }
    }

    emitToAll('submissions:updated', { source: 'webhook', submissionId });
    res.json({ ok: true, submissionId, currentLevel, status, pendingApproverName, pendingApproverEmail });
  } catch (err) { next(err); }
});

module.exports = router;
