const { Router } = require('express');
const pool = require('../db/pool');
const { jotformFetch, resolveApiKey, buildJotformUrl } = require('../lib/jotform');
const { readKeyType } = require('../lib/key-type');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { insertNotification } = require('../lib/notifications');
const { extractTask, findWorkflowOutcome, deriveWorkflowStatus } = require('../lib/workflow-task');
const {
  workflowActionBodySchema,
  deleteSubmissionQuerySchema,
  jotformUpdateQuerySchema,
} = require('../schemas/submissions');
const { emitToAll } = require('../lib/realtime');
const { isAdminRole } = require('../lib/visibility');

const router = Router();

// Every endpoint here mutates JotForm or our DB on behalf of a real user.
router.use(requireAuth);

// ── GET /api/workflow-tasks?submissionId=xxx&workflowInstanceId=yyy ──
router.get('/workflow-tasks', async (req, res, next) => {
  try {
    const submissionId = req.query.submissionId;
    if (!submissionId) return res.status(400).json({ error: 'submissionId required' });

    let workflowInstanceID = req.query.workflowInstanceId;
    let keyType = readKeyType(req);

    if (!workflowInstanceID) {
      const { rows: wRows } = await pool.query(
        `SELECT COALESCE(raw_data->>'workflowInstanceID', raw_data->>'workflow_instance_id') AS wid,
                profile_id
         FROM jf_submissions WHERE jotform_submission_id = $1`,
        [submissionId]
      );
      workflowInstanceID = wRows[0]?.wid || null;
      keyType = wRows[0]?.profile_id || keyType;
      if (keyType === 'all') {
        keyType = wRows[0]?.profile_id || keyType;
      }
    }
    if (!resolveApiKey(keyType)) return res.status(500).json({ error: `JotForm API key for "${keyType}" not set` });

    const taskData = await jotformFetch(`workflow/submission/${submissionId}/tasks`, { keyType });
    let rawTaskList = Array.isArray(taskData?.content) ? taskData.content
      : Array.isArray(taskData?.content?.taskList) ? taskData.content.taskList
      : [];

    if (!workflowInstanceID) {
      try {
        const subData = await jotformFetch(`submission/${submissionId}`, {
          params: { addWorkflowStatus: '1' },
          keyType,
        });
        const content = subData?.content || subData;
        workflowInstanceID = content?.workflowInstanceID || content?.workflow_instance_id || null;
      } catch (apiErr) {
        req.log.warn({ err: apiErr, submissionId }, '[workflow-tasks] submission API fallback failed');
      }
    }

    let workflowName = '';
    if (workflowInstanceID) {
      try {
        const instData = await jotformFetch(`workflow/instance/${workflowInstanceID}`, { keyType });
        if (rawTaskList.length === 0) rawTaskList = instData?.content?.taskList || instData?.taskList || [];
        const workflowId = String(instData?.content?.workflow_id || '');
        if (workflowId) {
          const workflowData = await jotformFetch(`workflow/${workflowId}`, { keyType });
          workflowName = String(workflowData?.content?.title || '');
        }
      } catch (err) {
        if (rawTaskList.length === 0) throw err;
        req.log.warn({ err, submissionId }, '[workflow-tasks] workflow name lookup failed');
      }
    }

    const filteredTasks = rawTaskList.filter((t) => {
      const { name, status, assigneeEmail } = extractTask(t);
      if (name === 'Form' && status === 'COMPLETED' && !assigneeEmail) return false;
      return true;
    });

    const tasks = filteredTasks.map((t, index) => {
      const e = extractTask(t);
      return { ...e, level: index + 1 };
    });

    res.json({ tasks, workflowInstanceId: workflowInstanceID, workflowName });
  } catch (err) {
    if (err.status === 404) return res.json({ tasks: [] });
    next(err);
  }
});

