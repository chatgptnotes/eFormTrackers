const pool = require('../db/pool');
const env = require('../config/env');

/**
 * Gate: check if this email is assigned/participating in any workflow
 * in our JotForm workspace (using synced DB data).
 *
 * Checks (in order):
 *   1. email_logs.assignee_email      — assigned to a workflow task
 *   2. jf_submissions.submitter_email — submitted a form
 *   3. jf_submissions.pending_approver_email — currently pending with them
 *
 * Dev bypass: always returns isMember=true so local testing isn't blocked.
 */
async function checkWorkspaceMember(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();

  if (env.NODE_ENV !== 'production') {
    return { isMember: true, member: { email, accountType: 'USER' }, totalMembers: 0, devBypass: true };
  }

  if (!env.JOTFORM_API_KEY) {
    const err = new Error('JotForm API key not set');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const { rows } = await pool.query(
    `SELECT 1 FROM email_logs WHERE lower(assignee_email) = $1
     UNION
     SELECT 1 FROM jf_submissions
       WHERE lower(submitter_email) = $1
          OR lower(pending_approver_email) = $1
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
