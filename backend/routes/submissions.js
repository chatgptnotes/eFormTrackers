const { Router } = require('express');
const pool = require('../db/pool');
const env = require('../config/env');
const { jotformFetch, resolveApiKey } = require('../lib/jotform');
const { validate } = require('../middleware/validate');
const {
  syncToSupabaseBodySchema,
  workflowActionBodySchema,
  deleteSubmissionQuerySchema,
  jotformUpdateQuerySchema,
} = require('../schemas/submissions');

function readKeyType(req) {
  const v = req.headers['x-jotform-key-type'];
  return v === 'gdmo' ? 'gdmo' : 'default';
}
const { detectLevelFields } = require('../lib/detect-fields');
const { insertNotification } = require('../lib/notifications');

const router = Router();

// ── Whitelisted query params for JotForm proxy ──
const ALLOWED_PARAMS = new Set(['limit', 'offset', 'orderby', 'direction', 'filter', 'id', 'addWorkflowStatus']);

// ── GET /api/jotform?path=user/forms ──
router.get('/jotform', async (req, res, next) => {
  try {
    const keyType = readKeyType(req);
    if (!resolveApiKey(keyType)) {
      return res.status(500).json({ error: `JotForm API key for "${keyType}" not set` });
    }
    const apiPath = req.query.path || 'user/forms';
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

// ── POST /api/sync-to-supabase ──
// Upserts enriched submission records from the frontend into PostgreSQL
router.post('/sync-to-supabase', validate(syncToSupabaseBodySchema), async (req, res, next) => {
  try {
    const records = req.body.records;

    let upserted = 0;
    let errors = 0;
    const errorDetails = [];
    const CHUNK = 20;

    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      try {
        for (const r of chunk) {
          const numericLevel = typeof r.currentLevel === 'number' ? r.currentLevel :
            r.currentLevel === 'completed' ? 999 : 0;
          const statusStr = r.currentLevel === 'completed' ? 'completed' :
            r.currentLevel === 'rejected' ? 'rejected' : 'pending';

          await pool.query(
            `INSERT INTO jf_submissions (
              jotform_submission_id, form_id, form_title, title, description,
              submitted_by, submitter_name, submitter_email, department,
              submission_date, current_level, status, priority, jotform_status,
              pending_approver_name, pending_approver_email, approver_name,
              approver_email, answers, level_history, raw_data, approval_url, last_synced
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,now())
            ON CONFLICT (jotform_submission_id) DO UPDATE SET
              form_id=$2, form_title=$3, title=$4, description=$5,
              submitted_by=$6, submitter_name=$7, submitter_email=$8, department=$9,
              submission_date=$10, current_level=$11, status=$12, priority=$13,
              jotform_status=$14, pending_approver_name=$15, pending_approver_email=$16,
              approver_name=$17, approver_email=$18, answers=$19, level_history=$20,
              raw_data=$21, approval_url=$22, last_synced=now()`,
            [
              r.id, r.formId, r.formTitle, r.title, r.description || r.title,
              r.submitterName, r.submitterName, r.submitterEmail, r.department,
              r.submissionDate ? new Date(r.submissionDate).toISOString() : new Date().toISOString(),
              Math.min(numericLevel, 99), statusStr, r.priority || 'medium',
              r.jotformStatus || 'Pending',
              r.pendingApproverName || '', r.pendingApproverEmail || '',
              r.pendingApproverName || '', r.pendingApproverEmail || '',
              JSON.stringify(r.answers || {}),
              JSON.stringify(r.approvalHistory || []),
              JSON.stringify({ _mapped: { levels: r.approvalHistory } }),
              r.approvalUrl || null,
            ]
          );
          upserted++;
        }
      } catch (err) {
        req.log.error({ err }, 'Upsert error');
        errorDetails.push(err.message);
        errors += chunk.length;
      }
    }

    res.json({ ok: true, upserted, errors, total: records.length, errorDetails });
  } catch (err) { next(err); }
});

// ── POST /api/webhook ──
// JotForm webhook handler — processes a submission and upserts to DB
const fieldCache = {};
const FIELD_CACHE_TTL = 60 * 60 * 1000;

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

async function getFieldsForForm(formId) {
  const cached = fieldCache[formId];
  if (cached && Date.now() - cached.at < FIELD_CACHE_TTL) return cached.fields;

  const data = await jotformFetch(`form/${formId}/questions`);
  const fields = detectLevelFields(data.content || {});
  fieldCache[formId] = { fields, at: Date.now() };
  return fields;
}

router.post('/webhook', async (req, res, next) => {
  try {
    // Validate webhook secret
    if (env.JOTFORM_WEBHOOK_SECRET) {
      if (req.query.secret !== env.JOTFORM_WEBHOOK_SECRET) {
        return res.status(403).json({ error: 'Invalid webhook secret' });
      }
    }
    if (!env.JOTFORM_API_KEY) {
      return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });
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
    });
    const raw = jfData.content;
    if (!raw) throw new Error('No content in JotForm response');

    if (!formId) formId = String(raw.form_id || '');
    if (!formId) throw new Error('No formId found');

    const answers = raw.answers || {};
    const get = (id) => id ? extractText(answers[id]?.answer) : '';

    const detected = await getFieldsForForm(formId);

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
        const instData = await jotformFetch(`workflow/instance/${workflowInstanceID}`);
        const taskList = instData?.content?.taskList || [];
        workflowTasks = taskList;

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

    const levelHistory = levels.map(l => ({
      level: l.id, status: l.status || 'pending',
      approver: l.approver || pendingApproverName || '', date: l.date || '',
    }));

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

    res.json({ ok: true, submissionId, currentLevel, status, pendingApproverName, pendingApproverEmail });
  } catch (err) { next(err); }
});

