/**
 * backfill-prefill-urls.js
 *
 * One-off migration. Fills the prefill (access) link on existing jf_submissions
 * rows whose workflow_tasks contain a non-completed `workflow_assign_form` task
 * with an empty accessLink. Going forward the poller / webhook / admin-sync set
 * this automatically — this script repairs the ~14k historical rows once.
 *
 * For each affected submission it runs lib/prefill.enrichTasksWithPrefill, which
 * matches the JotForm Prefills API (GET /form/{formID}/prefills) by parent
 * submission id + assignee email and writes the real
 *   {host}/{formID}/prefill/{prefillID}?workflowAssignFormTask=1&taskID={taskID}
 * URL. The per-form prefill list is cached, so this is ~1 API call per unique
 * target form regardless of how many submissions reference it.
 *
 * Idempotent and non-destructive: only fills empty accessLink fields, never
 * deletes. Safe to re-run. Reads DB + JotForm creds from backend/.env (via
 * config/env and the profile registry).
 *
 * Run from the backend dir:   node scripts/backfill-prefill-urls.js
 */
const pool = require('../db/pool');
const { enrichTasksWithPrefill } = require('../lib/prefill');

function hasOpenFormTaskWithoutLink(tasks) {
  return Array.isArray(tasks) && tasks.some(t =>
    String(t.type) === 'workflow_assign_form' &&
    ['ACTIVE', 'PENDING'].includes(String(t.status).toUpperCase()) &&
    !t.accessLink,
  );
}

(async () => {
  const { rows } = await pool.query(
    `SELECT jotform_submission_id, profile_id, workflow_tasks
       FROM jf_submissions
      WHERE jsonb_typeof(workflow_tasks) = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(workflow_tasks) t
          WHERE t->>'type' = 'workflow_assign_form'
            AND t->>'status' IN ('ACTIVE', 'PENDING')
            AND COALESCE(t->>'accessLink', '') = ''
        )`,
  );

  console.log(`[backfill-prefill] candidate submissions: ${rows.length}`);
  let matched = 0, unmatched = 0, updatedRows = 0;

  for (const r of rows) {
    const submissionId = String(r.jotform_submission_id);
    const profileId = r.profile_id || 'gdmo';
    const tasks = Array.isArray(r.workflow_tasks) ? r.workflow_tasks : [];

    await enrichTasksWithPrefill(tasks, submissionId, profileId);

    if (hasOpenFormTaskWithoutLink(tasks)) unmatched++; else matched++;

    // Persist only when at least one assign_form task now carries a link.
    const gotLink = tasks.some(t =>
      String(t.type) === 'workflow_assign_form' && /\/prefill\//.test(String(t.accessLink || '')),
    );
    if (gotLink) {
      const res = await pool.query(
        `UPDATE jf_submissions SET workflow_tasks = $2::jsonb, last_synced = now()
          WHERE jotform_submission_id = $1`,
        [submissionId, JSON.stringify(tasks)],
      );
      updatedRows += res.rowCount;
    }
  }

  console.log(
    `\n=== BACKFILL DONE: ${updatedRows} rows updated; ` +
    `${matched} fully matched, ${unmatched} still missing a link (review manually) ===`,
  );
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
