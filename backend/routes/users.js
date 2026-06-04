const { Router } = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const env = require('../config/env');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = Router();
const SALT_ROUNDS = 12;
const ORG_ID = env.ORG_ID;
const VALID_ROLES = ['super_admin', 'admin', 'approver', 'viewer', 'user'];
// Configured at install time via the installer-generated backend/.env.
const ADMIN_EMAIL = env.ADMIN_EMAIL;

// ── POST /api/create-user ──
// Admin-only user creation (replaces Supabase auth.admin.createUser).
// Session must belong to an admin AND the legacy creatorEmail check below
// must also match the configured ADMIN_EMAIL — defense in depth.
router.post('/create-user', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const { email, password, fullName, department, role, creatorEmail } = req.body || {};

    // Only the configured admin (ADMIN_EMAIL) can create users
    if (!ADMIN_EMAIL || (creatorEmail || '').toLowerCase() !== ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Not authorized to create users' });
    }

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: 'Password must be 12–128 characters' });
    }

    // Check existing
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email already exists' });
    }

    const userRole = VALID_ROLES.includes(role) ? role : 'viewer';
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const name = fullName || email.split('@')[0];

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3) RETURNING id, email, full_name`,
      [email.toLowerCase(), hash, name]
    );
    const user = rows[0];

    // Create profile
    await pool.query(
      `INSERT INTO profiles (user_id, full_name, department, role, org_id, preferences)
       VALUES ($1, $2, $3, $4, $5, '{"theme":"dark","language":"en"}')`,
      [user.id, name, department || '', userRole, ORG_ID]
    );

    // Create org_member
    await pool.query(
      'INSERT INTO org_members (org_id, user_id, role) VALUES ($1, $2, $3)',
      [ORG_ID, user.id, userRole]
    );

    res.json({
      ok: true,
      user: { id: user.id, email: email.toLowerCase(), fullName: name, role: userRole, department: department || '' },
    });
  } catch (err) { next(err); }
});

// ── GET /api/setup-db ──
// M-6: Restricted to super_admin — exposes full DB schema which helps attackers.
const fs = require('fs');
const path = require('path');

router.get('/setup-db', requireAuth, requireRole('super_admin'), (req, res) => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  res.json({
    instructions: [
      '1. Ensure PostgreSQL 18 is running',
      '2. Create database: CREATE DATABASE jotflow;',
      '3. Run: cd backend && node db/migrate.js',
    ],
    sql,
  });
});

// ── POST /api/setup-db ──
// Runs the schema migration
router.post('/setup-db', requireAuth, requireRole('super_admin'), async (req, res, next) => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await pool.query(sql);
    res.json({ success: true, message: 'Schema applied successfully' });
  } catch (err) { next(err); }
});

module.exports = router;
