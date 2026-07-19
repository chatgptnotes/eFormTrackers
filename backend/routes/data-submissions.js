const { Router } = require('express');
const pool = require('../db/pool');
const { validate } = require('../middleware/validate');
const { buildUpdateQuery } = require('../db/queryBuilder');
const { requireAuth } = require('../middleware/auth');
const { isRowVisible, filterVisibleRows, isAdminRole } = require('../lib/visibility');
const { readKeyType } = require('../lib/key-type');
const { storageProfileId } = require('../lib/profiles');
const { submissionsPutBodySchema } = require('../schemas/data');

const router = Router();

// All endpoints in this router read or mutate per-user data. Require a session.
router.use(requireAuth);

// Columns returned by the submissions list read. This is every jf_submissions
// column EXCEPT `raw_data` — the largest column by far (the entire original
// JotForm submission, including every answer's metadata). The frontend list,
// stats, charts, search, and the server-side visibility filter never read
// raw_data; mapSupabaseRow only touched raw_data._mapped as a fallback for
// level_history/email/amount, all of which exist as their own columns here.
// Dropping it cuts the payload of a 20k-row read dramatically.
const SUBMISSION_LIST_COLUMNS = [
  'id', 'jotform_submission_id', 'form_id', 'form_title', 'title', 'description',
  'submitted_by', 'submitter_name', 'submitter_email', 'department',
  'submission_date', 'current_level', 'status', 'priority', 'amount',
  'approver_name', 'approver_email', 'pending_approver_name', 'pending_approver_email',
  'jotform_status', 'answers', 'workflow_tasks', 'level_history', 'edit_link',
  'approval_url', 'needs_sync', 'created_at_jf', 'updated_at_jf',
  'days_at_level', 'total_days', 'last_synced', 'created_at', 'updated_at',
].join(', ');

// ══════════════════════════════════════════════════════════
// jf_submissions
// ══════════════════════════════════════════════════════════

// ── GET /api/submissions?form_id=xxx&status=pending ──
router.get('/submissions', async (req, res, next) => {
  try {
    const conditions = [];
    const params = [];
    let idx = 1;
    const adminView = isAdminRole(req.session.role);
    const profileId = storageProfileId(readKeyType(req));
    const allTeamWorkspaces = String(req.session.role || '').toLowerCase() === 'super_admin' &&
      !String(readKeyType(req)).includes('__team_');

    if (adminView) {
      // Admins browse one selected workspace. Normal users browse "my work"
      // across all team workspaces, then the visibility gate below enforces it.
      const profileParam = idx++;
      conditions.push(allTeamWorkspaces
        ? `(profile_id = $${profileParam} OR profile_id LIKE $${profileParam} || '__team_%')`
        : `profile_id = $${profileParam}`);
      params.push(profileId);

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
    } else {
      const email = String(req.session.email || '').toLowerCase();
      // Normal users see their work in the selected workspace only; the email
      // participation filter remains the access boundary within that workspace.
      conditions.push(`profile_id = $${idx++}`);
      params.push(profileId);
      conditions.push(`(
        lower(coalesce(submitter_email, '')) = $${idx}
        OR lower(coalesce(pending_approver_email, '')) = $${idx}
        OR lower(coalesce(approver_email, '')) = $${idx}
        OR lower(workflow_tasks::text) LIKE $${idx + 1}
        OR lower(level_history::text) LIKE $${idx + 1}
      )`);
      params.push(email, `%${email}%`);
      idx += 2;
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
    const limit = Math.min(parseInt(req.query.limit || '20000', 10) || 20000, 20000);
    const offset = parseInt(req.query.offset || '0', 10) || 0;

    const { rows } = await pool.query(
      `SELECT ${SUBMISSION_LIST_COLUMNS} FROM jf_submissions ${where} ORDER BY submission_date ${order} LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );
    res.setHeader('Cache-Control', 'no-store');
    res.json(filterVisibleRows(rows, req.session.email, req.session.role));
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

    // Authorization: only a user who can SEE this submission (admin, or a
    // participant — submitter/approver/assignee) may mutate it. Without this any
    // authenticated user could change any submission's status/approver/level.
    const { rows } = await pool.query(
      `SELECT ${SUBMISSION_LIST_COLUMNS} FROM jf_submissions WHERE jotform_submission_id = $1`,
      [jotformSubmissionId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Submission not found' });
    if (!isRowVisible(rows[0], req.session.email, req.session.role)) {
      return res.status(403).json({ error: 'Not authorized to modify this submission' });
    }

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
    // Compute the set of jotform submission ids this user participates in, then
    // filter history rows (jf_approval_history.submission_id is the jotform
    // submission id). Admins see all history; everyone else is participation-only.
    const filterHistory = async (historyRows, requestedIds) => {
      const { rows: parents } = await pool.query(
        'SELECT * FROM jf_submissions WHERE jotform_submission_id = ANY($1)',
        [requestedIds]
      );
      const visibleIds = new Set(
        parents
          .filter((p) => isRowVisible(p, req.session.email, req.session.role))
          .map((p) => String(p.jotform_submission_id))
      );
      return historyRows.filter((h) => visibleIds.has(String(h.submission_id)));
    };

    if (req.query.submission_ids) {
      const ids = req.query.submission_ids.split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length === 0) return res.json([]);
      const { rows } = await pool.query(
        'SELECT * FROM jf_approval_history WHERE submission_id = ANY($1) ORDER BY submission_id, level',
        [ids]
      );
      return res.json(await filterHistory(rows, ids));
    }
    const submissionId = req.query.submission_id;
    if (!submissionId) return res.status(400).json({ error: 'submission_id required' });
    const { rows } = await pool.query(
      'SELECT * FROM jf_approval_history WHERE submission_id = $1 ORDER BY level',
      [submissionId]
    );
    res.json(await filterHistory(rows, [submissionId]));
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
// notifications
// ══════════════════════════════════════════════════════════

// ── GET /api/notifications ──
// Always scoped to the logged-in user; any user_email query param is ignored.
// Previously took ?user_email and let any user read anyone's notifications.
router.get('/notifications', async (req, res, next) => {
  try {
    const email = req.session.email;
    if (!email) return res.status(401).json({ error: 'Not authenticated' });
    const limit = Math.min(parseInt(req.query.limit || '20', 10) || 20, 200);
    const { rows } = await pool.query(
      'SELECT * FROM notifications WHERE user_email = $1 ORDER BY created_at DESC LIMIT $2',
      [email, limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── PUT /api/notifications/read-all ──
// Marks the logged-in user's notifications as read. user_email query/body ignored.
router.put('/notifications/read-all', async (req, res, next) => {
  try {
    const email = req.session.email;
    if (!email) return res.status(401).json({ error: 'Not authenticated' });
    await pool.query(
      'UPDATE notifications SET read = true WHERE user_email = $1 AND read = false',
      [email]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── PUT /api/notifications/:id/read ──
// Only the notification's recipient may mark it read.
router.put('/notifications/:id/read', async (req, res, next) => {
  try {
    const email = req.session.email;
    if (!email) return res.status(401).json({ error: 'Not authenticated' });
    const { rowCount } = await pool.query(
      'UPDATE notifications SET read = true WHERE id = $1 AND user_email = $2',
      [req.params.id, email]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Not found or not yours' });
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

    // Users may only read signatures for submissions they participate in.
    const { rows: parents } = await pool.query(
      'SELECT * FROM jf_submissions WHERE jotform_submission_id = $1',
      [submission_id]
    );
    const parent = parents[0];
    if (!parent || !isRowVisible(parent, req.session.email, req.session.role)) {
      return res.json(null);
    }

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
