const { Router } = require('express');
const msal = require('@azure/msal-node');
const pool = require('../db/pool');
const env = require('../config/env');
const { checkWorkspaceMember } = require('../lib/workspace');

const router = Router();
// L-3: Use env.ORG_ID to stay in sync with auth-local.js.
const ORG_ID = env.ORG_ID;

// ── Microsoft OAuth (MSAL) config ──
// Use tenant-specific authority when TENANT_ID is set — blocks personal Microsoft
// accounts and non-GDMO users before they even reach the JotForm workspace gate.
const MS_AUTHORITY = env.MICROSOFT_TENANT_ID
  ? `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}`
  : 'https://login.microsoftonline.com/common';

const msalConfig = {
  auth: {
    clientId: env.MICROSOFT_CLIENT_ID,
    authority: MS_AUTHORITY,
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
  },
};

let _msalClient = null;
function getMsalClient() {
  if (!_msalClient) {
    _msalClient = new msal.ConfidentialClientApplication(msalConfig);
  }
  return _msalClient;
}

// Scopes: openid/profile/email for identity; User.Read for Microsoft Graph /me
// (department, jobTitle, displayName, mail — enriches the user profile in DB).
const MS_SCOPES = ['openid', 'profile', 'email', 'User.Read'];

// Pick redirect URI: dev uses localhost, production uses the configured URI.
function getRedirectUri() {
  return env.NODE_ENV !== 'production' && env.MICROSOFT_REDIRECT_URI_DEV
    ? env.MICROSOFT_REDIRECT_URI_DEV
    : env.MICROSOFT_REDIRECT_URI;
}