// ── POST /api/workflow-action ──
router.post('/workflow-action', validate(workflowActionBodySchema), async (req, res, next) => {
  try {
    let keyType = readKeyType(req);
    if (!resolveApiKey(keyType)) return res.status(500).json({ error: `JotForm API key for "${keyType}" not set` });

    const { submissionId, taskId: requestedTaskId, action, comment, signature, adminOverride, overrideReason } = req.body;
    const isAdminOverride = Boolean(adminOverride);
    if (isAdminOverride && !isAdminRole(req.session.role)) {
      return res.status(403).json({ error: 'Admin override is restricted to admin users' });
    }

    // Step 1: Get workflowInstanceID — read from DB first to avoid a JotForm
    // submission/{id} call that 401s on the Enterprise endpoint.
    const { rows: subRows } = await pool.query(
      `SELECT form_id,
              profile_id,
              COALESCE(raw_data->>'workflowInstanceID', raw_data->>'workflow_instance_id') AS wid
       FROM jf_submissions WHERE jotform_submission_id = $1`,
      [submissionId]
    );
    if (subRows[0]?.profile_id && resolveApiKey(subRows[0].profile_id)) {
      keyType = subRows[0].profile_id;
    }
    let instanceId = subRows[0]?.wid || null;
    let formIdForHistory = subRows[0]?.form_id || '';

    if (!instanceId) {
      try {
        const subData = await jotformFetch(`submission/${submissionId}`, {
          params: { addWorkflowStatus: '1' },
          keyType,
        });
        const content = subData?.content || subData;
        instanceId = content?.workflowInstanceID || content?.workflow_instance_id || null;
        formIdForHistory = formIdForHistory || content?.formID || '';
      } catch (apiErr) {
        req.log.warn({ err: apiErr, submissionId }, '[workflow-action] submission API fallback failed');
      }
    }

    if (!instanceId) return res.status(404).json({ error: 'No workflow instance found' });

    // Step 2: Get workflow instance taskList
    const instData = await jotformFetch(`workflow/instance/${instanceId}`, { keyType });
    const taskList = instData?.content?.taskList || [];

    // Step 3: Find the ACTIVE task assigned to THIS user. Parallel-approval
    // steps have several ACTIVE tasks at once — picking the first would 403
    // every assignee whose task isn't listed first.
    const myEmail = String(req.session.email || '').toLowerCase();
    const activeTasks = taskList.filter(t => t.status === 'ACTIVE');
    if (activeTasks.length === 0) return res.status(400).json({ error: 'No active task — workflow may be completed' });
    let activeTask = null;

    if (requestedTaskId) {
      const requestedTask = activeTasks.find(t => String(t.id || '') === String(requestedTaskId));
      if (!requestedTask) return res.status(400).json({ error: 'Requested task is not active' });
      const requestedAssignee = String(extractTask(requestedTask).assigneeEmail).toLowerCase();
      if (!isAdminOverride && requestedAssignee && requestedAssignee !== myEmail) {
        return res.status(403).json({ error: 'You are not the assigned user for this task' });
      }
      activeTask = requestedTask;
    }

    if (isAdminOverride && !activeTask) {
      return res.status(400).json({ error: 'Admin override requires the active task ID' });
    }

    if (!activeTask) {
      activeTask = activeTasks.find(t => String(extractTask(t).assigneeEmail).toLowerCase() === myEmail);
    }

    // DB fallback: JotForm API may return different field layout than what the
    // poller stores — use our authoritative workflow_tasks JSONB as a tie-breaker.
    if (!activeTask && myEmail) {
      const { rows: dbTasks } = await pool.query(
        `SELECT t->>'taskId' as task_id
         FROM jf_submissions, jsonb_array_elements(workflow_tasks) t
         WHERE jotform_submission_id = $1
           AND t->>'status' = 'ACTIVE'
           AND lower(t->>'assigneeEmail') = $2`,
        [submissionId, myEmail]
      );
      if (dbTasks.length > 0) {
        const dbTaskId = String(dbTasks[0].task_id);
        activeTask = activeTasks.find(t => String(t.id) === dbTaskId) || activeTasks[0];
      }
    }

    if (!activeTask) {
      return res.status(403).json({ error: 'You are not the assigned approver for this step' });
    }

    const taskId = activeTask.id;
    const element = activeTask.element || {};
    const taskType = String(element.type || '');
    const taskName = String(element.name || '');
    const outcomes = Array.isArray(element.outcomes) ? element.outcomes : [];

    // Step 4: Determine outcomeID
    let outcomeID;
    if (action === 'approve') {
      const approveOutcome = findWorkflowOutcome(outcomes, 'approve');
      outcomeID = approveOutcome ? Number(approveOutcome.outcomeID) : (outcomes.length > 0 ? Number(outcomes[0].outcomeID) : 1);
    } else if (action === 'reject') {
      const denyOutcome = findWorkflowOutcome(outcomes, 'reject');
      if (!denyOutcome) {
        return res.status(400).json({ error: `Step "${taskName}" does not support rejection — it's a ${taskType} step` });
      }
      outcomeID = Number(denyOutcome.outcomeID);
    } else {
      outcomeID = outcomes.length > 0 ? Number(outcomes[0].outcomeID) : 1;
    }

    // Step 5: Complete the task
    const body = {};
    if (outcomes.length > 0) body.outcomeID = outcomeID;
    if (comment) body.comment = comment;
    if (signature) body.signature = signature;

    const completeUrl = buildJotformUrl(`workflow/task/${taskId}/complete`, keyType);
    const completeRes = await fetch(completeUrl.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'APIKEY': resolveApiKey(keyType) },
      body: JSON.stringify(body),
    });

    if (!completeRes.ok) {
      const errText = await completeRes.text();
      throw new Error(`Workflow task complete failed: ${completeRes.status} — ${errText}`);
    }
    const result = await completeRes.json();
    const instanceCompleted = !!result?.content?.instanceCompleted;

    let updatedTaskList = [];
    try {
      const updatedTaskData = await jotformFetch(`workflow/submission/${submissionId}/tasks`, { keyType });
      updatedTaskList = Array.isArray(updatedTaskData?.content) ? updatedTaskData.content
        : Array.isArray(updatedTaskData?.content?.taskList) ? updatedTaskData.content.taskList
        : [];
    } catch (e) {
      req.log.warn({ err: e }, '[workflow-action] updated task fetch failed');
    }
    if (updatedTaskList.length === 0) {
      try {
        const updatedInstData = await jotformFetch(`workflow/instance/${instanceId}`, { keyType });
        updatedTaskList = updatedInstData?.content?.taskList || [];
      } catch (e) {
        req.log.warn({ err: e }, '[workflow-action] updated instance fetch failed');
      }
    }

    const updatedTasks = updatedTaskList.map((t, index) => ({ ...extractTask(t), level: index + 1 }));
    const activeFlat = updatedTasks.find(t => t.status === 'ACTIVE' && t.assigneeEmail)
      || updatedTasks.find(t => t.status === 'ACTIVE');
    const nextStatus = instanceCompleted ? 'completed' : (deriveWorkflowStatus('', updatedTasks) || 'pending');
    await pool.query(
      `UPDATE jf_submissions
          SET status = $2,
              current_level = CASE WHEN $2 = 'pending' THEN COALESCE($3, current_level) ELSE current_level END,
              pending_approver_name = CASE WHEN $2 = 'pending' THEN $4 ELSE NULL END,
              pending_approver_email = CASE WHEN $2 = 'pending' THEN $5 ELSE NULL END,
              workflow_tasks = CASE WHEN $6::jsonb = '[]'::jsonb THEN workflow_tasks ELSE $6::jsonb END,
              jotform_status = CASE WHEN $2 = 'completed' THEN 'Completed' WHEN $2 = 'rejected' THEN 'Rejected' ELSE 'In Progress' END,
              last_synced = now(),
              needs_sync = false
        WHERE jotform_submission_id = $1`,
      [
        submissionId,
        nextStatus,
        activeFlat?.level || null,
        activeFlat?.assigneeName || '',
        activeFlat?.assigneeEmail || '',
        JSON.stringify(updatedTasks),
      ],
    );

    // Save to jf_approval_history
    try {
      const taskProps = activeTask.properties || {};
      const assigneeUser = taskProps.assigneeUser || {};
      const assigned = extractTask(activeTask);
      const actorName = isAdminOverride ? String(req.session.fullName || req.session.email || 'Admin') : String(assigneeUser.name || '');
      const actorEmail = isAdminOverride ? String(req.session.email || '') : String(assigneeUser.email || '');
      const auditComment = isAdminOverride
        ? `[ADMIN OVERRIDE] Assigned to: ${assigned.assigneeName || 'Unassigned'} (${assigned.assigneeEmail || '—'}) | Reason: ${overrideReason}`
        : (comment || '');
      await pool.query(
        `INSERT INTO jf_approval_history (submission_id, form_id, level, action, approver_name, approver_email, comment)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ON CONSTRAINT idx_jf_approval_history_sub_level DO UPDATE SET
           action=$4, approver_name=$5, approver_email=$6, comment=$7`,
        [submissionId, formIdForHistory, Number(activeTask.level || 0),
         action.toUpperCase(), actorName, actorEmail, auditComment]
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
        const isFinal = instanceCompleted;
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

    emitToAll('submissions:updated', { source: 'action', submissionId, action });
    res.json({
      ok: true, action, taskId, taskName, taskType, outcomeID, adminOverride: isAdminOverride,
      instanceCompleted,
    });
  } catch (err) { next(err); }
});

