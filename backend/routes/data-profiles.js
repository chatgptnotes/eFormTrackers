const { Router } = require('express');
const pool = require('../db/pool');
const { validate } = require('../middleware/validate');
const { buildUpdateQuery } = require('../db/queryBuilder');
const { requireAuth } = require('../middleware/auth');
const { isAdminRole } = require('../lib/visibility');
const { profilesPutBodySchema } = require('../schemas/data');

const router = Router();

router.use(requireAuth);

// ══════════════════════════════════════════════════════════
// profiles
// ══════════════════════════════════════════════════════════

// ── GET /api/profiles?user_id=xxx ──
// H-7: Users may only read their own profile; admins may read any.
router.get('/profiles', async (req, res, next) => {
  try {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id required' });
    const isAdmin = isAdminRole(req.session.role);
    if (!isAdmin && userId !== req.session.userId) {
      return res.status(403).json({ error: 'Not authorized to view this profile' });
    }
    const { rows } = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [userId]);
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

// ── PUT /api/profiles/:userId ──
const PROFILES_ALLOWED = ['full_name', 'department', 'role', 'avatar_url', 'preferences'];

router.put('/profiles/:userId', validate(profilesPutBodySchema), async (req, res, next) => {
  try {
    const { userId } = req.params;
    // Authorization: a user may edit only their own profile; admins may edit any.
    // Critically, the `role` field can elevate privileges, so without this check
    // any user could promote themselves to admin by PUTting their own role.
    const isAdmin = isAdminRole(req.session.role);
    if (!isAdmin && req.session.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to modify this profile' });
    }
    // Non-admins also cannot change their own role.
    if (!isAdmin && Object.prototype.hasOwnProperty.call(req.body || {}, 'role')) {
      return res.status(403).json({ error: 'Role changes require admin' });
    }

    const { sql, params, fields } = buildUpdateQuery(req.body, PROFILES_ALLOWED, {
      jsonColumns: ['preferences'],
    });
    if (fields.length === 0) return res.status(400).json({ error: 'No valid fields' });

    await pool.query(
      `UPDATE profiles SET ${sql}, updated_at = now() WHERE user_id = $${params.length + 1}`,
      [...params, userId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
