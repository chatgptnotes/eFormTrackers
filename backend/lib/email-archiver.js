const pool = require('../db/pool');
const { jotformFetch } = require('./jotform');
const { pMapLimit } = require('./concurrency');
const { htmlToPreview } = require('./email-parse');
const { getDefaultProfile } = require('./profiles');
const { forwardArchivedEmails } = require('./email-forwarder');
const {
  backfillArchivedEmailActionLinks,
  enrichArchivedEmailRecord,
  normalizeRecipientEmails,
  persistArchivedEmailActionLinks,
  primaryRecipientEmail,
  upsertAllowlistUsersFromEmail,
} = require('./email-ingestion');

/**
 * Email archiver — the "All Emails" data source.
 *
 * JotForm Enterprise records EVERY email it sends in enterprise/system-logs
 * (event=email) but only retains it ~6 days, and the body must be fetched
 * separately via emailq/{id}. This harvester pages the full log, fetches each
 * new email's body, and stores it permanently in jf_email_archive so the
 * workspace has a complete record long after JotForm drops the log entry.
 *
 * No per-recipient filter — every email is stored (cf. routes/workflow-emails.js
 * which filters to the logged-in user).
 */

// Pages of the system-log to walk per run, and how many bodies to fetch at once.
const PAGE_SIZE = 500;
const MAX_PAGES = 40;            // safety cap: 40 * 500 = 20k events per run
const BODY_CONCURRENCY = 5;      // matches workflow-emails.js — stays under JotForm 429

// Don't re-walk the log more often than this — matches system-log-sync.js.
let lastRunAt = 0;
const MIN_INTERVAL_MS = 5 * 60 * 1000;

// JotForm 'date' is Unix seconds (10-digit); JS Date wants ms.
function toDate(raw) {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    const d = new Date(raw);
    return isNaN(d) ? null : d;
  }
  return new Date(String(raw).length <= 10 ? n * 1000 : n);
}

function pickEmailId(entry) {
  return String(
    entry.emailId || entry.email_id || entry.emailID ||
    entry.id || entry.resource_id || ''
  );
}

// Fetch one page of email events from the enterprise system log.
async function fetchLogPage(offset, profileId) {
  const data = await jotformFetch('enterprise/system-logs', {
    params: { 'event[0]': 'email', limit: PAGE_SIZE, offset, sortWay: 'DESC', sortBy: 'date' },
    keyType: profileId,
    timeoutMs: 30000,
  });
  return Array.isArray(data.content) ? data.content
    : Array.isArray(data.data) ? data.data
    : Array.isArray(data) ? data : [];
}

// Which of these email ids are not yet archived for this profile?
async function filterNewIds(ids, profileId) {
  if (!ids.length) return [];
  const { rows } = await pool.query(
    'SELECT email_id FROM jf_email_archive WHERE profile_id = $2 AND email_id = ANY($1)',
    [ids, profileId]
  );
  const have = new Set(rows.map(r => r.email_id));
  return ids.filter(id => !have.has(id));
}

