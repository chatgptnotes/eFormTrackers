const { Router } = require('express');
const pool = require('../db/pool');
const { validate } = require('../middleware/validate');
const { buildUpdateQuery } = require('../db/queryBuilder');
const { requireAuth } = require('../middleware/auth');
const { isAdminRole } = require('../lib/visibility');
const {
  organizationsPutBodySchema,
  activityLogPostBodySchema,
  subscriptionsPutBodySchema,
} = require('../schemas/data');

const router = Router();

router.use(requireAuth);

// Look up the logged-in user's org_id (from their profile). Cached briefly to
// avoid hammering profiles on every org-scoped read. Returns null if unknown.
const orgCache = new Map(); // userId -> { orgId, at }
const ORG_CACHE_TTL = 60 * 1000;
async function userOrgId(userId) {
  if (!userId) return null;
  const hit = orgCache.get(userId);
  if (hit && Date.now() - hit.at < ORG_CACHE_TTL) return hit.orgId;
  const { rows } = await pool.query('SELECT org_id FROM profiles WHERE user_id = $1', [userId]);
  const orgId = rows[0]?.org_id ? String(rows[0].org_id) : null;
  orgCache.set(userId, { orgId, at: Date.now() });
  return orgId;
}

// ══════════════════════════════════════════════════════════
// organizations
// ══════════════════════════════════════════════════════════

// ── GET /api/organizations/:id ──
// Members of the org (or admins) may read it. Previously: any authenticated
// user could read any organization's full record.
router.get('/organizations/:id', async (req, res, next) => {
  try {
    const orgId = String(req.params.id);
    if (!isAdminRole(req.session.role) && (await userOrgId(req.session.userId)) !== orgId) {
      return res.status(403).json({ error: 'Not authorized to view this organization' });
    }
    const { rows } = await pool.query('SELECT * FROM organizations WHERE id = $1', [orgId]);
    if (!rows[0]) return res.json(null);
    const org = rows[0];
    // Normalize to always include all frontend-expected fields regardless of DB column age
    res.json({
      id: org.id,
      name: org.name || '',
      slug: org.slug || '',
      plan: org.plan || 'starter',
      logo_url: org.logo_url || null,
      branding: org.branding || {},
      owner_id: org.owner_id || null,
      settings: org.settings || {},
      created_at: org.created_at,
      updated_at: org.updated_at,
    });
  } catch (err) { next(err); }
});

// ── PUT /api/organizations/:id ──
const ORGANIZATIONS_ALLOWED = ['name', 'settings', 'logo_url', 'branding', 'plan'];

router.put('/organizations/:id', validate(organizationsPutBodySchema), async (req, res, next) => {
  try {
    const orgId = String(req.params.id);
    // Only admins of the same org (or super_admin globally) may mutate org settings.
    if (!isAdminRole(req.session.role) || (await userOrgId(req.session.userId)) !== orgId) {
      return res.status(403).json({ error: 'Admin role on this organization required' });
    }
    const { sql, params } = buildUpdateQuery(req.body, ORGANIZATIONS_ALLOWED, {
      jsonColumns: ['settings', 'branding'],
    });

    // Original behaviour: always set updated_at, even when no other columns
    // change. Compose with the dynamic SET (which may be empty).
    const setClause = sql ? `${sql}, updated_at = now()` : 'updated_at = now()';
    const idIdx = params.length + 1;

    await pool.query(
      `UPDATE organizations SET ${setClause} WHERE id = $${idIdx}`,
      [...params, orgId]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
// activity_log
// ══════════════════════════════════════════════════════════

// ── GET /api/activity-log?org_id=xxx ──
// Always scoped to the caller's org. A super_admin may pass ?org_id=... to view
// another org; everyone else is forced to their own.
router.get('/activity-log', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 1000);
    const isSuper = String(req.session.role || '').toLowerCase() === 'super_admin';
    const callerOrg = await userOrgId(req.session.userId);
    const requestedOrg = req.query.org_id ? String(req.query.org_id) : null;
    const orgId = isSuper && requestedOrg ? requestedOrg : callerOrg;
    if (!orgId) return res.status(403).json({ error: 'Caller has no org membership' });

    const { rows } = await pool.query(
      `SELECT al.* FROM activity_log al
         JOIN profiles p ON p.user_id = al.user_id
        WHERE p.org_id = $1
        ORDER BY al.created_at DESC LIMIT $2`,
      [orgId, limit]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/activity-log ──
// H-2: user_id and user_email must come from the session, never from the request body.
router.post('/activity-log', validate(activityLogPostBodySchema), async (req, res, next) => {
  try {
    const { action, entity_type, entity_id, details } = req.body;
    const user_id = req.session.userId || null;
    const user_email = req.session.email || null;
    await pool.query(
      `INSERT INTO activity_log (user_id, user_email, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user_id, user_email, action, entity_type || null, entity_id || null, JSON.stringify(details || {})]
    );
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
// subscriptions (Billing page)
// ══════════════════════════════════════════════════════════

// ── PUT /api/subscriptions/:orgId ──
// C-4: Must be admin of the same org (mirrors PUT /organizations/:id guard).
router.put('/subscriptions/:orgId', validate(subscriptionsPutBodySchema), async (req, res, next) => {
  try {
    const orgId = String(req.params.orgId);
    if (!isAdminRole(req.session.role) || (await userOrgId(req.session.userId)) !== orgId) {
      return res.status(403).json({ error: 'Admin role on this organization required' });
    }
    const { plan } = req.body;

    if (plan) {
      await pool.query(
        'UPDATE organizations SET plan = $1, settings = settings || $2, updated_at = now() WHERE id = $3',
        [String(plan), JSON.stringify({ plan }), orgId]
      );
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
