const { Router } = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../middleware/auth');
const { readKeyType } = require('../lib/key-type');
const { syncJotformMailSender } = require('../lib/jotform-mail-sender');

const router = Router();

router.use(requireAuth, requireRole('admin'));

// GET /api/admin/mail-sender?q=&to=&from=&from_date=&to_date=&limit=&offset=
router.get('/', async (req, res, next) => {
  try {
    const {
      q,
      to,
      from,
      from_date: fromDate,
      to_date: toDate,
      account_email: accountEmail,
    } = req.query;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const offset = parseInt(req.query.offset, 10) || 0;
    const params = [readKeyType(req)];
    const conditions = [`profile_id = $1`];

    if (accountEmail) {
      params.push(String(accountEmail).toLowerCase());
      conditions.push(`account_email = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(subject ILIKE $${params.length} OR preview ILIKE $${params.length} OR to_addr ILIKE $${params.length} OR from_addr ILIKE $${params.length})`);
    }
    if (to) {
      params.push(`%${to}%`);
      conditions.push(`to_addr ILIKE $${params.length}`);
    }
    if (from) {
      params.push(`%${from}%`);
      conditions.push(`from_addr ILIKE $${params.length}`);
    }
    if (fromDate) {
      params.push(fromDate);
      conditions.push(`sent_at >= $${params.length}`);
    }
    if (toDate) {
      params.push(toDate);
      conditions.push(`sent_at <= $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const { rows: countRows } = await pool.query(`SELECT COUNT(*) FROM jotform_mail_sender ${where}`, params);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT account_email, mailbox, uid_validity, message_uid, message_id,
              email_id, thread_id, subject, from_addr, to_addr, cc_addr, bcc_addr,
              recipient_emails, sent_at, internal_date, size_bytes, preview,
              action_links, attachments, body_synced, sync_error, synced_at
         FROM jotform_mail_sender
         ${where}
        ORDER BY sent_at DESC NULLS LAST, message_uid DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    res.json({ total: parseInt(countRows[0].count, 10), rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/mail-sender/:uidValidity/:messageUid
router.get('/:uidValidity/:messageUid', async (req, res, next) => {
  try {
    const accountEmail = String(req.query.account_email || '').trim().toLowerCase();
    const params = [
      readKeyType(req),
      req.params.uidValidity,
      req.params.messageUid,
    ];
    const conditions = [
      `profile_id = $1`,
      `uid_validity = $2`,
      `message_uid = $3`,
    ];
    if (accountEmail) {
      params.push(accountEmail);
      conditions.push(`account_email = $${params.length}`);
    }
    const { rows } = await pool.query(
      `SELECT *
         FROM jotform_mail_sender
        WHERE ${conditions.join(' AND ')}
        LIMIT 1`,
      params,
    );
    if (!rows[0]) return res.status(404).json({ error: 'Sent mail not found' });
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/mail-sender/sync?limit=500&full=0
router.post('/sync', async (req, res, next) => {
  try {
    const limit = req.query.all === '1'
      ? 0
      : (req.query.limit == null ? undefined : parseInt(req.query.limit, 10));
    const result = await syncJotformMailSender({
      profileId: readKeyType(req),
      limit,
      full: req.query.full === '1',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
