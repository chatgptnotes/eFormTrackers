const { Router } = require('express');
const pool = require('../db/pool');
const { jotformFetch } = require('../lib/jotform');
const { requireAuth } = require('../middleware/auth');
const { pMapLimit } = require('../lib/concurrency');

const router = Router();
router.use(requireAuth);

// Per-user cache: { [email]: { data, at } }
const cache = new Map();
const CACHE_TTL = 3 * 60 * 1000;

// JotForm wraps action buttons in a /deeplink URL that tries to open the
// mobile app and falls back to the App Store. The real web URL is in the
// `redirect` query param — unwrap it so buttons open the actual task page.
function unwrapDeeplink(url) {
  if (!url.includes('/deeplink')) return url;
  try {
    const u = new URL(url);
    return u.searchParams.get('redirect') || url;
  } catch {
    return url;
  }
}

// Extract <a href="...">TEXT</a> pairs from HTML
function extractAnchorLinks(html) {
  if (!html) return [];
  const results = [];
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = unwrapDeeplink(m[1].trim().replace(/&amp;/gi, '&'));
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (url && url.startsWith('http')) results.push({ url, text });
  }
  return results;
}

// Classify a link as a workflow action
function classifyLink({ url, text }) {
  const u = url.toLowerCase();
  const t = text.toLowerCase();

  if (t.includes('approv') || u.includes('approv')) return { label: 'Approve', type: 'approve', url };
  if (t.includes('reject') || t.includes('deny') || u.includes('reject') || u.includes('deny')) return { label: 'Reject', type: 'reject', url };
  if (t.includes('fill') || t.includes('complete') || t.includes('submit') || u.includes('/form/')) return { label: 'Fill Form', type: 'fill', url };
  if (t.includes('view') || t.includes('open') || t.includes('review') || u.includes('inbox') || u.includes('task')) return { label: 'Open Task', type: 'task', url };

  return null;
}

// Strip HTML tags and collapse whitespace into a plain preview
function htmlToPreview(html, maxLen = 250) {
  return (html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

// GET /api/my-workflow-emails
router.get('/', async (req, res, next) => {
  const userEmail = (req.session.email || '').toLowerCase();
  if (!userEmail) return res.status(401).json({ error: 'Not authenticated' });

  const cached = cache.get(userEmail);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    // Step 1: Collect the submission IDs this user participates in
    // (submitter, current pending approver, or workflow task assignee).
    // The email log entries carry submissionID, so this lets us skip
    // fetching email bodies that can't possibly be addressed to the user.
    const { rows: subRows } = await pool.query(
      `SELECT jotform_submission_id FROM jf_submissions
       WHERE lower(submitter_email) = $1
          OR lower(pending_approver_email) = $1
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(workflow_tasks) = 'array' THEN workflow_tasks ELSE '[]'::jsonb END
            ) t WHERE lower(t->>'assigneeEmail') = $1
          )`,
      [userEmail]
    );
    const mySubmissionIds = new Set(subRows.map(r => String(r.jotform_submission_id)));

    // Step 2: Pull the enterprise email event log (JotForm retains ~6 days;
    // limit 500 returns everything it has)
    const logsData = await jotformFetch('enterprise/system-logs', {
      params: { 'event[0]': 'email', limit: 500, sortWay: 'DESC', sortBy: 'date' },
      keyType: 'gdmo',
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
        const emailData = await jotformFetch(`emailq/${emailId}`, { keyType: 'gdmo' });
        const c = emailData.content || emailData;

        // Find the "to" field — try multiple names
        const toRaw = c.to || c.recipient || c.email || c.recipientEmail || c.sendTo || '';
        const toAddr = Array.isArray(toRaw) ? toRaw.join(',') : String(toRaw);

        // Only show emails addressed to the logged-in user
        if (!toAddr.toLowerCase().includes(userEmail)) return null;

        const body = c.body || c.html || c.message || c.content || '';
        const anchors = extractAnchorLinks(body);
        const actionLinks = anchors
          .map(classifyLink)
          .filter(Boolean)
          // Deduplicate by type (keep first occurrence)
          .filter((l, i, arr) => arr.findIndex(x => x.type === l.type) === i);

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
