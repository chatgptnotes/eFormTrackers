const pool = require('../db/pool');
const { jotformFetch } = require('./jotform');
const { getDefaultProfile } = require('./profiles');

let lastRunAt = 0;
const MIN_INTERVAL_MS = 10 * 60 * 1000;

function buildDescription(e) {
  const type = String(e.eventType || e.event || e.type || '');
  if (type === 'email') {
    const to = e.details?.to || e.email || '';
    const subject = e.details?.subject || '';
    const status = e.status?.text || '';
    return `Email ${status} to ${to}${subject ? ' — ' + subject : ''}`.trim();
  }
  // fallback: use any plain string field
  return String(e.description || e.message || e.log || e.name || type);
}

async function syncSystemLogs(opts = {}) {
  if (!opts.force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return { skipped: true };
  lastRunAt = Date.now();
  const profileId = opts.profileId || getDefaultProfile().id;

  const data = await jotformFetch('enterprise/system-logs', {
    params: { limit: 1000, sortWay: 'DESC', sortBy: 'date' },
    keyType: profileId,
    timeoutMs: 30000,
  });

  const entries = Array.isArray(data.content) ? data.content
    : Array.isArray(data.data) ? data.data
    : Array.isArray(data) ? data : [];

  if (!entries.length) return { inserted: 0 };

  let inserted = 0;
  for (const e of entries) {
    const id = String(e.id || e.logId || e.log_id || '');
    if (!id) continue;

    const rawDate = e.date || e.createdAt || e.created_at || null;
    // JotForm returns Unix seconds (10-digit) for 'date'; JS needs ms
    const loggedAt = rawDate
      ? new Date(String(rawDate).length <= 10 ? Number(rawDate) * 1000 : Number(rawDate))
      : null;

    const { rowCount } = await pool.query(
      `INSERT INTO system_logs
         (id, event_type, description, form_id, submission_id, ip_address, actor_email, raw, logged_at, profile_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         description = EXCLUDED.description,
         raw = EXCLUDED.raw,
         profile_id = EXCLUDED.profile_id`,
      [
        id,
        String(e.eventType || e.event || e.type || e.action || ''),
        buildDescription(e),
        String(e.assetId || e.formID || e.formId || e.form_id || ''),
        String(e.submissionID || e.submissionId || e.submission_id || ''),
        String(e.ip || e.ipAddress || e.ip_address || ''),
        String(e.email || e.name || e.actorEmail || e.userEmail || ''),
        JSON.stringify(e),
        loggedAt,
        profileId,
      ]
    );
    if (rowCount > 0) inserted++;
  }

  if (inserted > 0) console.log(`[system-log-sync] upserted ${inserted} entries`);
  return { inserted };
}

module.exports = { syncSystemLogs };
