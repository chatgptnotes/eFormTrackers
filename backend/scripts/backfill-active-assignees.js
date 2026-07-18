/**
 * backfill-active-assignees.js
 *
 * One-off maintenance script. Repairs jf_submissions rows whose JotForm workflow
 * is currently ACTIVE but whose assignee was never written to the DB (the old
 * streaming sync left pending_approver_email/workflow_tasks empty).
 *
 * For every submission with an active workflow instance it writes:
 *   - workflow_tasks        (flattened via lib/workflow-task.extractTask)
 *   - pending_approver_email / pending_approver_name  (the ACTIVE task assignee)
 *   - status = 'pending'
 *
 * Idempotent and non-destructive: it only fills fields on existing rows, never
 * deletes. Safe to re-run. Reads DB + JotForm creds straight from backend/.env.
 *
 * Run from the backend dir:   node scripts/backfill-active-assignees.js
 */
const fs = require('fs');
const path = require('path');
const { extractTask } = require('../lib/workflow-task');
const { Pool } = require('pg');

const envtxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const getEnv = (k) => (envtxt.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const BASE = getEnv('JOTFORM_BASE') || 'https://www.jotform.com/API';
const KEY = getEnv('JOTFORM_API_KEY_GDMO');
const pool = new Pool({ connectionString: getEnv('DATABASE_URL') });

const ACTIVE = new Set(['ACTIVE', 'PENDING', 'IN_PROGRESS', 'INPROGRESS']);
const FINISHED = new Set(['COMPLETED', 'COMPLETE', 'REJECTED', 'CANCELLED', 'NOT_STARTED']);

async function jf(p, params = {}) {
  const ep = p.startsWith('user/') ? 'enterprise/' + p.slice(5) : p;
  const u = new URL(`${BASE}/${ep}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { APIKEY: KEY } });
  let j = null; try { j = await r.json(); } catch {}
  return j;
}

(async () => {
  const forms = ((await jf('user/forms', { limit: 1000 })).content || []).filter((f) => f.id && Number(f.count) > 0);
  let updated = 0, scannedActive = 0, formsTouched = 0;
  for (const f of forms) {
    const subs = (await jf(`form/${f.id}/submissions`, { limit: 300, addWorkflowStatus: 1 })).content || [];
    let formUpd = 0;
    for (const s of subs) {
      const ws = String(s.workflowStatus || '').toUpperCase();
      const wfId = s.workflowInstanceID || s.workflow_instance_id;
      if (!wfId || FINISHED.has(ws)) continue;
      const inst = (await jf(`workflow/instance/${wfId}`)).content || {};
      if (FINISHED.has(String(inst.status || '').toUpperCase())) continue;
      const tasks = (Array.isArray(inst.taskList) ? inst.taskList : []).map((t, i) => extractTask(t, i + 1));
      const active = tasks.find((t) => ACTIVE.has(String(t.status).toUpperCase()));
      if (!active || !active.assigneeEmail) continue;
      scannedActive++;
      const r = await pool.query(
        `UPDATE jf_submissions
            SET workflow_tasks=$2::jsonb,
                pending_approver_email=$3,
                pending_approver_name=$4,
                approver_name = CASE WHEN approver_name IS NULL OR approver_name='' THEN $4 ELSE approver_name END,
                status='pending',
                last_synced=now()
          WHERE jotform_submission_id=$1`,
        [String(s.id), JSON.stringify(tasks), active.assigneeEmail, active.assigneeName || '']
      );
      if (r.rowCount > 0) { updated += r.rowCount; formUpd += r.rowCount; }
    }
    if (formUpd > 0) { formsTouched++; console.log(`form ${f.id} "${f.title}": +${formUpd}`); }
  }
  console.log(`\n=== BACKFILL DONE: ${updated} rows enriched across ${formsTouched} forms (active tasks seen: ${scannedActive}) ===`);
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
