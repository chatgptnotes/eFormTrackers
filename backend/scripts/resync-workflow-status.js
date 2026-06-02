/**
 * resync-workflow-status.js
 *
 * One-time reconcile: recompute each submission's status from its ALREADY-STORED
 * workflow_tasks (the authoritative workflow-engine snapshot) instead of the stale
 * `status` column that older poller/webhook writes derived from form fields.
 *
 * Only flips rows TO a terminal state (completed/rejected) — i.e. rows the engine
 * finished but that were left "pending" — and clears their pending approver. It
 * never un-completes a row. No JotForm API calls; pure DB reconcile.
 *
 * Usage (from backend/):
 *   node scripts/resync-workflow-status.js --dry   # report only
 *   node scripts/resync-workflow-status.js         # apply
 */
require('dotenv').config();
const { Pool } = require('pg');
const { deriveWorkflowStatus } = require('../lib/workflow-task');

const DRY = process.argv.includes('--dry');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const { rows } = await pool.query(
    `SELECT jotform_submission_id AS sid, status, workflow_tasks
       FROM jf_submissions
      WHERE workflow_tasks IS NOT NULL`
  );

  const updates = [];
  const byStatus = {};
  for (const r of rows) {
    let wt = r.workflow_tasks;
    if (typeof wt === 'string') { try { wt = JSON.parse(wt); } catch { wt = []; } }
    if (!Array.isArray(wt) || wt.length === 0) continue;

    const derived = deriveWorkflowStatus('', wt);
    // Only reconcile toward terminal states the engine actually reached.
    if (derived !== 'completed' && derived !== 'rejected') continue;
    if (String(r.status || '').toLowerCase() === derived) continue;

    updates.push([r.sid, derived]);
    byStatus[derived] = (byStatus[derived] || 0) + 1;
  }

  console.log(`Scanned ${rows.length} rows with task lists.`);
  console.log(`Rows to correct: ${updates.length}`, JSON.stringify(byStatus));

  if (DRY) { console.log('(dry run — no changes written)'); await pool.end(); return; }

  let done = 0;
  for (const [sid, derived] of updates) {
    await pool.query(
      `UPDATE jf_submissions
          SET status = $2,
              jotform_status = $3,
              pending_approver_name = NULL,
              pending_approver_email = NULL,
              last_synced = now()
        WHERE jotform_submission_id = $1`,
      [sid, derived, derived === 'completed' ? 'Completed' : 'Rejected']
    );
    done++;
  }
  console.log(`✓ Updated ${done} rows.`);
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
