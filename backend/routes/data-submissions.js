const { Router } = require('express');
const pool = require('../db/pool');
const { validate } = require('../middleware/validate');
const { buildUpdateQuery } = require('../db/queryBuilder');
const { submissionsPutBodySchema } = require('../schemas/data');

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
const SUBMISSIONS_ALLOWED = [
  'current_level', 'status', 'approver_name', 'approver_email',
  'pending_approver_name', 'pending_approver_email', 'jotform_status',
  'priority', 'last_synced', 'needs_sync', 'submission_date',
];

router.put('/submissions/:jotformSubmissionId', validate(submissionsPutBodySchema), async (req, res, next) => {
  try {
    const { jotformSubmissionId } = req.params;
    const { sql, params, fields } = buildUpdateQuery(req.body, SUBMISSIONS_ALLOWED);

    if (fields.length === 0) return res.status(400).json({ error: 'No valid fields' });

    await pool.query(
      `UPDATE jf_submissions SET ${sql} WHERE jotform_submission_id = $${params.length + 1}`,
      [...params, jotformSubmissionId]
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

module.exports = router;
