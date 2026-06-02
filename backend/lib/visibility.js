/**
 * Server-side submission visibility — the authoritative gate (the frontend
 * has a mirror of this for UX, but the backend must not trust it).
 *
 * Fully dynamic / DB-driven and derived from JotForm participation: a normal
 * user sees a submission only if their email appears as the submitter, the
 * (pending/last) approver, a workflow-task assignee, or anywhere in the
 * approval history. The `admin`/`super_admin` roles are exempt — they have
 * full oversight visibility over every submission (e.g. the Completed view).
 */

function lc(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

/** Roles that bypass participation-based visibility (full oversight). */
function isAdminRole(role) {
  const r = lc(role);
  return r === 'admin' || r === 'super_admin';
}

/** Collect every participant email attached to a jf_submissions row. */
function rowParticipantEmails(row) {
  const out = new Set();
  const add = (e) => {
    const v = lc(e);
    if (v.includes('@')) out.add(v);
  };

  add(row.submitter_email);
  add(row.pending_approver_email);
  add(row.approver_email);

  const levelHistory = Array.isArray(row.level_history) ? row.level_history : [];
  for (const l of levelHistory) {
    if (l && typeof l === 'object') {
      add(l.approverEmail);
      add(l.assigneeEmail);
      add(l.email);
      // Also extract email from JotFlow action text stored in the `approver` field:
      // "Action: Approved | By: Name (email@domain.com) | ..."
      if (l.approver && typeof l.approver === 'string') {
        const m = l.approver.match(/By:\s*[^(]*\(([^)]+@[^)]+)\)/);
        if (m) add(m[1]);
      }
    }
  }

  const tasks = Array.isArray(row.workflow_tasks) ? row.workflow_tasks : [];
  for (const t of tasks) {
    if (t && typeof t === 'object') {
      add(t.assigneeEmail);
      add(t.submittedByEmail); // who actually completed the task (past approver)
      add(t.email);
    }
  }

  return out;
}

/**
 * Can this user see this jf_submissions row? Admins see everything; everyone
 * else only rows they participate in. Pass the session role to enable the
 * admin bypass.
 */
function isRowVisible(row, userEmail, role) {
  if (isAdminRole(role)) return true;
  const me = lc(userEmail);
  if (!me) return false;
  return rowParticipantEmails(row).has(me);
}

/**
 * Filter jf_submissions rows to those the user may see. Admins get the full
 * list unfiltered; everyone else only rows they participate in.
 */
function filterVisibleRows(rows, userEmail, role) {
  if (isAdminRole(role)) return rows;
  const me = lc(userEmail);
  if (!me) return [];
  return rows.filter((r) => rowParticipantEmails(r).has(me));
}

module.exports = { isRowVisible, filterVisibleRows, rowParticipantEmails, isAdminRole };
