const pool = require('../db/pool');
const { jotformFetch } = require('./jotform');
const { getDefaultProfile } = require('./profiles');

let lastRunAt = 0;
const MIN_INTERVAL_MS = 10 * 60 * 1000;

// JotForm history dates the event with a `timestamp` (Unix seconds). Cursor
// objects (filtered out below) use a "YYYY-MM-DD HH:MM:SS" string — handle both.
function toIso(rawDate) {
  if (!rawDate) return null;
  const n = Number(rawDate);
  let ms;
  if (Number.isFinite(n)) {
    ms = String(rawDate).length <= 10 ? n * 1000 : n;
  } else {
    ms = Date.parse(String(rawDate));
  }
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// A real audit event always carries an id and/or an action/type. JotForm
// appends per-resource sync-cursor objects (e.g. {lastFormsDate:...}) to the
// history array — these are NOT events and must be skipped.
function isEvent(e) {
  return !!(e && (e.id || e.action || e.type || e.event || e.eventType));
}

// Pull the table columns out of a raw history entry, probing field aliases.
function extract(e) {
  return {
    id: String(e.id || e.logId || e.log_id || ''),
    action: String(e.action || e.type || e.event || e.eventType || ''),
    actor_username: String(e.username || e.user || ''),
    actor_email: String(e.userEmail || e.email || e.actorEmail || ''),
    actor_name: String(e.name || ''),
    ip_address: String(e.ip || e.ipAddress || e.ip_address || ''),
    entity_type: String(e.assetType || e.resourceType || e.resource_type || ''),
    entity_id: String(e.assetId || e.formID || e.formId || e.resourceId || e.resource_id || ''),
    logged_at: toIso(e.timestamp || e.date || e.createdAt || e.created_at),
  };
}

async function syncEnterpriseHistory(opts = {}) {
  if (!opts.force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return { skipped: true };
  lastRunAt = Date.now();
  const profileId = opts.profileId || getDefaultProfile().id;

  const data = await jotformFetch('enterprise/history', {
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
    if (!isEvent(e)) continue;
    const c = extract(e);
    if (!c.id) continue;

    // Audit events are immutable — only insert new ids, never rewrite.
    const { rowCount } = await pool.query(
      `INSERT INTO enterprise_history
         (id, action, actor_username, actor_email, actor_name, ip_address, entity_type, entity_id, raw, logged_at, profile_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [c.id, c.action, c.actor_username, c.actor_email, c.actor_name,
       c.ip_address, c.entity_type, c.entity_id, JSON.stringify(e), c.logged_at, profileId]
    );
    if (rowCount > 0) inserted++;
  }

  if (inserted > 0) console.log(`[history-sync] inserted ${inserted} new audit events`);
  return { inserted };
}

module.exports = { syncEnterpriseHistory, toIso, extract, isEvent };
