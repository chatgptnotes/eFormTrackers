const pool = require('../db/pool');
const env = require('../config/env');

/**
 * Gate: check if this email is assigned/participating in any workflow
 * in our JotForm workspace (using synced DB data).
 *
 * Checks (in order):
 *   1. email_logs.assignee_email      — assigned to a workflow task (synced)
 *   2. jf_submissions.submitter_email — submitted a form
 *   3. jf_submissions.pending_approver_email — currently pending with them
 *   4. jf_submissions.workflow_tasks JSONB — any ACTIVE/PENDING task assignee
 *      (catches non-workspace users assigned externally, even if email_logs
 *       wasn't written yet)
 *
 * Dev bypass: always returns isMember=true so local testing isn't blocked.
 */
async function checkWorkspaceMember(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();

  if (env.ADMIN_EMAIL && email === env.ADMIN_EMAIL) {
    return { isMember: true, member: { email, accountType: 'ADMIN' }, totalMembers: 1, adminBypass: true };
  }

  if (env.NODE_ENV !== 'production') {
    return { isMember: true, member: { email, accountType: 'USER' }, totalMembers: 0, devBypass: true };
  }

  const { rows } = await pool.query(
    `SELECT 1 FROM jf_users WHERE lower(email) = $1
     UNION
     SELECT 1 FROM team_workspace_task_urls WHERE lower(assignee_email) = $1
     UNION
     SELECT 1 FROM email_logs WHERE lower(assignee_email) = $1
     UNION
     SELECT 1 FROM jf_submissions
       WHERE lower(submitter_email) = $1
          OR lower(pending_approver_email) = $1
     UNION
     SELECT 1 FROM jf_submissions,
       jsonb_array_elements(workflow_tasks) t
     WHERE lower(t->>'assigneeEmail') = $1
       AND t->>'status' IN ('ACTIVE', 'PENDING')
     LIMIT 1`,
    [email]
  );

  const isMember = rows.length > 0;
  return {
    isMember,
    member: isMember ? { email, accountType: 'USER' } : null,
    totalMembers: 0,
    devBypass: false,
  };
}

module.exports = { checkWorkspaceMember };
