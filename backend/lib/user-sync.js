const pool = require('../db/pool');
const { jotformFetch } = require('./jotform');
const { getDefaultProfile } = require('./profiles');

/**
 * Sync the JotForm user directory for a profile into jf_users.
 *
 * Pages the account-wide `users` endpoint (rewritten to `enterprise/users` for
 * enterprise profiles by lib/jotform.js) and upserts each user, storing the full
 * raw payload so "all details" survive. Tagged by profile_id so each API's
 * directory stays separate.
 */

const PAGE_SIZE = 1000;
const MAX_PAGES = 50;

let lastRunAt = 0;
const MIN_INTERVAL_MS = 10 * 60 * 1000;

function field(obj, ...keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).trim()) return String(obj[k]);
  }
  return '';
}

function toDate(raw) {
  if (!raw) return null;
  const n = Number(raw);
  if (Number.isFinite(n) && String(raw).trim() !== '') {
    return new Date(String(raw).length <= 10 ? n * 1000 : n);
  }
  const d = new Date(raw);
  return isNaN(d) ? null : d;
}

async function upsertUser(u, profileId) {
  const jfId = field(u, 'id', 'username', 'userId', 'user_id');
  if (!jfId) return false;
  const last = toDate(u.last_login || u.lastLogin || u.last_seen);
  const created = toDate(u.created_at || u.createdAt);
  await pool.query(
    `INSERT INTO jf_users
       (profile_id, jf_id, username, email, name, account_type, status, avatar_url, last_login, created_at_jf, raw, synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
     ON CONFLICT (profile_id, jf_id) DO UPDATE SET
       username=$3, email=$4, name=$5, account_type=$6, status=$7,
       avatar_url=$8, last_login=$9, created_at_jf=$10, raw=$11, synced_at=now()`,
    [
      profileId,
      jfId,
      field(u, 'username', 'user', 'name'),
      field(u, 'email', 'userEmail', 'user_email', 'mail'),
      field(u, 'name', 'fullName', 'full_name', 'displayName', 'username'),
      field(u, 'account_type', 'accountType', 'type', 'userType', 'user_type'),
      field(u, 'status', 'accountStatus', 'state'),
      field(u, 'avatarUrl', 'avatar_url', 'avatar'),
      last && !isNaN(last) ? last.toISOString() : null,
      created && !isNaN(created) ? created.toISOString() : null,
      JSON.stringify(u),
    ]
  );
  return true;
}

async function runUserSync(opts = {}) {
  if (!opts.force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return { skipped: true };
  lastRunAt = Date.now();
  const profileId = opts.profileId || getDefaultProfile().id;

  let synced = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let data;
    try {
      data = await jotformFetch('users', {
        params: { limit: PAGE_SIZE, offset: page * PAGE_SIZE },
        keyType: profileId,
        timeoutMs: 30000,
      });
    } catch (err) {
      console.warn(`[user-sync] page ${page} fetch failed for profile ${profileId}:`, err.message);
      break;
    }
    const users = Array.isArray(data.content) ? data.content
      : Array.isArray(data.data) ? data.data
      : Array.isArray(data) ? data : [];
    if (!users.length) break;

    for (const u of users) {
      try { if (await upsertUser(u, profileId)) synced++; }
      catch (err) { console.warn('[user-sync] upsert failed:', err.message); }
    }
    if (users.length < PAGE_SIZE) break;
  }

  if (synced > 0) console.log(`[user-sync] synced ${synced} user(s) for profile ${profileId}`);
  return { synced };
}

module.exports = { runUserSync };
