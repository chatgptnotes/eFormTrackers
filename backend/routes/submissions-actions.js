const { Router } = require('express');
const pool = require('../db/pool');
const env = require('../config/env');
const { jotformFetch, resolveApiKey, buildJotformUrl } = require('../lib/jotform');
const { readKeyType } = require('../lib/key-type');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole } = require('../middleware/auth');
const { insertNotification } = require('../lib/notifications');
const { extractTask } = require('../lib/workflow-task');
const {
  workflowActionBodySchema,
  deleteSubmissionQuerySchema,
  jotformUpdateQuerySchema,
} = require('../schemas/submissions');

const router = Router();

// Every endpoint here mutates JotForm or our DB on behalf of a real user.
router.use(requireAuth);

// ── GET /api/workflow-tasks?submissionId=xxx&workflowInstanceId=yyy ──
router.get('/workflow-tasks', async (req, res, next) => {
  try {
    if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });

    const submissionId = req.query.submissionId;
    if (!submissionId) return res.status(400).json({ error: 'submissionId required' });

    const keyType = readKeyType(req);
    let workflowInstanceID = req.query.workflowInstanceId;

    if (!workflowInstanceID) {
      const subData = await jotformFetch(`submission/${submissionId}`, {
        params: { addWorkflowStatus: '1' },
        keyType,
      });
      const content = subData?.content || subData;
      workflowInstanceID = content?.workflowInstanceID || content?.workflow_instance_id;
    }

    if (!workflowInstanceID) return res.json({ tasks: [] });

    const instData = await jotformFetch(`workflow/instance/${workflowInstanceID}`, { keyType });
    const rawTaskList = instData?.content?.taskList || instData?.taskList || [];

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
    const keyType = readKeyType(req);

    // Step 1: Get workflowInstanceID
    const subData = await jotformFetch(`submission/${submissionId}`, {
      params: { addWorkflowStatus: '1' },
      keyType,
    });
    const content = subData?.content || subData;
    const instanceId = content?.workflowInstanceID || content?.workflow_instance_id;
    if (!instanceId) return res.status(404).json({ error: 'No workflow instance found' });

    // Step 2: Get workflow instance taskList
    const instData = await jotformFetch(`workflow/instance/${instanceId}`, { keyType });
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
            const updatedInstData = await jotformFetch(`workflow/instance/${instanceId}`, { keyType });
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
// Destructive cross-org operation — admin only.
router.delete('/delete-submission', requireRole('admin'), validate(deleteSubmissionQuerySchema, 'query'), async (req, res, next) => {
  try {
    const submissionId = req.query.submissionId;
    if (!env.JOTFORM_API_KEY) return res.status(500).json({ error: 'API key not configured' });

    const keyType = readKeyType(req);
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
