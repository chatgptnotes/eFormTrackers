const { Router } = require('express');
const pool = require('../db/pool');
const { validate } = require('../middleware/validate');
const { buildUpdateQuery } = require('../db/queryBuilder');
const { profilesPutBodySchema } = require('../schemas/data');

const router = Router();

// ══════════════════════════════════════════════════════════
// profiles
// ══════════════════════════════════════════════════════════

// ── GET /api/profiles?user_id=xxx ──
router.get('/profiles', async (req, res, next) => {
  try {
    const userId = req.query.user_id;
    if (!userId) return res.status(400).json({ error: 'user_id required' });
    const { rows } = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [userId]);
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

// ── PUT /api/profiles/:userId ──
const PROFILES_ALLOWED = ['full_name', 'department', 'role', 'avatar_url', 'preferences'];

router.put('/profiles/:userId', validate(profilesPutBodySchema), async (req, res, next) => {
  try {
    const { userId } = req.params;
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