async function archiveOne(emailId, entry, profileId) {
  let emailData = null;
  try {
    emailData = await jotformFetch(`emailq/${emailId}`, { keyType: profileId, timeoutMs: 15000 });
  } catch (err) {
    // JotForm enterprise system-log ids are not always valid emailq ids.
    // Fall back to the log metadata so we still keep a permanent record.
    emailData = null;
  }

  const c = emailData?.content || emailData || {};
  const details = entry.details || {};
  const toRaw = c.to || c.recipient || c.email || c.recipientEmail || c.sendTo || details.to || '';
  const toAddr = Array.isArray(toRaw) ? toRaw.join(',') : String(toRaw);
  const fromAddr = String(c.from || c.sender || c.fromEmail || details.from || '');
  const body = c.body || c.html || c.message || c.content || '';
  const subject = String(c.subject || c.title || details.subject || '');
  const type = String(c.type || c.emailType || entry.emailType || details.type || '').toLowerCase();
  const sentAt = toDate(c.created_at || c.date || c.sentAt || entry.date);
  const enriched = await enrichArchivedEmailRecord({
    profileId,
    submissionId: String(entry.submissionID || entry.submissionId || c.submissionID || ''),
    formId: String(entry.assetId || entry.formID || entry.formId || c.formID || ''),
    toAddr,
    bodyHtml: String(body),
  });

  await pool.query(
    `INSERT INTO jf_email_archive
       (profile_id, email_id, submission_id, form_id, form_title, email_type,
        recipient_email, recipient_emails, recipient_user_jf_id, recipient_user_name,
        to_addr, from_addr, subject, body_html, preview, action_links, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (profile_id, email_id) DO UPDATE SET
       submission_id = COALESCE(NULLIF(EXCLUDED.submission_id, ''), jf_email_archive.submission_id),
       form_id = COALESCE(NULLIF(EXCLUDED.form_id, ''), jf_email_archive.form_id),
       form_title = COALESCE(NULLIF(EXCLUDED.form_title, ''), jf_email_archive.form_title),
       email_type = COALESCE(NULLIF(EXCLUDED.email_type, ''), jf_email_archive.email_type),
       recipient_email = COALESCE(NULLIF(EXCLUDED.recipient_email, ''), jf_email_archive.recipient_email),
       recipient_emails = CASE
         WHEN EXCLUDED.recipient_emails <> '[]'::jsonb THEN EXCLUDED.recipient_emails
         ELSE jf_email_archive.recipient_emails
       END,
       recipient_user_jf_id = COALESCE(NULLIF(EXCLUDED.recipient_user_jf_id, ''), jf_email_archive.recipient_user_jf_id),
       recipient_user_name = COALESCE(NULLIF(EXCLUDED.recipient_user_name, ''), jf_email_archive.recipient_user_name),
       to_addr = COALESCE(NULLIF(EXCLUDED.to_addr, ''), jf_email_archive.to_addr),
       from_addr = COALESCE(NULLIF(EXCLUDED.from_addr, ''), jf_email_archive.from_addr),
       subject = COALESCE(NULLIF(EXCLUDED.subject, ''), jf_email_archive.subject),
       body_html = COALESCE(NULLIF(EXCLUDED.body_html, ''), jf_email_archive.body_html),
       preview = COALESCE(NULLIF(EXCLUDED.preview, ''), jf_email_archive.preview),
       action_links = CASE
         WHEN EXCLUDED.action_links <> '[]'::jsonb THEN EXCLUDED.action_links
         ELSE jf_email_archive.action_links
       END,
       sent_at = COALESCE(EXCLUDED.sent_at, jf_email_archive.sent_at)`,
    [
      profileId,
      emailId,
      String(entry.submissionID || entry.submissionId || c.submissionID || ''),
      String(entry.assetId || entry.formID || entry.formId || c.formID || ''),
      String(c.formTitle || entry.formTitle || entry.assetName || ''),
      type.includes('autoresp') ? 'autoresponder' : (type.includes('notif') ? 'notification' : (type || 'unknown')),
      enriched.recipientEmail || primaryRecipientEmail(toAddr),
      JSON.stringify(enriched.recipientEmails || normalizeRecipientEmails(toAddr)),
      enriched.recipientUser?.jf_id || '',
      enriched.recipientUser?.name || '',
      toAddr,
      fromAddr,
      subject,
      String(body),
      htmlToPreview(body),
      JSON.stringify(enriched.actionLinks || []),
      sentAt,
    ]
  );
  await upsertAllowlistUsersFromEmail({
    profileId,
    emailId,
    toAddr,
    recipientEmails: enriched.recipientEmails || normalizeRecipientEmails(toAddr),
    recipientUser: enriched.recipientUser,
    sentAt,
  });
  await persistArchivedEmailActionLinks({
    profileId,
    submissionId: String(entry.submissionID || entry.submissionId || c.submissionID || ''),
    formId: String(entry.assetId || entry.formID || entry.formId || c.formID || ''),
    recipientEmail: enriched.recipientEmail || primaryRecipientEmail(toAddr),
    actionLinks: enriched.actionLinks || [],
  });
  return true;
}

/**
 * Walk the email log and archive every email not already stored. Stops early
 * once a page yields zero new ids (we page newest-first, so older pages are
 * already archived from prior runs).
 */
async function runEmailArchive(opts = {}) {
  if (!opts.force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return { skipped: true };
  lastRunAt = Date.now();
  const profileId = opts.profileId || getDefaultProfile().id;

  let archived = 0;
  let scanned = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const entries = await fetchLogPage(page * PAGE_SIZE, profileId);
    if (!entries.length) break;
    scanned += entries.length;

    // Dedupe ids within the page, keep the first entry per id for metadata.
    const byId = new Map();
    for (const entry of entries) {
      const id = pickEmailId(entry);
      if (id && !byId.has(id)) byId.set(id, entry);
    }

    const newIds = await filterNewIds([...byId.keys()], profileId);
    if (newIds.length === 0) break; // caught up — everything older is archived

    const results = await pMapLimit(newIds, BODY_CONCURRENCY, async (id) => {
      try {
        return await archiveOne(id, byId.get(id), profileId);
      } catch {
        return false; // transient body-fetch failure — retried next run
      }
    });
    archived += results.filter(Boolean).length;

    if (entries.length < PAGE_SIZE) break; // last page of the log
  }

  if (archived > 0) console.log(`[email-archiver] archived ${archived} new email(s) (scanned ${scanned})`);
  let backfilled = { processed: 0, updatedEmailLogs: 0, updatedSubmissionTasks: 0 };
  try {
    backfilled = await backfillArchivedEmailActionLinks({ profileId, limit: opts.backfillLimit || 500 });
    if (backfilled.updatedEmailLogs || backfilled.updatedSubmissionTasks) {
      console.log(`[email-archiver] backfilled ${backfilled.updatedEmailLogs} email log link(s), ${backfilled.updatedSubmissionTasks} submission task link(s)`);
    }
  } catch (err) {
    console.warn('[email-archiver] backfill failed:', err.message);
  }
  let forwarded = 0;
  try {
    const fwd = await forwardArchivedEmails({ profileId, limit: opts.forwardLimit || 25 });
    forwarded = fwd.forwarded || 0;
    if (forwarded > 0) console.log(`[email-archiver] forwarded ${forwarded} email(s) to ${fwd.to}`);
  } catch (err) {
    console.warn('[email-archiver] forward failed:', err.message);
  }
  return { archived, scanned, forwarded, backfilled };
}

module.exports = { runEmailArchive };
