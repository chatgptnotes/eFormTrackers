// One-time: create task_tokens table and generate tokens for existing ACTIVE tasks.
const pool = require('../db/pool');
const { getOrCreateToken } = require('../lib/task-token');

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS task_tokens (
        token         TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL,
        task_id       TEXT NOT NULL,
        assignee_email TEXT NOT NULL,
        used_at       TIMESTAMPTZ,
        expires_at    TIMESTAMPTZ NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_task_tokens_submission ON task_tokens (submission_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_task_tokens_task ON task_tokens (task_id)`);
    console.log('[init-task-tokens] table ready');

    // Generate tokens for all existing ACTIVE workflow_assign_task tasks
    const { rows } = await pool.query(`
      SELECT jotform_submission_id, t->>'taskId' as task_id, t->>'assigneeEmail' as assignee_email
      FROM jf_submissions, jsonb_array_elements(workflow_tasks) t
      WHERE t->>'status' = 'ACTIVE'
        AND t->>'type' = 'workflow_assign_task'
        AND t->>'assigneeEmail' != ''
        AND t->>'taskId' != ''
    `);

    console.log(`[init-task-tokens] found ${rows.length} active tasks`);
    for (const row of rows) {
      const token = await getOrCreateToken(row.jotform_submission_id, row.task_id, row.assignee_email);
      console.log(`  token for ${row.assignee_email} (task ${row.task_id}): ${token}`);
    }
    console.log('[init-task-tokens] done');
  } catch (err) {
    console.error('[init-task-tokens] error:', err.message);
  } finally {
    await pool.end();
  }
})();
