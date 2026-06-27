const crypto = require('crypto');
const pool = require('../db/pool');

async function createTaskToken(submissionId, taskId, assigneeEmail) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await pool.query(
    `INSERT INTO task_tokens (token, submission_id, task_id, assignee_email, expires_at)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (token) DO NOTHING`,
    [token, String(submissionId), String(taskId), String(assigneeEmail), expiresAt]
  );
  return token;
}

async function validateAndConsumeToken(token) {
  const { rows } = await pool.query(
    `UPDATE task_tokens SET used_at = now()
     WHERE token = $1 AND used_at IS NULL AND expires_at > now()
     RETURNING submission_id, task_id, assignee_email`,
    [token]
  );
  return rows[0] || null;
}

async function getOrCreateToken(submissionId, taskId, assigneeEmail) {
  const { rows } = await pool.query(
    `SELECT token FROM task_tokens
     WHERE submission_id=$1 AND task_id=$2 AND used_at IS NULL AND expires_at > now()
     LIMIT 1`,
    [String(submissionId), String(taskId)]
  );
  if (rows[0]) return rows[0].token;
  return createTaskToken(submissionId, taskId, assigneeEmail);
}

module.exports = { createTaskToken, validateAndConsumeToken, getOrCreateToken };