// ── GET /api/workflow-tasks?submissionId=xxx&workflowInstanceId=yyy ──
router.get('/workflow-tasks', async (req, res, next) => {
  try {
    if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });

    const submissionId = req.query.submissionId;
    if (!submissionId) return res.status(400).json({ error: 'submissionId required' });

    let workflowInstanceID = req.query.workflowInstanceId;

    if (!workflowInstanceID) {
      const subData = await jotformFetch(`submission/${submissionId}`, {
        params: { addWorkflowStatus: '1' },
      });
      const content = subData?.content || subData;
      workflowInstanceID = content?.workflowInstanceID || content?.workflow_instance_id;
    }

    if (!workflowInstanceID) return res.json({ tasks: [] });

    const instData = await jotformFetch(`workflow/instance/${workflowInstanceID}`);
    const rawTaskList = instData?.content?.taskList || instData?.taskList || [];

    const extractTask = (t) => {
      const element = t.element || {};
      const props = t.properties || {};
      const assigneeUser = props.assigneeUser || {};
      const recipients = Array.isArray(props.recipients) ? props.recipients : [];
      const firstRecipient = recipients[0] || {};
      const result = t.result || {};
      const completedBy = t.completedBy || t.completed_by || {};

      return {
        name: String(element.name || props.taskName || t.name || ''),
        type: String(element.type || ''),
        status: String(t.status || 'PENDING').toUpperCase(),
        assigneeName: String(assigneeUser.name || firstRecipient.name || t.assignee_name || ''),
        assigneeEmail: String(props.assigneeEmail || assigneeUser.email || firstRecipient.email || t.assignee || ''),
        updatedAt: String(t.updated_at || ''),
        taskId: String(t.id || ''),
        internalFormID: String(element.internalFormID || element.resourceID || element.formID || props.formID || ''),
        accessLink: String(t.accessLink || props.accessLink || element.accessLink || ''),
        submittedBy: String(completedBy.name || result.submittedBy || result.completed_by ||
          (String(t.status || '').toUpperCase() === 'COMPLETED' ? (assigneeUser.name || firstRecipient.name || '') : '') || ''),
        submittedByEmail: String(completedBy.email || result.submittedByEmail || result.completed_by_email ||
          (String(t.status || '').toUpperCase() === 'COMPLETED' ? (props.assigneeEmail || assigneeUser.email || firstRecipient.email || '') : '') || ''),
      };
    };

    const filteredTasks = rawTaskList.filter((t) => {
      const { name, status, assigneeEmail } = extractTask(t);
      if (name === 'Form' && status === 'COMPLETED' && !assigneeEmail) return false;
      return true;
    });

    const tasks = filteredTasks.map((t, index) => {
      const e = extractTask(t);
      return { ...e, level: index + 1 };
    });

    res.json({ tasks, workflowInstanceId: workflowInstanceID });
  } catch (err) {
    if (err.status === 404) return res.json({ tasks: [] });
    next(err);
  }
});

