/**
 * export-external-pending-links.js
 *
 * Bulk export of every workflow task currently PENDING with an EXTERNAL user
 * (assignee email outside the org, e.g. @gmail.com) together with that user's
 * direct access link. Covers both:
 *   - workflow_assign_form         -> /prefill/ direct link (JotForm Prefills API)
 *   - workflow_approval / _task    -> /share/ or /approval-form/ link (from email)
 *
 * Read-only by default: it RESOLVES assign_form prefill links in memory (no DB
 * write) and reads already-harvested /share/ links from the DB. Pass --harvest
 * to refresh /share/ links first (makes API calls + writes DB), and --write to
 * persist resolved assign_form links back like the backfill script.
 *
 * Reuses lib/prefill.enrichTasksWithPrefill and lib/email-link-harvester.
 * Creds come from config/env + the profile registry (set the GDMO admin key +
 * eforms host in backend/.env, or run on the production box).
 *
 * Run from the backend dir, e.g.:
 *   node scripts/export-external-pending-links.js
 *   node scripts/export-external-pending-links.js --limit=50
 *   node scripts/export-external-pending-links.js --internal=mediaoffice.ae,gov.ae --harvest --write
 */
const fs = require('fs');
const path = require('path');
const pool = require('../db/pool');
const { enrichTasksWithPrefill } = require('../lib/prefill');
const { harvestEmailLinks } = require('../lib/email-link-harvester');

// ── args ─────────────────────────────────────────────────────────────────────
function argVal(name, fallback) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

const internalDomains = (argVal('internal', process.env.INTERNAL_EMAIL_DOMAINS || 'mediaoffice.ae'))
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
const limit = parseInt(argVal('limit', '0'), 10) || 0;
const doHarvest = hasFlag('harvest');
const doWrite = hasFlag('write');
const outArg = argVal('out', '');

const PENDING = new Set(['ACTIVE', 'PENDING']);
const isExternal = (email) => {
  const e = String(email || '').toLowerCase();
  const at = e.indexOf('@');
  if (at < 0) return false;
  return !internalDomains.includes(e.slice(at + 1));
};
const classifyLink = (url) => {
  const u = String(url || '');
  if (/\/prefill\//.test(u)) return 'prefill';
  if (/\/approval-form\//.test(u)) return 'approval-form';
  if (/\/share\//.test(u)) return 'share';
  return u ? 'other' : 'none';
};
const csvCell = (v) => {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

(async () => {
  if (doHarvest) {
    console.log('[export] --harvest: refreshing /share/ links from sent emails (writes DB)…');
    try {
      const r = await harvestEmailLinks({ force: true });
      console.log(`[export] harvest done: ${r.updated ?? 0} link(s) refreshed`);
    } catch (e) {
      console.warn('[export] harvest failed (continuing with stored links):', e.message);
    }
  }

  const { rows } = await pool.query(
    `SELECT jotform_submission_id, form_id, form_title, profile_id, submission_date, workflow_tasks
       FROM jf_submissions
      WHERE jsonb_typeof(workflow_tasks) = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(workflow_tasks) t
          WHERE t->>'status' IN ('ACTIVE', 'PENDING')
        )
      ORDER BY submission_date DESC NULLS LAST
      ${limit ? `LIMIT ${limit}` : ''}`,
  );

  console.log(`[export] scanning ${rows.length} submission(s) with pending tasks; ` +
    `internal domains = [${internalDomains.join(', ')}]`);

  const out = [];
  let resolvedNow = 0, persisted = 0;

  for (const r of rows) {
    const submissionId = String(r.jotform_submission_id);
    const profileId = r.profile_id || 'gdmo';
    const tasks = Array.isArray(r.workflow_tasks) ? r.workflow_tasks : [];

    // Only bother resolving when this row actually has an external pending task.
    const hasExternalPending = tasks.some(t =>
      PENDING.has(String(t.status).toUpperCase()) && isExternal(t.assigneeEmail));
    if (!hasExternalPending) continue;

    // Resolve assign_form /prefill/ links in memory (read-only vs DB).
    const before = tasks.map(t => String(t.accessLink || ''));
    await enrichTasksWithPrefill(tasks, submissionId, profileId);
    const changed = tasks.some((t, i) => String(t.accessLink || '') !== before[i]);
    if (changed) resolvedNow++;

    if (doWrite && changed) {
      const res = await pool.query(
        `UPDATE jf_submissions SET workflow_tasks = $2::jsonb, last_synced = now()
          WHERE jotform_submission_id = $1`,
        [submissionId, JSON.stringify(tasks)],
      );
      persisted += res.rowCount;
    }

    for (const t of tasks) {
      if (!PENDING.has(String(t.status).toUpperCase())) continue;
      if (!isExternal(t.assigneeEmail)) continue;
      out.push({
        submissionId,
        formId: String(r.form_id || ''),
        formTitle: String(r.form_title || ''),
        taskType: String(t.type || ''),
        taskId: String(t.taskId || ''),
        level: t.level ?? '',
        assigneeName: String(t.assigneeName || ''),
        assigneeEmail: String(t.assigneeEmail || ''),
        status: String(t.status || ''),
        linkType: classifyLink(t.accessLink),
        accessLink: String(t.accessLink || ''),
        profileId,
        submissionDate: r.submission_date ? new Date(r.submission_date).toISOString() : '',
      });
    }
  }

  // ── write CSV + JSON ─────────────────────────────────────────────────────
  const cols = ['submissionId', 'formId', 'formTitle', 'taskType', 'taskId', 'level',
    'assigneeName', 'assigneeEmail', 'status', 'linkType', 'accessLink', 'profileId', 'submissionDate'];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const base = outArg
    ? outArg.replace(/\.(csv|json)$/i, '')
    : path.join(__dirname, 'exports', `external-pending-links.${stamp}`);
  fs.mkdirSync(path.dirname(base), { recursive: true });
  const csv = [cols.join(','), ...out.map(row => cols.map(c => csvCell(row[c])).join(','))].join('\n');
  fs.writeFileSync(`${base}.csv`, csv);
  fs.writeFileSync(`${base}.json`, JSON.stringify(out, null, 2));

  // ── summary ──────────────────────────────────────────────────────────────
  const by = (key) => out.reduce((m, r) => (m[r[key]] = (m[r[key]] || 0) + 1, m), {});
  const noLink = out.filter(r => r.linkType === 'none').length;
  console.log(`\n=== EXTERNAL PENDING LINKS: ${out.length} task(s) ===`);
  console.log('by taskType :', by('taskType'));
  console.log('by linkType :', by('linkType'));
  console.log(`resolved this run: ${resolvedNow} submission(s)` + (doWrite ? `; persisted ${persisted} row(s)` : ' (in-memory only; pass --write to persist)'));
  if (noLink) console.log(`NOTE: ${noLink} external task(s) have NO link — typically /share/ invites aged past the 6-day email window (re-run with --harvest, or links must be regenerated in JotForm).`);
  console.log(`\nwrote:\n  ${base}.csv\n  ${base}.json`);

  await pool.end();
})().catch((e) => { console.error('ERR', e.stack || e.message); process.exit(1); });
