const { Router } = require('express');
const pool = require('../db/pool');

const router = Router();

// ══════════════════════════════════════════════════════════
// jf_submissions
// ══════════════════════════════════════════════════════════

// ── GET /api/submissions?form_id=xxx&status=pending ──
router.get('/submissions', async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (req.query.form_ids) {
      const ids = req.query.form_ids.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length > 0) {
        conditions.push(`form_id = ANY($${idx++})`);
        params.push(ids);
      }
    } else if (req.query.form_id) {
      conditions.push(`form_id = $${idx++}`);
      params.push(req.query.form_id);
    }
    if (req.query.status) {
      conditions.push(`status = $${idx++}`);
      params.push(req.query.status);
    }
    if (req.query.jotform_submission_id) {
      conditions.push(`jotform_submission_id = $${idx++}`);
      params.push(req.query.jotform_submission_id);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(parseInt(req.query.limit || '200'), 2000);
    const offset = parseInt(req.query.offset || '0');

    const { rows } = await pool.query(
      `SELECT * FROM jf_submissions ${where} ORDER BY submission_date ${order} LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── PUT /api/submissions/:id ──
// Update a submission row (used by DirectorDashboard for inline status updates)
router.put('/submissions/:jotformSubmissionId', async (req, res, next) => {
  try {
    const { jotformSubmissionId } = req.params;
    const updates = req.body;
    if (!updates || Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Build dynamic SET clause from allowed columns
    const ALLOWED = new Set([
      'current_level', 'status', 'approver_name', 'approver_email',
      'pending_approver_name', 'pending_approver_email', 'jotform_status',
      'priority', 'last_synced', 'needs_sync', 'submission_date',
    ]);
    const setClauses = [];
    const params = [];
    let idx = 1;

    for (const [key, val] of Object.entries(updates)) {
      if (ALLOWED.has(key)) {
        setClauses.push(`${key} = $${idx++}`);
        params.push(val);
      }
    }

    if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields' });

    params.push(jotformSubmissionId);
    await pool.query(
      `UPDATE jf_submissions SET ${setClauses.join(', ')} WHERE jotform_submission_id = $${idx}`,
      params
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
// jf_approval_history
// ══════════════════════════════════════════════════════════

// ── GET /api/approval-history?submission_id=xxx OR ?submission_ids=a,b,c ──
router.get('/approval-history', async (req, res, next) => {
  try {
    if (req.query.submission_ids) {
      const ids = req.query.submission_ids.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length === 0) return res.json([]);
      const { rows } = await pool.query(
        'SELECT * FROM jf_approval_history WHERE submission_id = ANY($1) ORDER BY submission_id, level',
        [ids]
      );
      return res.json(rows);
    }
    const submissionId = req.query.submission_id;
    if (!submissionId) return res.status(400).json({ error: 'submission_id required' });
    const { rows } = await pool.query(
      'SELECT * FROM jf_approval_history WHERE submission_id = $1 ORDER BY level',
      [submissionId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
// notifications
// ══════════════════════════════════════════════════════════

// ── GET /api/notifications?user_email=xxx ──
router.get('/notifications', async (req, res, next) => {
  try {
    const email = req.query.user_email;
    if (!email) return res.status(400).json({ error: 'user_email required' });
    const limit = parseInt(req.query.limit || '20');
    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE user_email = $1 ORDER BY created_at DESC LIMIT $2',
      [email, limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── PUT /api/notifications/read-all?user_email=xxx ──
router.put('/notifications/read-all', async (req, res, next) => {
  try {
    const email = req.query.user_email || req.body.user_email;
    if (!email) return res.status(400).json({ error: 'user_email required' });
    await pool.query(
      'UPDATE notifications SET read = true WHERE user_email = $1 AND read = false',
      [email]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── PUT /api/notifications/:id/read ──
router.put('/notifications/:id/read', async (req, res, next) => {
  try {
    await pool.query('UPDATE notifications SET read = true WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
// jf_signatures
// ══════════════════════════════════════════════════════════

// ── GET /api/signatures?submission_id=xxx&level=1 ──
router.get('/signatures', async (req, res, next) => {
  try {
    const { submission_id, level } = req.query;
    if (!submission_id) return res.status(400).json({ error: 'submission_id required' });

    let sql = 'SELECT * FROM jf_signatures WHERE submission_id = $1';
    const params = [submission_id];
    if (level) {
      sql += ' AND level = $2';
      params.push(Number(level));
    }
    sql += ' ORDER BY created_at DESC LIMIT 1';

    const { rows } = await pool.query(sql, params);
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

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
router.put('/profiles/:userId', async (req, res, next) => {
  try {
    const { userId } = req.params;
    const updates = req.body;
    const ALLOWED = new Set(['full_name', 'department', 'role', 'avatar_url', 'preferences']);
    const setClauses = [];
    const params = [];
    let idx = 1;

    for (const [key, val] of Object.entries(updates)) {
      if (ALLOWED.has(key)) {
        setClauses.push(`${key} = $${idx++}`);
        params.push(key === 'preferences' ? JSON.stringify(val) : val);
      }
    }
    if (setClauses.length === 0) return res.status(400).json({ error: 'No valid fields' });

    setClauses.push(`updated_at = now()`);
    params.push(userId);
    await pool.query(
      `UPDATE profiles SET ${setClauses.join(', ')} WHERE user_id = $${idx}`,
      params
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
// organizations
// ══════════════════════════════════════════════════════════

// ── GET /api/organizations/:id ──
router.get('/organizations/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM organizations WHERE id = $1', [req.params.id]);
    res.json(rows[0] || null);
  } catch (err) { next(err); }
});

// ── PUT /api/organizations/:id ──
router.put('/organizations/:id', async (req, res, next) => {
  try {
    const { name, settings, logo_url, branding, plan } = req.body;
    const setClauses = ['updated_at = now()'];
    const params = [];
    let idx = 1;

    if (name !== undefined) { setClauses.push(`name = $${idx++}`); params.push(name); }
    if (settings !== undefined) { setClauses.push(`settings = $${idx++}`); params.push(JSON.stringify(settings)); }
    if (logo_url !== undefined) { setClauses.push(`logo_url = $${idx++}`); params.push(logo_url); }
    if (branding !== undefined) { setClauses.push(`branding = $${idx++}`); params.push(JSON.stringify(branding)); }
    if (plan !== undefined) { setClauses.push(`plan = $${idx++}`); params.push(plan); }

    params.push(req.params.id);
    await pool.query(
      `UPDATE organizations SET ${setClauses.join(', ')} WHERE id = $${idx}`,
      params
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
// activity_log
// ══════════════════════════════════════════════════════════

// ── GET /api/activity-log?org_id=xxx ──
router.get('/activity-log', async (req, res, next) => {
  try {
    const orgId = req.query.org_id;
    // Activity log may not have org_id column; filter by user_email if needed
    const limit = parseInt(req.query.limit || '200');
    let sql, params;
    if (orgId) {
      // Join profiles to filter by org
      sql = `SELECT al.* FROM activity_log al
             JOIN profiles p ON p.user_id = al.user_id
             WHERE p.org_id = $1
             ORDER BY al.created_at DESC LIMIT $2`;
      params = [orgId, limit];
    } else {
      sql = 'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT $1';
      params = [limit];
    }
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/activity-log ──
router.post('/activity-log', async (req, res, next) => {
  try {
    const { user_id, user_email, action, entity_type, entity_id, details } = req.body;
    await pool.query(
      `INSERT INTO activity_log (user_id, user_email, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user_id || null, user_email || null, action, entity_type || null, entity_id || null, JSON.stringify(details || {})]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
// subscriptions (Billing page)
// ══════════════════════════════════════════════════════════

// ── PUT /api/subscriptions/:orgId ──
router.put('/subscriptions/:orgId', async (req, res, next) => {
  try {
    const { orgId } = req.params;
    const { plan, status } = req.body;

    // Update org plan
    if (plan) {
      await pool.query('UPDATE organizations SET settings = settings || $1, updated_at = now() WHERE id = $2',
        [JSON.stringify({ plan }), orgId]);
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