// ── DELETE /api/delete-submission?submissionId=xxx ──
// Destructive cross-org operation — admin only.
router.delete('/delete-submission', requireRole('admin'), validate(deleteSubmissionQuerySchema, 'query'), async (req, res, next) => {
  try {
    const submissionId = req.query.submissionId;
    const keyType = readKeyType(req);
    if (!resolveApiKey(keyType)) return res.status(500).json({ error: `JotForm API key for "${keyType}" not set` });

    const deleteUrl = buildJotformUrl(`submission/${submissionId}`, keyType);
    const deleteRes = await fetch(deleteUrl.toString(), {
      method: 'DELETE',
      headers: { 'APIKEY': resolveApiKey(keyType) },
    });

    if (deleteRes.ok) {
      // Also remove from local DB
      await pool.query('DELETE FROM jf_submissions WHERE jotform_submission_id = $1', [submissionId]);
      return res.json({ success: true, submissionId });
    }

    res.status(deleteRes.status).json({ error: `JotForm API error: ${deleteRes.status}` });
  } catch (err) { next(err); }
});

// ── POST /api/jotform-update?submissionId=xxx ──
// H-1: Restrict to approver+ — viewers must not write arbitrary fields to any submission.
router.post('/jotform-update', requireRole('approver'), validate(jotformUpdateQuerySchema, 'query'), async (req, res, next) => {
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

    const url = buildJotformUrl(`submission/${submissionId}`, keyType);
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'APIKEY': apiKey },
      body: params.toString(),
    });
    const data = await response.json();
    res.status(response.ok ? 200 : response.status).json(data);
  } catch (err) { next(err); }
});

module.exports = router;
