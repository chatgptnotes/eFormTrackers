const { Router } = require('express');
const pool = require('../db/pool');
const { validate } = require('../middleware/validate');
const { buildUpdateQuery } = require('../db/queryBuilder');
const {
  organizationsPutBodySchema,
  activityLogPostBodySchema,
  subscriptionsPutBodySchema,
} = require('../schemas/data');

const router = Router();

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
const ORGANIZATIONS_ALLOWED = ['name', 'settings', 'logo_url', 'branding', 'plan'];

router.put('/organizations/:id', validate(organizationsPutBodySchema), async (req, res, next) => {
  try {
    const { sql, params } = buildUpdateQuery(req.body, ORGANIZATIONS_ALLOWED, {
      jsonColumns: ['settings', 'branding'],
    });

    // Original behaviour: always set updated_at, even when no other columns
    // change. Compose with the dynamic SET (which may be empty).
    const setClause = sql ? `${sql}, updated_at = now()` : 'updated_at = now()';
    const idIdx = params.length + 1;

    await pool.query(
      `UPDATE organizations SET ${setClause} WHERE id = $${idIdx}`,
      [...params, req.params.id]
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
router.post('/activity-log', validate(activityLogPostBodySchema), async (req, res, next) => {
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
router.put('/subscriptions/:orgId', validate(subscriptionsPutBodySchema), async (req, res, next) => {
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
