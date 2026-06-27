const { Router } = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { runEmailArchive } = require('../lib/email-archiver');
const { extractActionLinks } = require('../lib/email-parse');
const { readKeyType } = require('../lib/key-type');

const router = Router();

// Admin-only: this is the workspace-wide "All Emails" archive. Unlike
// /api/my-workflow-emails (scoped to the logged-in user), it exposes every
// email JotForm sent, so it must be gated to admin / super_admin.
router.use(requireAuth, requireRole('admin'));

// GET /api/admin/emails?q=&to=&submission_id=&from=&to_date=&limit=&offset=
router.get('/', async (req, res, next) => {
  try {
    const { q, to, submission_id, form_id, recipient_email, from: fromDate, to_date: toDate } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;

    const conditions = [];
    const params = [];
    // Scope to the active profile so each API's emails stay separate.
    params.push(readKeyType(req)); conditions.push(`profile_id = $${params.length}`);
    if (q)             { params.push(`%${q}%`);          conditions.push(`(subject ILIKE $${params.length} OR preview ILIKE $${params.length} OR to_addr ILIKE $${params.length})`); }
    if (to)            { params.push(`%${to}%`);         conditions.push(`to_addr ILIKE $${params.length}`); }
    if (recipient_email) { params.push(`%${recipient_email}%`); conditions.push(`recipient_email ILIKE $${params.length}`); }
    if (submission_id) { params.push(submission_id);     conditions.push(`submission_id = $${params.length}`); }
    if (form_id)       { params.push(form_id);           conditions.push(`form_id = $${params.length}`); }
    if (fromDate)      { params.push(fromDate);          conditions.push(`sent_at >= $${params.length}`); }
    if (toDate)        { params.push(toDate);            conditions.push(`sent_at <= $${params.length}`); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

    const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM jf_email_archive ${where}`, params);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT email_id, submission_id, form_id, form_title, email_type,
              recipient_email, recipient_emails, recipient_user_jf_id, recipient_user_name,
              to_addr, from_addr, subject, preview, action_links, sent_at
       FROM jf_email_archive ${where}
       ORDER BY sent_at DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ total: parseInt(countRows[0].count, 10), rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/emails/:emailId — full body + action links
router.get('/:emailId', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM jf_email_archive WHERE profile_id = $1 AND email_id = $2', [readKeyType(req), req.params.emailId]);
    if (!rows[0]) return res.status(404).json({ error: 'Email not found' });
    const row = rows[0];
    res.json({
      ...row,
      actionLinks: Array.isArray(row.action_links) ? row.action_links : extractActionLinks(row.body_html),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/emails/refresh — force an immediate archive pass
router.post('/refresh', async (req, res, next) => {
  try {
    const result = await runEmailArchive({ force: true });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