// Fetch the user's full profile from Microsoft Graph using the access token.
// Returns null if the call fails (non-fatal — we fall back to ID token claims).
async function fetchGraphProfile(accessToken) {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName,jobTitle,department,officeLocation,id', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Map JotForm workspace accountType to app role:
//   ADMIN  → 'admin'    (workspace admin can manage everything)
//   USER   → 'approver' (workspace members are approvers by default)
// Never downgrades an existing role — only elevates if the stored role is weaker.
function roleFromAccountType(accountType, existingRole) {
  const jfRole = String(accountType || '').toUpperCase() === 'ADMIN' ? 'admin' : 'approver';
  const hierarchy = { super_admin: 4, admin: 3, approver: 2, viewer: 1, user: 1 };
  const existing = existingRole || 'viewer';
  return (hierarchy[jfRole] || 1) > (hierarchy[existing] || 1) ? jfRole : existing;
}

// ── GET /api/auth/microsoft — Redirect to Microsoft login ──
// Uses HTML meta-refresh instead of 302 to avoid IIS ARR rewriting Location header.
router.get('/microsoft', async (req, res) => {
  if (!env.MICROSOFT_CLIENT_ID || !getRedirectUri()) {
    return res.redirect('/login?error=microsoft_not_configured');
  }
  try {
    const authUrl = await getMsalClient().getAuthCodeUrl({
      scopes: MS_SCOPES,
      redirectUri: getRedirectUri(),
      prompt: 'select_account',
    });
    // meta-refresh needs HTML-escaped URL; script needs raw URL as a JSON string literal.
    const safeUrl = authUrl.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    res.send(
      `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${safeUrl}">` +
      `<script>window.location.href=${JSON.stringify(authUrl)};</script></head>` +
      `<body>Redirecting to Microsoft…</body></html>`
    );
  } catch (err) {
    req.log.error({ err }, '[microsoft] auth URL error');
    res.redirect('/login?error=microsoft_auth_failed');
  }
});

// ── GET /api/auth/microsoft/callback ──
router.get('/microsoft/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.redirect('/login?error=microsoft_auth_failed');
  }

  try {
    // 1. Exchange authorization code for tokens
    const tokenResponse = await getMsalClient().acquireTokenByCode({
      code: String(code),
      scopes: MS_SCOPES,
      redirectUri: getRedirectUri(),
    });

    // 2. Extract email from ID token claims
    const claims = tokenResponse.idTokenClaims || {};
    const emailFromToken = (claims.preferred_username || claims.email || '').toLowerCase().trim();

    // 3. Call Microsoft Graph /me for the full profile
    //    Gives us department, jobTitle, displayName — more reliable than ID token alone.
    const graphProfile = await fetchGraphProfile(tokenResponse.accessToken);
    req.log.info({ graphProfile: graphProfile ? { mail: graphProfile.mail, dept: graphProfile.department, jobTitle: graphProfile.jobTitle } : null }, '[microsoft/callback] graph profile');

    // Prefer Graph mail/UPN over ID token (Graph is the authoritative source)
    const email = (
      (graphProfile?.mail || graphProfile?.userPrincipalName || emailFromToken)
    ).toLowerCase().trim();
    const displayName = graphProfile?.displayName || claims.name || email.split('@')[0];
    const department = graphProfile?.department || '';
    const jobTitle = graphProfile?.jobTitle || '';

    if (!email) {
      return res.redirect('/login?error=microsoft_no_email');
    }

    // 4. JotForm workspace membership gate — MUST pass before session is issued
    let workspace;
    try {
      workspace = await checkWorkspaceMember(email);
    } catch (err) {
      req.log.error({ err }, '[microsoft/callback] workspace check failed');
      return res.redirect('/login?error=workspace_check_failed');
    }
    if (!workspace.isMember) {
      req.log.warn({ email }, '[microsoft/callback] not a workspace member');
      return res.redirect('/login?error=not_workspace_member');
    }

    // 5. Determine role: use JotForm accountType to assign appropriate level.
    //    New users get the role derived from accountType; existing users are only
    //    elevated (never downgraded) so manual admin promotions are preserved.
    const jfAccountType = workspace.member?.accountType || 'USER';

    // 6. Find or create user in DB
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

      // Update display name + department from latest Graph data on every login.
      // Never overwrite a manually-set role to a weaker one.
      const updatedRole = roleFromAccountType(jfAccountType, userRow.role);
      await pool.query(
        `UPDATE profiles SET full_name = $1, department = CASE WHEN $2 = '' THEN department ELSE $2 END,
         role = $3, updated_at = now() WHERE user_id = $4`,
        [displayName, department, updatedRole, userRow.id]
      );
      // Sync display name on users table too
      await pool.query(
        'UPDATE users SET full_name = $1, updated_at = now() WHERE id = $2',
        [displayName, userRow.id]
      );
      userRow.role = updatedRole;
    } else {
      // New user — create with role derived from JotForm workspace accountType
      const newRole = roleFromAccountType(jfAccountType, 'viewer');

      const ins = await pool.query(
        `INSERT INTO users (email, password_hash, full_name)
         VALUES ($1, $2, $3) RETURNING id, email, full_name`,
        [email, '__microsoft_oauth__', displayName]
      );
      const newUser = ins.rows[0];

      await pool.query(
        `INSERT INTO profiles (user_id, full_name, department, role, org_id, preferences)
         VALUES ($1, $2, $3, $4, $5, '{"theme":"dark","language":"en"}')`,
        [newUser.id, displayName, department, newRole, ORG_ID]
      );
      await pool.query(
        `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, $3)`,
        [ORG_ID, newUser.id, newRole]
      );

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

    // 7. Set session
    req.session.userId = userRow.id;
    req.session.email = userRow.email;
    req.session.role = userRow.role || 'approver';
    req.session.fullName = userRow.full_name;

    req.log.info({
      email: userRow.email,
      role: userRow.role,
      department: userRow.department,
      jfAccountType,
    }, '[microsoft/callback] login success');

    res.redirect('/app');
  } catch (err) {
    req.log.error({ err }, '[microsoft/callback] error');
    res.redirect('/login?error=microsoft_auth_failed');
  }
});

module.exports = router;
