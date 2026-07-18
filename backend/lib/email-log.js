const pool = require('../db/pool');
const { getDefaultProfile } = require('./profiles');

/**
 * Upsert one email_log row per workflow task.
 * Each row captures who was assigned, what step, and the task action link
 * (the URL JotForm sends to the assignee in assignment emails).
 *
 * workflowTasks must be flat objects from extractTask():
 *   { taskId, name, type, assigneeName, assigneeEmail, status,
 *     updatedAt, submittedBy, submittedByEmail, accessLink }
 */
async function upsertEmailLogs(submissionId, formId, formTitle, workflowTasks, profileId) {
  if (!Array.isArray(workflowTasks) || workflowTasks.length === 0) return;
  const pid = profileId || getDefaultProfile().id;
  for (const task of workflowTasks) {
    if (!task.taskId || !task.assigneeEmail) continue;
    const assignedAt = task.updatedAt ? new Date(task.updatedAt) : null;
    await pool.query(
      `INSERT INTO email_logs (
        submission_id, form_id, form_title, task_id, task_name, task_type,
        assignee_name, assignee_email, task_status, assigned_at,
        submitted_by_name, submitted_by_email, access_link, updated_at, profile_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),$14)
      ON CONFLICT (submission_id, task_id) DO UPDATE SET
        form_title=$3, task_name=$5, task_type=$6,
        assignee_name=$7, assignee_email=$8, task_status=$9,
        assigned_at=COALESCE($10, email_logs.assigned_at),
        submitted_by_name=$11, submitted_by_email=$12,
        access_link=CASE
          WHEN $6 = 'workflow_assign_task' AND ($13 LIKE '%/share/%' OR $13 LIKE '%/approval-form/%') THEN $13
          WHEN $6 = 'workflow_assign_task' AND (email_logs.access_link LIKE '%/share/%' OR email_logs.access_link LIKE '%/approval-form/%') THEN email_logs.access_link
          WHEN $6 = 'workflow_assign_task' THEN ''
          WHEN $13 = '' THEN email_logs.access_link
          ELSE $13
        END,
        updated_at=now(), profile_id=$14`,
      [
        submissionId, formId, formTitle,
        task.taskId, task.name || '', task.type || '',
        task.assigneeName || '', task.assigneeEmail,
        task.status || '',
        assignedAt && !isNaN(assignedAt) ? assignedAt.toISOString() : null,
        task.submittedBy || '', task.submittedByEmail || '',
        task.accessLink || '',
        pid,
      ]
    ).catch(err => console.warn(`[email-log] upsert failed for task ${task.taskId}:`, err.message));
  }
}

module.exports = { upsertEmailLogs };
