const env = require('../config/env');
const { resolveApiKey } = require('./jotform');

// The workspace gate is enterprise-wide (GDMO); login has no per-request key
// choice, so it always uses the GDMO key — the only configured one.
const WORKSPACE_KEY = () => resolveApiKey('gdmo');

// Cache the JotForm workspace member list so we don't hit the API on every
// login. TTL-bounded; shared by every server-side membership check.
let memberCache = null;
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Check whether an email is an ACTIVE member of the configured JotForm team.
 *
 * This is the single source of truth for the workspace gate. It MUST run
 * server-side before any session is issued — never trust the client to enforce
 * membership.
 *
 * In non-production it short-circuits to a member (devBypass) because the
 * JotForm Enterprise host (eforms.mediaoffice.ae) is unreachable outside the
 * GDMO network, which would otherwise block every local login.
 *
 * @param {string} rawEmail
 * @returns {Promise<{ isMember: boolean, member: object|null, totalMembers: number, devBypass: boolean }>}
 * @throws {Error} with `.code === 'NO_API_KEY'` if JOTFORM_API_KEY is unset, or
 *   a generic Error if the JotForm API is unreachable. Callers decide how to fail.
 */
async function checkWorkspaceMember(rawEmail) {
  const email = String(rawEmail || '').trim().toLowerCase();

  if (env.NODE_ENV !== 'production') {
    return { isMember: true, member: { email, accountType: 'USER' }, totalMembers: 0, devBypass: true };
  }

  if (!WORKSPACE_KEY()) {
    const err = new Error('JotForm API key not set');
    err.code = 'NO_API_KEY';
    throw err;
  }

  if (!memberCache || Date.now() - memberCache.fetchedAt > CACHE_TTL) {
    const url = `${env.JOTFORM_BASE}/users?teamID=${env.JOTFORM_TEAM_ID}`;
    const response = await fetch(url, { headers: { 'APIKEY': WORKSPACE_KEY() } });
    if (!response.ok) throw new Error(`JotForm API ${response.status}`);
    const data = await response.json();
    const raw = Array.isArray(data?.content) ? data.content : [];

    // Index each ACTIVE member under BOTH their email and their username
    // (lowercased). JotForm Enterprise frequently stores the corporate email
    // as the username, so matching the Microsoft login email against either
    // field avoids false rejections when the two don't line up exactly.
    // `count` tracks distinct members; `keys`/`byKey` are the lookup index.
    const keys = new Set();
    const byKey = new Map();
    let count = 0;
    for (const m of raw) {
      const status = String(m.status || '').toUpperCase();
      if (status !== 'ACTIVE') continue;
      const e = String(m.email || '').trim().toLowerCase();
      const u = String(m.username || '').trim().toLowerCase();
      if (!e && !u) continue;
      count += 1;
      const record = { name: String(m.name || m.username || ''), email: e, username: u, status, accountType: String(m.account_type || m.accountType || 'USER').toUpperCase() };
      for (const k of [e, u]) {
        if (!k) continue;
        keys.add(k);
        if (!byKey.has(k)) byKey.set(k, record);
      }
    }
    memberCache = { keys, byKey, count, fetchedAt: Date.now() };
  }

  const isMember = memberCache.keys.has(email);
  const member = isMember ? memberCache.byKey.get(email) : null;
  return { isMember, member, totalMembers: memberCache.count, devBypass: false };
}

module.exports = { checkWorkspaceMember };