// ── POST /api/workflow-action ──
router.post('/workflow-action', validate(workflowActionBodySchema), async (req, res, next) => {
  try {
    if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });

    const { submissionId, action, comment, signature } = req.body;

    // Step 1: Get workflowInstanceID
    const subData = await jotformFetch(`submission/${submissionId}`, {
      params: { addWorkflowStatus: '1' },
    });
    const content = subData?.content || subData;
    const instanceId = content?.workflowInstanceID || content?.workflow_instance_id;
    if (!instanceId) return res.status(404).json({ error: 'No workflow instance found' });

    // Step 2: Get workflow instance taskList
    const instData = await jotformFetch(`workflow/instance/${instanceId}`);
    const taskList = instData?.content?.taskList || [];

    // Step 3: Find ACTIVE task
    const activeTask = taskList.find(t => t.status === 'ACTIVE');
    if (!activeTask) return res.status(400).json({ error: 'No active task — workflow may be completed' });

    const taskId = activeTask.id;
    const element = activeTask.element || {};
    const taskType = String(element.type || '');
    const taskName = String(element.name || '');
    const outcomes = Array.isArray(element.outcomes) ? element.outcomes : [];

    // Step 4: Determine outcomeID
    let outcomeID;
    if (action === 'approve') {
      const approveOutcome = outcomes.find(o => String(o.type).toUpperCase() === 'APPROVE');
      outcomeID = approveOutcome ? Number(approveOutcome.outcomeID) : (outcomes.length > 0 ? Number(outcomes[0].outcomeID) : 1);
    } else if (action === 'reject') {
      const denyOutcome = outcomes.find(o => String(o.type).toUpperCase() === 'DENY');
      if (!denyOutcome) {
        return res.status(400).json({ error: `Step "${taskName}" does not support rejection — it's a ${taskType} step` });
      }
      outcomeID = Number(denyOutcome.outcomeID);
    } else {
      outcomeID = outcomes.length > 0 ? Number(outcomes[0].outcomeID) : 1;
    }

    // Step 5: Complete the task
    const body = { outcomeID };
    if (comment) body.comment = comment;
    if (signature) body.signature = signature;

    const completeUrl = `${env.JOTFORM_BASE}/workflow/task/${taskId}/complete?apiKey=${env.JOTFORM_API_KEY}&teamID=${env.JOTFORM_TEAM_ID}`;
    const completeRes = await fetch(completeUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!completeRes.ok) {
      const errText = await completeRes.text();
      throw new Error(`Workflow task complete failed: ${completeRes.status} — ${errText}`);
    }
    const result = await completeRes.json();

    // Save to jf_approval_history
    try {
      const taskProps = activeTask.properties || {};
      const assigneeUser = taskProps.assigneeUser || {};
      await pool.query(
        `INSERT INTO jf_approval_history (submission_id, form_id, level, action, approver_name, approver_email, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT idx_jf_approval_history_sub_level DO UPDATE SET
           action=$4, approver_name=$5, approver_email=$6, comment=$7`,
        [submissionId, content?.formID || '', Number(activeTask.level || 0),
         action.toUpperCase(), String(assigneeUser.name || ''), String(assigneeUser.email || ''),
         comment || '']
      );
    } catch (histErr) {
      req.log.warn({ err: histErr }, '[workflow-action] History save failed');
    }

    // Send notifications
    try {
      const { rows } = await pool.query(
        `SELECT submitter_email, title, form_title FROM jf_submissions
         WHERE jotform_submission_id = $1`, [submissionId]
      );
      const subRow = rows[0];
      const submitterEmail = subRow?.submitter_email || '';
      const submissionTitle = subRow?.title || subRow?.form_title || 'Request';

      if (action === 'approve' && submitterEmail) {
        const isFinal = result?.content?.instanceCompleted || false;
        await insertNotification({
          userEmail: submitterEmail,
          type: 'submission',
          title: isFinal ? 'Request fully approved' : 'Request approved at current level',
          message: isFinal
            ? `Your request "${submissionTitle}" has been fully approved`
            : `Your request "${submissionTitle}" was approved and moved to the next level`,
          submissionId,
          data: { action: 'approved', final: isFinal },
        });

        // Notify next approver if not final
        if (!isFinal) {
          try {
            const updatedInstData = await jotformFetch(`workflow/instance/${instanceId}`);
            const updatedTaskList = updatedInstData?.content?.taskList || [];
            const nextTask = updatedTaskList.find(t => t.status === 'ACTIVE');
            if (nextTask) {
              const props = nextTask.properties || {};
              const au = props.assigneeUser || {};
              const recs = Array.isArray(props.recipients) ? props.recipients : [];
              const first = recs[0] || {};
              const ce = String(props.assigneeEmail || au.email || first.email || '');
              const nextEmail = ce.includes('@') ? ce : '';
              if (nextEmail) {
                await insertNotification({
                  userEmail: nextEmail,
                  type: 'approval_needed',
                  title: 'New approval request',
                  message: `"${submissionTitle}" needs your approval`,
                  submissionId,
                  data: { assignee: String(au.name || first.name || '') },
                });
              }
            }
          } catch (e) {
            req.log.warn({ err: e }, '[workflow-action] Next-approver notification failed');
          }
        }
      } else if (action === 'reject' && submitterEmail) {
        await insertNotification({
          userEmail: submitterEmail,
          type: 'submission',
          title: 'Request rejected',
          message: `Your request "${submissionTitle}" was rejected${comment ? ': ' + comment : ''}`,
          submissionId,
          data: { action: 'rejected', reason: comment || '' },
        });
      }
    } catch (notifErr) {
      req.log.warn({ err: notifErr }, '[workflow-action] Notification logic failed');
    }

    res.json({
      ok: true, action, taskId, taskName, taskType, outcomeID,
      instanceCompleted: result?.content?.instanceCompleted || false,
    });
  } catch (err) { next(err); }
});

