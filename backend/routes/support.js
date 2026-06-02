const { Router } = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { mutationLimiter } = require('../middleware/rateLimit');

const router = Router();

// ── POST /api/support-message ──
// M-8: Requires auth + rate limit to prevent DB spam.
router.post('/support-message', requireAuth, mutationLimiter, async (req, res, next) => {
  try {
    const { name, email, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ error: 'name, email, and message are required' });
    }

    const userId = req.session?.userId || null;

    await pool.query(
      `INSERT INTO support_messages (name, email, message, user_id) VALUES ($1, $2, $3, $4)`,
      [String(name).slice(0, 200), String(email).slice(0, 200), String(message).slice(0, 5000), userId]
    );

    // Also log to activity_log so admins see it in the Activity Log page
    const userEmail = req.session?.email || email;
    await pool.query(
      `INSERT INTO activity_log (user_id, user_email, action, entity_type, details)
       VALUES ($1, $2, 'support_message', 'support', $3)`,
      [userId, userEmail, JSON.stringify({ name, email: String(email), message: String(message).slice(0, 500) })]
    ).catch(() => {}); // non-blocking

    res.json({ ok: true, message: 'Support message received. We will get back to you within 24 hours.' });
  } catch (err) { next(err); }
});

// ── GET /api/support-messages ── (admin-only)
router.get('/support-messages', requireAuth, async (req, res, next) => {
  try {
    const role = req.session?.role;
    if (role !== 'super_admin' && role !== 'admin') {
      return res.status(403).json({ error: 'Admins only' });
    }
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const { rows } = await pool.query(
      'SELECT * FROM support_messages ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
