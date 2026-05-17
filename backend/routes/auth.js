const { Router } = require('express');
const bcrypt = require('bcrypt');
const msal = require('@azure/msal-node');
const pool = require('../db/pool');
const env = require('../config/env');

const router = Router();
const SALT_ROUNDS = 12;
const ORG_ID = '971589dd-afcb-4a12-8900-47626e4d59cc';

// ── Microsoft OAuth (MSAL) config ──
const msalConfig = {
  auth: {
    clientId: env.MICROSOFT_CLIENT_ID,
    authority: 'https://login.microsoftonline.com/common',
    clientSecret: env.MICROSOFT_CLIENT_SECRET,
  },
};
const msalClient = new msal.ConfidentialClientApplication(msalConfig);
const MS_SCOPES = ['openid', 'profile', 'email', 'User.Read'];

// ── POST /api/auth/signup ──
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, fullName, department } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Check existing
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const name = fullName || email.split('@')[0];

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3) RETURNING id, email, full_name, created_at`,
      [email.toLowerCase(), hash, name]
    );
    const user = rows[0];

    // Create profile
    await pool.query(
      `INSERT INTO profiles (user_id, full_name, department, role, org_id, preferences)
       VALUES ($1, $2, $3, 'viewer', $4, '{"theme":"dark","language":"en"}')`,
      [user.id, name, department || '', ORG_ID]
    );

    // Create org_member
    await pool.query(
      `INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, 'viewer')`,
      [ORG_ID, user.id]
    );

    // Set session
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.role = 'viewer';
    req.session.fullName = name;

    res.json({
      ok: true,
      user: { id: user.id, email: user.email, fullName: name, role: 'viewer' },
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/login ──
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.full_name,
              p.role, p.department, p.avatar_url, p.preferences, p.org_id
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.role = user.role || 'viewer';
    req.session.fullName = user.full_name;

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role || 'viewer',
        department: user.department || '',
        avatarUrl: user.avatar_url || '',
        preferences: user.preferences || {},
        orgId: user.org_id || null,
      },
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/logout ──
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// ── GET /api/auth/session ──
router.get('/session', async (req, res, next) => {
  try {
    if (!req.session || !req.session.userId) {
      return res.json({ user: null });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.full_name,
              p.role, p.department, p.avatar_url, p.preferences, p.org_id
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.session.userId]
    );

    if (rows.length === 0) {
      return res.json({ user: null });
    }

    const user = rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role || 'viewer',
        department: user.department || '',
        avatarUrl: user.avatar_url || '',
        preferences: user.preferences || {},
        orgId: user.org_id,
      },
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/reset-password ──
// MVP: logs reset URL to console; add SMTP later
router.post('/reset-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'email required' });

    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    // Always return success to avoid email enumeration
    if (rows.length === 0) {
      return res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
    }

    const { v4: uuidv4 } = require('uuid');
    const token = uuidv4();
    // TODO: store token in a password_resets table with expiry
    console.log(`[reset-password] Reset link for ${email}: /reset?token=${token}`);

    res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/verify-workspace-member ──
// Checks if an email belongs to the JotForm workspace
let memberCache = null;
const CACHE_TTL = 5 * 60 * 1000;

router.post('/verify-workspace-member', async (req, res, next) => {
  try {
    if (!env.JOTFORM_API_KEY) {
      return res.status(500).json({ error: 'JOTFORM_API_KEY not set', isMember: false });
    }

    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'email is required', isMember: false });
    }

    // Fetch & cache workspace members
    if (!memberCache || Date.now() - memberCache.fetchedAt > CACHE_TTL) {
      const url = `${env.JOTFORM_BASE}/users?apiKey=${env.JOTFORM_API_KEY}&teamID=${env.JOTFORM_TEAM_ID}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`JotForm API ${response.status}`);
      const data = await response.json();
      const raw = Array.isArray(data?.content) ? data.content : [];

      const emails = new Set();
      const members = new Map();
      for (const m of raw) {
        const e = String(m.email || '').trim().toLowerCase();
        const status = String(m.status || '').toUpperCase();
        if (!e || status !== 'ACTIVE') continue;
        emails.add(e);
        members.set(e, {
          name: String(m.name || m.username || ''),
          email: e,
          status,
        });
      }
      memberCache = { emails, members, fetchedAt: Date.now() };
    }

    const isMember = memberCache.emails.has(email);
    const member = isMember ? memberCache.members.get(email) : null;
    res.json({ isMember, member, totalMembers: memberCache.emails.size });
  } catch (err) {
    console.error('verify-workspace-member error:', err);
    res.status(502).json({ error: 'Failed to verify workspace membership', isMember: false });
  }
});

// ── GET /api/auth/microsoft — Redirect to Microsoft login ──
// Uses HTML meta-refresh instead of 302 to avoid IIS ARR rewriting the Location header
router.get('/microsoft', async (req, res) => {
  if (!env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_REDIRECT_URI) {
    return res.redirect('/login?error=microsoft_not_configured');
  }
  try {
    const authUrl = await msalClient.getAuthCodeUrl({
      scopes: MS_SCOPES,
      redirectUri: env.MICROSOFT_REDIRECT_URI,
    });
    res.send(`<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=${authUrl}"><script>window.location.href="${authUrl}";</script></head><body>Redirecting to Microsoft…</body></html>`);
  } catch (err) {
    console.error('[microsoft] auth URL error:', err);
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
    const tokenResponse = await msalClient.acquireTokenByCode({
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
    console.error('[microsoft/callback] error:', err);
    res.redirect('/login?error=microsoft_auth_failed');
  }
});

module.exports = router;