// ── DELETE /api/delete-submission?submissionId=xxx ──
router.delete('/delete-submission', validate(deleteSubmissionQuerySchema, 'query'), async (req, res, next) => {
  try {
    const submissionId = req.query.submissionId;
    if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'API key not configured' });

    const deleteUrl = `${env.JOTFORM_BASE}/submission/${submissionId}?apiKey=${env.JOTFORM_API_KEY}&teamID=${env.JOTFORM_TEAM_ID}`;
    const deleteRes = await fetch(deleteUrl, { method: 'DELETE' });

    if (deleteRes.ok) {
      // Also remove from local DB
      await pool.query('DELETE FROM jf_submissions WHERE jotform_submission_id = $1', [submissionId]);
      return res.json({ success: true, submissionId });
    }

    res.status(deleteRes.status).json({ error: `JotForm API error: ${deleteRes.status}` });
  } catch (err) { next(err); }
});

// ── POST /api/jotform-update?submissionId=xxx ──
router.post('/jotform-update', validate(jotformUpdateQuerySchema, 'query'), async (req, res, next) => {
  try {
    const submissionId = req.query.submissionId;
    const keyType = readKeyType(req);
    const apiKey = resolveApiKey(keyType);
    if (!apiKey) return res.status(500).json({ error: `JotForm API key for "${keyType}" not set` });

    const SIGNATURE_REQUIRED_LEVELS = [1, 2, 3, 4];
    const rawBody = typeof req.body === 'string' ? req.body : new URLSearchParams(req.body).toString();
    const params = new URLSearchParams(rawBody);

    const action = params.get('_action');
    const levelStr = params.get('_level');
    const signatureUrl = params.get('_signatureUrl') || '';
    params.delete('_action');
    params.delete('_level');
    params.delete('_signatureUrl');

    if (action === 'approve' && levelStr) {
      const level = parseInt(levelStr, 10);
      if (SIGNATURE_REQUIRED_LEVELS.includes(level) && !signatureUrl) {
        return res.status(400).json({ error: `Digital signature is required for Level ${level} approval` });
      }
    }

    const url = `${env.JOTFORM_BASE}/submission/${submissionId}?apiKey=${apiKey}&teamID=${env.JOTFORM_TEAM_ID}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await response.json();
    res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) { next(err); }
});

// ── GET /api/cleanup-submissions?dryRun=true|false ──
router.get('/cleanup-submissions', async (req, res, next) => {
  try {
    if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });

    const KEEP_EMAIL = 'huzaifa.dawasaz@mediaoffice.ae';
    const dryRun = req.query.dryRun !== 'false';

    const formsData = await jotformFetch('user/forms', { params: { limit: '100' } });
    const forms = (formsData?.content || []).map(f => ({ id: String(f.id), title: String(f.title || '') }));

    const allSubmissions = [];
    for (const form of forms) {
      let offset = 0;
      const limit = 1000;
      let hasMore = true;
      while (hasMore) {
        const subData = await jotformFetch(`form/${form.id}/submissions`, {
          params: { limit: String(limit), offset: String(offset), orderby: 'created_at', direction: 'DESC', addWorkflowStatus: '1' },
        });
        const submissions = subData?.content || [];
        for (const sub of submissions) {
          const answers = sub.answers || {};
          let submittedBy = '';
          for (const ans of Object.values(answers)) {
            if (ans.type === 'control_fullname' && ans.answer) {
              submittedBy = [ans.answer.first, ans.answer.last].filter(Boolean).join(' ');
              break;
            }
          }
          allSubmissions.push({
            id: String(sub.id), formId: form.id, formTitle: form.title,
            submittedBy, pendingEmail: '', pendingName: '',
            workflowInstanceId: String(sub.workflowInstanceID || sub.workflow_instance_id || ''),
          });
        }
        hasMore = submissions.length === limit;
        offset += limit;
      }
    }

    // Fetch active task assignee for each submission with a workflow
    for (const sub of allSubmissions) {
      if (!sub.workflowInstanceId) continue;
      try {
        const instData = await jotformFetch(`workflow/instance/${sub.workflowInstanceId}`);
        const taskList = instData?.content?.taskList || [];
        for (const task of taskList) {
          const st = String(task.status || '').toUpperCase();
          if (st === 'ACTIVE' || st === 'PENDING') {
            const props = task.properties || {};
            const au = props.assigneeUser || {};
            const recs = Array.isArray(props.recipients) ? props.recipients : [];
            const first = recs[0] || {};
            sub.pendingEmail = String(props.assigneeEmail || au.email || first.email || task.assignee || '').toLowerCase();
            sub.pendingName = String(au.name || first.name || '');
            break;
          }
        }
      } catch (e) {
        req.log.warn({ err: e, submissionId: sub.id }, '[submissions] workflow task fetch failed');
      }
    }

    const deleteAll = KEEP_EMAIL === '';
    const toKeep = deleteAll ? [] : allSubmissions.filter(s => s.pendingEmail === KEEP_EMAIL);
    const toDelete = deleteAll ? allSubmissions : allSubmissions.filter(s => s.pendingEmail !== KEEP_EMAIL);

    if (dryRun) {
      return res.json({
        dryRun: true, totalSubmissions: allSubmissions.length,
        keepCount: toKeep.length, deleteCount: toDelete.length,
        keep: toKeep.map(s => ({ id: s.id, formTitle: s.formTitle, submittedBy: s.submittedBy, pendingEmail: s.pendingEmail })),
        delete: toDelete.map(s => ({ id: s.id, formTitle: s.formTitle, submittedBy: s.submittedBy, pendingEmail: s.pendingEmail })),
      });
    }

    const deleted = [];
    const failed = [];
    for (const sub of toDelete) {
      try {
        const url = `${env.JOTFORM_BASE}/submission/${sub.id}?apiKey=${env.JOTFORM_API_KEY}&teamID=${env.JOTFORM_TEAM_ID}`;
        const r = await fetch(url, { method: 'DELETE' });
        if (r.ok) deleted.push(sub.id);
        else failed.push({ id: sub.id, error: `HTTP ${r.status}` });
      } catch (e) {
        failed.push({ id: sub.id, error: String(e) });
      }
    }

    res.json({
      dryRun: false, totalSubmissions: allSubmissions.length,
      kept: toKeep.length, deleted: deleted.length, failed: failed.length,
      deletedIds: deleted, failedDetails: failed,
    });
  } catch (err) { next(err); }
});

module.exports = router;
