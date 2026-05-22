const { Router } = require('express');
const msal = require('@azure/msal-node');
const pool = require('../db/pool');
const env = require('../config/env');

const router = Router();
const ORG_ID = '971589dd-afcb-4a12-8900-47626e4d59cc';

// ── Microsoft OAuth (MSAL) config ──
const msalConfig = {
  auth: {
    clientId: env.MICROSOFT_CLIENT_ID,
    authority: 'https://login.microsoftonline.com/common',
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
  },
};
// Lazily build the MSAL client so the backend can boot without Microsoft SSO
// credentials configured. Only the /microsoft routes need it.
let _msalClient = null;
function getMsalClient() {
  if (!_msalClient) {
    _msalClient = new msal.ConfidentialClientApplication(msalConfig);
  }
  return _msalClient;
}
const MS_SCOPES = ['openid', 'profile', 'email', 'User.Read'];

// ── GET /api/auth/microsoft — Redirect to Microsoft login ──
// Uses HTML meta-refresh instead of 302 to avoid IIS ARR rewriting the Location header
router.get('/microsoft', async (req, res) => {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_REDIRECT_URI) {
    return res.redirect('/login?error=microsoft_not_configured');
  }
  try {
    const authUrl = await getMsalClient().getAuthCodeUrl({
      scopes: MS_SCOPES,
      redirectUri: env.MICROSOFT_REDIRECT_URI,
    });
    res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${authUrl}"><script>window.location.href="${authUrl}";</script></head><body>Redirecting to Microsoft…</body></html>`);
  } catch (err) {
    req.log.error({ err }, '[microsoft] auth URL error');
    res.redirect('/login?error=microsoft_auth_failed');
  }
});

// ── GET /api/auth/microsoft/callback — Exchange code, create/find user, set session ──
router.get('/microsoft/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.redirect('/login?error=microsoft_auth_failed');
  }

  try {
    const tokenResponse = await getMsalClient().acquireTokenByCode({
      code: String(code),
      scopes: MS_SCOPES,
      redirectUri: env.MICROSOFT_REDIRECT_URI,
    });

    const claims = tokenResponse.idTokenClaims || {};
    const email = (claims.preferred_username || claims.email || '').toLowerCase().trim();
    const name = claims.name || email.split('@')[0];

    if (!email) {
      return res.redirect('/login?error=microsoft_no_email');
    }

    // Find or create user
    let userRow;
    const existing = await pool.query(
      `SELECT u.id, u.email, u.full_name,
              p.role, p.department, p.avatar_url, p.preferences, p.org_id
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.email = $1`,
      [email]
    );

    if (existing.rows.length > 0) {
      userRow = existing.rows[0];
    } else {
      // Create new user (OAuth-only, no password login)
      const ins = await pool.query(
        `INSERT INTO users (email, password_hash, full_name)
         VALUES ($1, $2, $3) RETURNING id, email, full_name`,
        [email, '__microsoft_oauth__', name]
      );
      const newUser = ins.rows[0];

      await pool.query(
        `INSERT INTO profiles (user_id, full_name, department, role, org_id, preferences)
         VALUES ($1, $2, '', 'viewer', $3, '{"theme":"dark","language":"en"}')`,
        [newUser.id, name, ORG_ID]
      );
      await pool.query(
        `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'viewer')`,
        [ORG_ID, newUser.id]
      );

      // Re-fetch with profile joined
      const fresh = await pool.query(
        `SELECT u.id, u.email, u.full_name,
                p.role, p.department, p.avatar_url, p.preferences, p.org_id
         FROM users u
         LEFT JOIN profiles p ON p.user_id = u.id
         WHERE u.id = $1`,
        [newUser.id]
      );
      userRow = fresh.rows[0];
    }

    // Set session
    req.session.userId = userRow.id;
    req.session.email = userRow.email;
    req.session.role = userRow.role || 'viewer';
    req.session.fullName = userRow.full_name;

    res.redirect('/app');
  } catch (err) {
    req.log.error({ err }, '[microsoft/callback] error');
    res.redirect('/login?error=microsoft_auth_failed');
  }
});

module.exports = router;
