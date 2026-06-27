const pool = require('../db/pool');
const { jotformFetch } = require('./jotform');
const { getDefaultProfile } = require('./profiles');
const { toIso, isEvent } = require('./history-sync');

let lastRunAt = 0;
const MIN_INTERVAL_MS = 10 * 60 * 1000;

function firstString(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const str = String(value).trim();
    if (str) return str;
  }
  return '';
}

function extractTargetEmail(entry) {
  const text = [
    entry.description,
    entry.message,
    entry.log,
    entry.details?.to,
    entry.to,
    entry.email,
  ].filter(Boolean).join(' ');
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : '';
}

function describe(entry) {
  return firstString(
    entry.description,
    entry.message,
    entry.log,
    entry.name,
    entry.title,
    entry.action,
    entry.type,
    entry.event,
    entry.eventType,
  );
}

function extract(entry) {
  return {
    id: firstString(entry.id, entry.logId, entry.log_id, entry.historyId, entry.history_id),
    action: firstString(entry.action, entry.type, entry.event, entry.eventType),
    event_type: firstString(entry.eventType, entry.event, entry.type, entry.action),
    description: describe(entry),
    actor_email: firstString(entry.userEmail, entry.actorEmail, entry.email),
    actor_name: firstString(entry.name, entry.username, entry.user),
    target_email: extractTargetEmail(entry),
    form_id: firstString(entry.assetId, entry.formID, entry.formId, entry.form_id),
    submission_id: firstString(entry.submissionID, entry.submissionId, entry.submission_id),
    ip_address: firstString(entry.ip, entry.ipAddress, entry.ip_address),
    logged_at: toIso(entry.timestamp || entry.date || entry.createdAt || entry.created_at),
  };
}

async function ensureAccountHistoryTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jotform_account_history (
      profile_id     TEXT NOT NULL DEFAULT 'gdmo',
      id             TEXT NOT NULL,
      action         TEXT DEFAULT '',
      event_type     TEXT DEFAULT '',
      description    TEXT DEFAULT '',
      actor_email    TEXT DEFAULT '',
      actor_name     TEXT DEFAULT '',
      target_email   TEXT DEFAULT '',
      form_id        TEXT DEFAULT '',
      submission_id  TEXT DEFAULT '',
      ip_address     TEXT DEFAULT '',
      raw            JSONB,
      logged_at      TIMESTAMPTZ,
      created_at     TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (profile_id, id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_account_history_action    ON jotform_account_history (profile_id, action)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_account_history_target    ON jotform_account_history (profile_id, lower(target_email))`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_account_history_logged_at ON jotform_account_history (profile_id, logged_at DESC)`);
}

async function syncAccountHistory(opts = {}) {
  if (!opts.force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return { skipped: true };
  lastRunAt = Date.now();
  const profileId = opts.profileId || getDefaultProfile().id;
  const limit = Math.min(parseInt(opts.limit || '1000', 10) || 1000, 1000);

  const data = await jotformFetch('user/history', {
    params: { limit, sortWay: 'DESC', sortBy: 'date' },
    keyType: profileId,
    timeoutMs: 30000,
  });

  const entries = Array.isArray(data.content) ? data.content
    : Array.isArray(data.data) ? data.data
    : Array.isArray(data) ? data : [];

  if (!entries.length) return { inserted: 0, upserted: 0, scanned: 0 };

  await ensureAccountHistoryTable();

  let inserted = 0;
  let upserted = 0;
  for (const entry of entries) {
    if (!isEvent(entry)) continue;
    const row = extract(entry);
    if (!row.id) continue;

    const { rowCount, rows } = await pool.query(
      `INSERT INTO jotform_account_history
         (profile_id, id, action, event_type, description, actor_email, actor_name,
          target_email, form_id, submission_id, ip_address, raw, logged_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (profile_id, id) DO UPDATE SET
         action = EXCLUDED.action,
         event_type = EXCLUDED.event_type,
         description = EXCLUDED.description,
         actor_email = EXCLUDED.actor_email,
         actor_name = EXCLUDED.actor_name,
         target_email = EXCLUDED.target_email,
         form_id = EXCLUDED.form_id,
         submission_id = EXCLUDED.submission_id,
         ip_address = EXCLUDED.ip_address,
         raw = EXCLUDED.raw,
         logged_at = EXCLUDED.logged_at
       RETURNING (xmax = 0) AS inserted`,
      [
        profileId,
        row.id,
        row.action,
        row.event_type,
        row.description,
        row.actor_email,
        row.actor_name,
        row.target_email,
        row.form_id,
        row.submission_id,
        row.ip_address,
        JSON.stringify(entry),
        row.logged_at,
      ],
    );
    if (rowCount > 0) {
      upserted++;
      if (rows[0]?.inserted) inserted++;
    }
  }

  if (upserted > 0) console.log(`[account-history-sync] upserted ${upserted} account history events`);
  return { inserted, upserted, scanned: entries.length };
}

module.exports = { syncAccountHistory, ensureAccountHistoryTable, extract };
