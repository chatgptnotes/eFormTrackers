const pool = require('../db/pool');
const { jotformFetch } = require('./jotform');
const { pMapLimit } = require('./concurrency');

// JotForm's workflow API only exposes a task's /share/{token} accessLink to
// the API key's OWN account — other assignees' links exist only in the emails
// JotForm sends them. The enterprise email log retains ~6 days, so this
// harvester runs after each poll cycle: it scans recent sent emails for tasks
// whose stored accessLink is empty, extracts the share link, and persists it
// into jf_submissions.workflow_tasks before the email expires from the log.

const seenEmailIds = new Set(); // emailq ids already inspected this process
let lastRunAt = 0;
const MIN_INTERVAL_MS = 5 * 60 * 1000;

function extractShareLink(html) {
  if (!html) return null;
  const re = /<a\s+[^>]*href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1].trim();
    if (/\/share\/|\/approval-form\//i.test(url)) return url;
  }
  return null;
}

async function harvestEmailLinks() {
  if (Date.now() - lastRunAt < MIN_INTERVAL_MS) return { skipped: true };
  lastRunAt = Date.now();

  // 1. Submissions with a non-completed task that has no accessLink yet
  const { rows } = await pool.query(
    `SELECT jotform_submission_id, workflow_tasks
     FROM jf_submissions
     WHERE jsonb_typeof(workflow_tasks) = 'array'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(workflow_tasks) t
         WHERE t->>'status' IN ('ACTIVE', 'PENDING')
           AND COALESCE(t->>'accessLink', '') = ''
       )`
  );
  if (rows.length === 0) return { updated: 0 };
  const bySubmission = new Map(rows.map(r => [String(r.jotform_submission_id), r.workflow_tasks]));

  // 2. Recent enterprise email log (full ~6-day retention)
  const logsData = await jotformFetch('enterprise/system-logs', {
    params: { 'event[0]': 'email', limit: 500, sortWay: 'DESC', sortBy: 'date' },
    keyType: 'gdmo',
    timeoutMs: 30000,
  });
  const entries = Array.isArray(logsData.content) ? logsData.content
    : Array.isArray(logsData.data) ? logsData.data : [];

  const candidates = entries.filter(e =>
    bySubmission.has(String(e.submissionID || '')) && !seenEmailIds.has(String(e.id))
  );

  // 3. Fetch each candidate email, match recipient → task assignee, persist link
  let updated = 0;
  await pMapLimit(candidates, 4, async (entry) => {
    const emailId = String(entry.id);
    try {
      const emailData = await jotformFetch(`emailq/${emailId}`, { keyType: 'gdmo', timeoutMs: 15000 });
      const c = emailData.content || emailData;
      seenEmailIds.add(emailId);

      const link = extractShareLink(String(c.body || ''));
      if (!link) return;
      const toAddr = String(c.to || '').toLowerCase();
      const submissionId = String(entry.submissionID);
      const tasks = bySubmission.get(submissionId) || [];

      const task = tasks.find(t =>
        ['ACTIVE', 'PENDING'].includes(String(t.status)) &&
        !t.accessLink &&
        t.assigneeEmail && toAddr.includes(String(t.assigneeEmail).toLowerCase())
      );
      if (!task || !task.taskId) return;

      const { rowCount } = await pool.query(
        `UPDATE jf_submissions
         SET workflow_tasks = (
           SELECT jsonb_agg(
             CASE WHEN t->>'taskId' = $2 THEN jsonb_set(t, '{accessLink}', to_jsonb($3::text)) ELSE t END
           ) FROM jsonb_array_elements(workflow_tasks) t
         )
         WHERE jotform_submission_id = $1`,
        [submissionId, String(task.taskId), link]
      );
      if (rowCount > 0) {
        task.accessLink = link; // keep in-memory copy current for this run
        updated++;
      }
    } catch {
      // leave emailId out of seenEmailIds so a transient failure retries next run
    }
  });

  if (updated > 0) console.log(`[email-harvester] persisted ${updated} access link(s) from sent emails`);
  return { updated };
}

module.exports = { harvestEmailLinks };
