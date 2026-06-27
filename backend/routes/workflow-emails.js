const { Router } = require('express');
const pool = require('../db/pool');
const { jotformFetch } = require('../lib/jotform');
const { requireAuth } = require('../middleware/auth');
const { pMapLimit } = require('../lib/concurrency');
const { extractActionLinks, htmlToPreview } = require('../lib/email-parse');
const { readKeyType } = require('../lib/key-type');

const router = Router();
router.use(requireAuth);

// Per-user cache: { [email]: { data, at } }
const cache = new Map();
const CACHE_TTL = 3 * 60 * 1000;

// GET /api/my-workflow-emails
router.get('/', async (req, res, next) => {
  const userEmail = (req.session.email || '').toLowerCase();
  if (!userEmail) return res.status(401).json({ error: 'Not authenticated' });

  const cached = cache.get(userEmail);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const profileId = readKeyType(req);
    // Step 0: use the durable archived copy first. This survives JotForm's
    // retention window and preserves links even when the body fetch 404s.
    const { rows: archiveRows } = await pool.query(
      `SELECT email_id, submission_id, form_id, form_title, email_type,
              recipient_email, recipient_emails, recipient_user_jf_id, recipient_user_name,
              to_addr, from_addr, subject, preview, body_html, action_links, sent_at
         FROM jf_email_archive
        WHERE profile_id = $1
          AND (lower(recipient_email) = $2 OR lower(to_addr) LIKE $3)
        ORDER BY sent_at DESC NULLS LAST, created_at DESC
        LIMIT 60`,
      [profileId, userEmail, `%${userEmail}%`]
    );
    if (archiveRows.length > 0) {
      const emails = archiveRows.map(row => ({
        emailId: row.email_id,
        subject: row.subject || 'Workflow Notification',
        sentAt: row.sent_at || null,
        to: row.to_addr || row.recipient_email || '',
        preview: row.preview || htmlToPreview(row.body_html || ''),
        actionLinks: Array.isArray(row.action_links) ? row.action_links : extractActionLinks(row.body_html),
        submissionId: row.submission_id || '',
        formId: row.form_id || '',
        formTitle: row.form_title || '',
        recipientEmail: row.recipient_email || '',
        recipientEmails: Array.isArray(row.recipient_emails) ? row.recipient_emails : [],
        recipientUserJfId: row.recipient_user_jf_id || '',
        recipientUserName: row.recipient_user_name || '',
        source: 'archive',
      }));
      const out = { emails, total: emails.length, source: 'archive' };
      cache.set(userEmail, { data: out, at: Date.now() });
      return res.json(out);
    }

    // Step 1: Collect the submission IDs this user participates in
    // (submitter, current pending approver, or workflow task assignee).
    // The email log entries carry submissionID, so this lets us skip
    // fetching email bodies that can't possibly be addressed to the user.
    const { rows: subRows } = await pool.query(
      `SELECT jotform_submission_id FROM jf_submissions
       WHERE profile_id = $2
         AND (lower(submitter_email) = $1
          OR lower(pending_approver_email) = $1
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(workflow_tasks) = 'array' THEN workflow_tasks ELSE '[]'::jsonb END
            ) t WHERE lower(t->>'assigneeEmail') = $1
          ))`,
      [userEmail, profileId]
    );
    const mySubmissionIds = new Set(subRows.map(r => String(r.jotform_submission_id)));

    // Step 2: Pull the enterprise email event log (JotForm retains ~6 days;
    // limit 500 returns everything it has)
    const logsData = await jotformFetch('enterprise/system-logs', {
      params: { 'event[0]': 'email', limit: 500, sortWay: 'DESC', sortBy: 'date' },
      keyType: profileId,
    });

    const logEntries = Array.isArray(logsData.content)
      ? logsData.content
      : Array.isArray(logsData.data) ? logsData.data
      : Array.isArray(logsData) ? logsData
      : [];

    // Step 3: Fetch the matching emails' content (concurrently, capped to
    // avoid JotForm 429s) and keep only those addressed to this user
    const seenIds = new Set();
    const toFetch = [];
    for (const entry of logEntries) {
      if (!mySubmissionIds.has(String(entry.submissionID || ''))) continue;
      // The system-logs event entry; try multiple possible field names for emailId
      const emailId = String(
        entry.emailId || entry.email_id || entry.emailID ||
        entry.id || entry.resource_id || ''
      );
      if (!emailId || seenIds.has(emailId)) continue;
      seenIds.add(emailId);
      toFetch.push({ emailId, entry });
      if (toFetch.length >= 60) break;
    }

    const fetched = await pMapLimit(toFetch, 5, async ({ emailId, entry }) => {
      try {
        const emailData = await jotformFetch(`emailq/${emailId}`, { keyType: profileId });
        const c = emailData.content || emailData;

        // Find the "to" field — try multiple names
        const toRaw = c.to || c.recipient || c.email || c.recipientEmail || c.sendTo || '';
        const toAddr = Array.isArray(toRaw) ? toRaw.join(',') : String(toRaw);

        // Only show emails addressed to the logged-in user
        if (!toAddr.toLowerCase().includes(userEmail)) return null;

        const body = c.body || c.html || c.message || c.content || '';
        const actionLinks = extractActionLinks(body);

        return {
          emailId,
          subject: c.subject || c.title || 'Workflow Notification',
          sentAt: c.created_at || c.date || c.sentAt || entry.date || null,
          to: toAddr,
          preview: htmlToPreview(body),
          actionLinks,
        };
      } catch {
        // Individual email fetch failed — skip
        return null;
      }
    });
    const results = fetched.filter(Boolean);

    const out = { emails: results, total: results.length };
    cache.set(userEmail, { data: out, at: Date.now() });
    res.json(out);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
