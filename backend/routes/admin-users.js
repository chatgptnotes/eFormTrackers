const { Router } = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { readKeyType } = require('../lib/key-type');
const { runUserSync } = require('../lib/user-sync');

const router = Router();
router.use(requireAuth, requireRole('admin'));

// GET /api/admin/users?q=&account_type=&limit=&offset=  — directory for the active profile
router.get('/', async (req, res, next) => {
  try {
    const profileId = readKeyType(req);
    const { q, account_type } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;

    const conditions = ['profile_id = $1'];
    const params = [profileId];
    if (q)            { params.push(`%${q}%`);     conditions.push(`(name ILIKE $${params.length} OR email ILIKE $${params.length} OR username ILIKE $${params.length})`); }
    if (account_type) { params.push(account_type); conditions.push(`account_type = $${params.length}`); }
    const where = 'WHERE ' + conditions.join(' AND ');

    const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM jf_users ${where}`, params);
    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT jf_id, username, email, name, account_type, status, avatar_url, last_login, created_at_jf, synced_at
       FROM jf_users ${where}
       ORDER BY lower(name) ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ total: parseInt(countRows[0].count, 10), rows });
  } catch (err) { next(err); }
});

// GET /api/admin/users/:id — one user, full raw payload
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM jf_users WHERE profile_id = $1 AND jf_id = $2',
      [readKeyType(req), req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// POST /api/admin/users/refresh — force a directory sync for the active profile
router.post('/refresh', async (req, res, next) => {
  try {
    const result = await runUserSync({ profileId: readKeyType(req), force: true });
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;
