const assert = require('assert');
const pool = require('../db/pool');
const { teamWorkspaceId, urlType, upsertWorkspaceLinks } = require('../lib/workspace-links');
const { extractTask } = require('../lib/workflow-task');

assert.strictEqual(teamWorkspaceId('gdmo__team_123'), 'gdmo__team_123');
assert.strictEqual(urlType('https://x/123/prefill/abc?taskID=1'), 'prefill');
assert.strictEqual(urlType('https://x/approval-form/123/task/1/access-token/a'), 'approval');
assert.strictEqual(urlType('https://x/inbox/123/456?taskID=1'), 'inbox');
assert.strictEqual(extractTask({ element: { type: 'workflow_assign_form' } }).type, 'workflow_assign_form');

(async () => {
  const calls = [];
  const query = pool.query;
  pool.query = async (sql, params) => { calls.push({ sql, params }); return { rows: [] }; };
  try {
    await upsertWorkspaceLinks({
      profileId: 'gdmo__team_123', submissionId: 'S1', formId: 'PARENT',
      workflowTasks: [
        { type: 'workflow_assign_task', taskId: 'T1', internalFormID: 'TASK_FORM', status: 'ACTIVE', assigneeEmail: 'task@example.com', accessLink: 'https://www.jotform.com/approval-form/TASK_FORM/task/T1/access-token/TOKEN' },
        { type: 'workflow_assign_form', taskId: 'F1', internalFormID: 'FORM_1', status: 'ACTIVE', accessLink: 'https://www.jotform.com/FORM_1/prefill/P1?workflowAssignFormTask=1&taskID=F1' },
        { type: 'workflow_approval', taskId: 'A1', internalFormID: 'PARENT', status: 'ACTIVE', accessLink: 'https://www.jotform.com/approval-form/PARENT/task/A1/access-token/APPROVAL' },
        { type: 'workflow_start_point', taskId: 'START', status: 'COMPLETED', accessLink: 'https://www.jotform.com/PARENT' },
      ],
    });
  } finally {
    pool.query = query;
  }

  const inserts = calls.filter(c => /^\s*INSERT INTO/.test(c.sql));
  assert.strictEqual(inserts.filter(c => c.sql.includes('team_workspace_task_urls')).length, 1);
  assert.strictEqual(inserts.filter(c => c.sql.includes('team_workspace_prefill_form_urls')).length, 1);
  assert.strictEqual(inserts.filter(c => c.sql.includes('team_workspace_approval_urls')).length, 1);
  assert.ok(inserts.find(c => c.sql.includes('team_workspace_task_urls')).params.includes('TASK_FORM'));
  console.log('workspace-links checks passed');
})().catch(err => { console.error(err); process.exitCode = 1; });
