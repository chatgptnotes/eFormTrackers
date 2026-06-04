const express = require('express');
const pool = require('../db/pool');
const router = express.Router();

// GET /api/email-logs?submission_id=&assignee_email=&form_id=&limit=&offset=
router.get('/', async (req, res) => {
  const { submission_id, assignee_email, form_id, limit = 100, offset = 0 } = req.query;
  const conditions = [];
  const params = [];

  if (submission_id) { params.push(submission_id); conditions.push(`submission_id = $${params.length}`); }
  if (assignee_email) { params.push(assignee_email); conditions.push(`assignee_email ILIKE $${params.length}`); }
  if (form_id)        { params.push(form_id);        conditions.push(`form_id = $${params.length}`); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  params.push(parseInt(limit) || 100, parseInt(offset) || 0);

  try {
    const { rows } = await pool.query(
      `SELECT * FROM email_logs ${where} ORDER BY assigned_at DESC NULLS LAST, created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) FROM email_logs ${where}`,
      params.slice(0, params.length - 2)
    );
    res.json({ total: parseInt(countRows[0].count), rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
