const pool = require('../db/pool');
const env = require('../config/env');
const { buildWorkflowTaskUrl, normalizeTaskLink } = require('./jotform-link');

function teamWorkspaceId(profileId) {
  return String(profileId || 'default');
}

function urlType(url) {
  const value = String(url || '');
  if (value.includes('/prefill/')) return 'prefill';
  if (value.includes('/approval-form/')) return 'approval';
  if (value.includes('workflowApprovalTask')) return 'approval';
  if (value.includes('workflowAssignTask')) return 'task';
  if (value.includes('/share/')) return 'share';
  if (value.includes('/inbox/')) return 'inbox';
  return 'form';
}

async function upsertWorkspaceForm(profileId, form = {}) {
  const workspaceId = teamWorkspaceId(profileId);
  const formId = String(form.id || form.form_id || '');
  if (!formId) return;
  await pool.query(
    `INSERT INTO team_workspace_forms
      (team_workspace_id, form_id, title, form_url, creator_username, status, created_at_jf, updated_at_jf)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (team_workspace_id, form_id) DO UPDATE SET
       title=$3, form_url=$4, creator_username=$5, status=$6,
       created_at_jf=COALESCE($7, team_workspace_forms.created_at_jf),
       updated_at_jf=COALESCE($8, team_workspace_forms.updated_at_jf), updated_at=now()` ,
    [
      workspaceId,
      formId,
      String(form.title || ''),
      String(form.form_url || form.formUrl || `${env.JOTFORM_HOST}/${formId}`),
      String(form.username || form.creator_username || ''),
      String(form.status || ''),
      form.created_at_jf || form.created_at || null,
      form.updated_at_jf || form.updated_at || null,
    ]
  );
}

async function recordWorkspaceSignUrl({ profileId, submissionId, taskId = '', level = 0, signUrl, source = 'workflow' }) {
  if (!submissionId || !signUrl) return;
  await pool.query(
    `INSERT INTO team_workspace_sign_urls
      (team_workspace_id, submission_id, task_id, level, sign_url, source)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (team_workspace_id, submission_id, task_id, level, sign_url) DO UPDATE SET
       source=$6, updated_at=now()` ,
    [teamWorkspaceId(profileId), String(submissionId), String(taskId), Number(level) || 0, String(signUrl), source]
  );
}

async function upsertWorkspaceLinks({ profileId, submissionId, formId, workflowTasks = [], approvalUrl = '' }) {
  if (!submissionId) return;
  const workspaceId = teamWorkspaceId(profileId);
  const tasks = Array.isArray(workflowTasks) ? workflowTasks : [];

  for (const task of tasks) {
    const taskId = String(task.taskId || '');
    const type = String(task.type || '');
    const taskUrl = buildWorkflowTaskUrl({
      ...task,
      accessLink: task.accessLink || (type === 'workflow_approval' ? approvalUrl : ''),
    }, formId);
    const normalized = normalizeTaskLink(taskUrl, { ...task, formId });
    if (!taskId) continue;

    if (type === 'workflow_assign_task' && taskUrl) {
      await pool.query(
        `INSERT INTO team_workspace_task_urls
          (team_workspace_id, submission_id, task_id, form_id, task_form_id, task_type,
           task_status, assignee_email, task_url, url_type, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (team_workspace_id, submission_id, task_id) DO UPDATE SET
           form_id=$4, task_form_id=$5, task_type=$6, task_status=$7,
           assignee_email=$8, task_url=$9, url_type=$10, source=$11, updated_at=now()` ,
        [
          workspaceId, String(submissionId), taskId, String(formId || ''),
          String(normalized.taskFormId || task.internalFormID || ''), type,
          String(task.status || ''), String(task.assigneeEmail || ''), taskUrl,
          'task', 'workflow',
        ]
      );
    } else {
      await pool.query(
        `DELETE FROM team_workspace_task_urls
          WHERE team_workspace_id=$1 AND submission_id=$2 AND task_id=$3`,
        [workspaceId, String(submissionId), taskId]
      );
    }

    if (type === 'workflow_assign_form' && taskUrl.includes('/prefill/')) {
      const match = taskUrl.match(/\/prefill\/([^?]+)/);
      await pool.query(
        `INSERT INTO team_workspace_prefill_form_urls
          (team_workspace_id, submission_id, task_id, form_id, prefill_id, prefill_url, source)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (team_workspace_id, submission_id, task_id) DO UPDATE SET
           form_id=$4, prefill_id=$5, prefill_url=$6, source=$7, updated_at=now()` ,
        [workspaceId, String(submissionId), taskId, String(task.internalFormID || formId || ''), match?.[1] || '', taskUrl, 'prefill-api']
      );
    } else {
      await pool.query(
        `DELETE FROM team_workspace_prefill_form_urls
          WHERE team_workspace_id=$1 AND submission_id=$2 AND task_id=$3`,
        [workspaceId, String(submissionId), taskId]
      );
    }

    if (type === 'workflow_approval' && taskUrl) {
      await pool.query(
        `INSERT INTO team_workspace_approval_urls
          (team_workspace_id, submission_id, task_id, form_id, approval_url, source)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (team_workspace_id, submission_id, task_id) DO UPDATE SET
           form_id=$4, approval_url=$5, source=$6, updated_at=now()` ,
        [workspaceId, String(submissionId), taskId,
          String(normalized.taskFormId || task.internalFormID || formId || ''), taskUrl, 'workflow']
      );
    } else {
      await pool.query(
        `DELETE FROM team_workspace_approval_urls
          WHERE team_workspace_id=$1 AND submission_id=$2 AND task_id=$3`,
        [workspaceId, String(submissionId), taskId]
      );
    }

    if (task.signatureUrl) {
      await recordWorkspaceSignUrl({
        profileId, submissionId, taskId, level: task.level, signUrl: task.signatureUrl,
      });
    }
  }

}

module.exports = { teamWorkspaceId, urlType, upsertWorkspaceForm, upsertWorkspaceLinks, recordWorkspaceSignUrl };
