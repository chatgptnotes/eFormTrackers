const { Router } = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const env = require('../config/env');
const { validate } = require('../middleware/validate');
const { checkWorkspaceMember } = require('../lib/workspace');
const { pollOnce } = require('../lib/poller');
const {
  signupBodySchema,
  loginBodySchema,
  resetPasswordBodySchema,
  confirmResetBodySchema,
  verifyWorkspaceMemberBodySchema,
} = require('../schemas/auth');

const router = Router();
const SALT_ROUNDS = 12;
const ORG_ID = env.ORG_ID;

// ── POST /api/auth/signup ──
router.post('/signup', validate(signupBodySchema), async (req, res, next) => {
  try {
    const { email, password, fullName, department } = req.body;

    // C-2: Enforce workspace membership before creating any account (same gate as login)
    let membership;
    try {
      membership = await checkWorkspaceMember(email.toLowerCase());
    } catch (err) {
      if (err.code === 'NO_API_KEY') return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });
      req.log.error({ err }, 'signup workspace-membership check failed');
      return res.status(502).json({ error: 'Failed to verify workspace membership' });
    }
    if (!membership.isMember) {
      return res.status(403).json({ error: 'not_workspace_member' });
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
router.post('/login', validate(loginBodySchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;

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

    // Enforce JotForm workspace membership server-side. Fail closed: a
    // membership-check failure must NOT let a non-verified user in.
    let membership;
    try {
      membership = await checkWorkspaceMember(user.email);
    } catch (err) {
      if (err.code === 'NO_API_KEY') {
        return res.status(500).json({ error: 'JOTFORM_API_KEY not set' });
      }
      req.log.error({ err }, 'login workspace-membership check failed');
      return res.status(502).json({ error: 'Failed to verify workspace membership' });
    }
    if (!membership.isMember) {
      return res.status(403).json({ error: 'not_workspace_member' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.email = user.email;
    req.session.role = user.role || 'viewer';
    req.session.fullName = user.full_name;

    // Trigger a background sync so the dashboard has fresh data immediately.
    // pollOnce() is guarded by isRunning so concurrent logins don't stack up.
    pollOnce().catch(err => req.log.warn({ err }, '[login] background sync error'));

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
    res.clearCookie('msal.interaction.status');
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
    req.session.email = user.email;
    req.session.role = user.role || 'viewer';
    req.session.fullName = user.full_name;
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
// Stores a one-time token in password_resets (1-hour expiry).
// In production configure SMTP to deliver the link; for now the reset URL
// is returned in the response (internal gov tool — IT can share with user).
router.post('/reset-password', validate(resetPasswordBodySchema), async (req, res, next) => {
  try {
    const { email } = req.body;
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    // Always return success to avoid email enumeration
    if (rows.length === 0) {
      return res.json({ ok: true, message: 'If that email exists, a reset link has been sent.' });
    }

    // L-1: Use crypto.randomBytes for a 256-bit token (stronger than UUID v4).
    const { randomBytes } = require('crypto');
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // Invalidate any existing unused tokens for this user, then store the new one
    await pool.query(
      'DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL',
      [rows[0].id]
    );
    await pool.query(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [rows[0].id, token, expiresAt.toISOString()]
    );

    // C-1: Never return the token in the API response or logs — deliver only via SMTP.
    req.log.info({ email }, '[reset-password] Reset token generated');
    res.json({
      ok: true,
      message: 'If that email exists, a reset link has been sent.',
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/reset-password/confirm ──
// Validates token, updates password_hash, marks token used.
router.post('/reset-password/confirm', validate(confirmResetBodySchema), async (req, res, next) => {
  try {
    const { token, password } = req.body;

    const { rows } = await pool.query(
      `SELECT pr.id, pr.user_id, pr.expires_at, pr.used_at
       FROM password_resets pr WHERE pr.token = $1`,
      [token]
    );

    if (rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token.' });
    }

    const reset = rows[0];
    if (reset.used_at) {
      return res.status(400).json({ error: 'This reset link has already been used.' });
    }
    if (new Date(reset.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, reset.user_id]);
    await pool.query('UPDATE password_resets SET used_at = now() WHERE id = $1', [reset.id]);

    res.json({ ok: true, message: 'Password updated successfully. You can now sign in.' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/verify-workspace-member ──
// M-3: Requires auth — unauthenticated access allows arbitrary email enumeration.
const { requireAuth } = require('../middleware/auth');
router.post('/verify-workspace-member', requireAuth, validate(verifyWorkspaceMemberBodySchema), async (req, res, next) => {
  try {
    const result = await checkWorkspaceMember(req.body.email);
    const payload = {
      isMember: result.isMember,
      member: result.member,
      totalMembers: result.totalMembers,
    };
    // Only surface devBypass in the dev short-circuit path (matches old behavior).
    if (result.devBypass) payload.devBypass = true;
    res.json(payload);
  } catch (err) {
    if (err.code === 'NO_API_KEY') {
      return res.status(500).json({ error: 'JOTFORM_API_KEY not set', isMember: false });
    }
    req.log.error({ err }, 'verify-workspace-member error');
    res.status(502).json({ error: 'Failed to verify workspace membership', isMember: false });
  }
});

module.exports = router;
