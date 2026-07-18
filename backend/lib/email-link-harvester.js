const pool = require('../db/pool');
const { jotformFetch } = require('./jotform');
const { pMapLimit } = require('./concurrency');
const { getDefaultProfile } = require('./profiles');
const { normalizeTaskLink } = require('./jotform-link');
const { upsertWorkspaceLinks } = require('./workspace-links');

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
    if (/\/share\/|\/approval-form\/|\/prefill\//i.test(url)) return url;
  }
  return null;
}

async function harvestFromInboxThread(submissionId, formId, tasksByAssignee, profileId) {
  let updated = 0;
  try {
    const threadData = await jotformFetch(`inbox/submission/${submissionId}/thread`,
      { keyType: profileId, timeoutMs: 15000 });
    const actions = Array.isArray(threadData.content) ? threadData.content : [];
    for (const action of actions) {
      if (action.actionType !== 'MAIL') continue;
      const emailQID = String(action.actionDetails?.emailQID || '');
      if (!emailQID || seenEmailIds.has(emailQID)) continue;
      const toAddr = String(action.actionDetails?.to || '').toLowerCase();
      const entry = [...tasksByAssignee.entries()].find(([email]) => toAddr.includes(email));
      if (!entry) continue;
      const [, task] = entry;
      const emailData = await jotformFetch(`emailq/${emailQID}`, { keyType: profileId, timeoutMs: 15000 });
      seenEmailIds.add(emailQID);
      const c = emailData.content || emailData;
      const link = extractShareLink(String(c.body || ''));
      if (!link) continue;
      if (String(task.type) === 'workflow_assign_form') continue;
      const normalized = normalizeTaskLink(link, task);
      const accessLink = normalized.normalizedUrl || link;
      const { rowCount } = await pool.query(
        `UPDATE jf_submissions
         SET workflow_tasks = (
           SELECT jsonb_agg(
             CASE WHEN t->>'taskId' = $2
               THEN jsonb_set(t, '{accessLink}', to_jsonb($3::text))
               ELSE t END
           ) FROM jsonb_array_elements(workflow_tasks) t
         ),
         approval_url = $3
         WHERE jotform_submission_id = $1 AND profile_id = $4`,
        [submissionId, String(task.taskId), accessLink, profileId]
      );
      if (rowCount > 0) {
        await pool.query(
          `UPDATE email_logs
              SET access_link = $3, updated_at = now()
            WHERE submission_id = $1
              AND task_id = $2
              AND profile_id = $4
              AND COALESCE(access_link, '') <> $3`,
          [submissionId, String(task.taskId), accessLink, profileId],
        );
        task.accessLink = accessLink;
        await upsertWorkspaceLinks({
          profileId, submissionId, formId, workflowTasks: [task], approvalUrl: accessLink,
        });
        updated++;
      }
    }
  } catch { /* non-fatal — retry next run */ }
  return updated;
}

async function harvestEmailLinks(opts = {}) {
  if (!opts.force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return { skipped: true };
  lastRunAt = Date.now();
  const profileId = opts.profileId || getDefaultProfile().id;

  // 1. Submissions with a non-completed task that has no accessLink yet
  const { rows } = await pool.query(
    `SELECT jotform_submission_id, form_id, workflow_tasks
     FROM jf_submissions
     WHERE profile_id = $1
       AND jsonb_typeof(workflow_tasks) = 'array'
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(workflow_tasks) t
         WHERE t->>'status' IN ('ACTIVE', 'PENDING')
           AND COALESCE(t->>'accessLink', '') = ''
       )`,
    [profileId]
  );
  if (rows.length === 0) return { updated: 0 };
  const bySubmission = new Map(rows.map(r => [String(r.jotform_submission_id), r]));

  // 2. Recent enterprise email log (full ~6-day retention)
  const logsData = await jotformFetch('enterprise/system-logs', {
    params: { 'event[0]': 'email', limit: 500, sortWay: 'DESC', sortBy: 'date' },
    keyType: profileId,
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
      const emailData = await jotformFetch(`emailq/${emailId}`, { keyType: profileId, timeoutMs: 15000 });
      const c = emailData.content || emailData;
      seenEmailIds.add(emailId);

      const link = extractShareLink(String(c.body || ''));
      if (!link) return;
      const toAddr = String(c.to || '').toLowerCase();
      const submissionId = String(entry.submissionID);
      const submission = bySubmission.get(submissionId);
      const tasks = submission?.workflow_tasks || [];

      const task = tasks.find(t =>
        ['ACTIVE', 'PENDING'].includes(String(t.status)) &&
        !t.accessLink &&
        t.assigneeEmail && toAddr.includes(String(t.assigneeEmail).toLowerCase())
      );
      if (!task || !task.taskId) return;
      if (String(task.type) === 'workflow_assign_form') return;
      const normalized = normalizeTaskLink(link, task);
      const accessLink = normalized.normalizedUrl || link;

      const { rowCount } = await pool.query(
        `UPDATE jf_submissions
         SET workflow_tasks = (
           SELECT jsonb_agg(
             CASE WHEN t->>'taskId' = $2 THEN jsonb_set(t, '{accessLink}', to_jsonb($3::text)) ELSE t END
           ) FROM jsonb_array_elements(workflow_tasks) t
         ),
         approval_url = $3
         WHERE jotform_submission_id = $1 AND profile_id = $4`,
        [submissionId, String(task.taskId), accessLink, profileId]
      );
      if (rowCount > 0) {
        await pool.query(
          `UPDATE email_logs
              SET access_link = $3, updated_at = now()
            WHERE submission_id = $1
              AND task_id = $2
              AND profile_id = $4
              AND COALESCE(access_link, '') <> $3`,
          [submissionId, String(task.taskId), accessLink, profileId],
        );
        task.accessLink = accessLink; // keep in-memory copy current for this run
        await upsertWorkspaceLinks({
          profileId, submissionId, formId: submission.form_id,
          workflowTasks: [task], approvalUrl: accessLink,
        });
        updated++;
      }
    } catch {
      // leave emailId out of seenEmailIds so a transient failure retries next run
    }
  });

  // Secondary: inbox thread — catches external user emails not in enterprise/system-logs
  await pMapLimit(rows, 4, async (r) => {
    const emptyTasks = (r.workflow_tasks || []).filter(
      t => ['ACTIVE', 'PENDING'].includes(String(t.status)) && !t.accessLink && t.assigneeEmail
    );
    if (!emptyTasks.length) return;
    const byEmail = new Map(emptyTasks.map(t => [String(t.assigneeEmail).toLowerCase(), t]));
    updated += await harvestFromInboxThread(String(r.jotform_submission_id), r.form_id, byEmail, profileId);
  });

  if (updated > 0) console.log(`[email-harvester] persisted ${updated} access link(s) from sent emails`);
  return { updated };
}

module.exports = { harvestEmailLinks };
