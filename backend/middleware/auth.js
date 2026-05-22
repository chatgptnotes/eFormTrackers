/**
 * Session-based auth guards.
 *
 * Sessions are populated by routes/auth-local.js and routes/auth-microsoft.js
 * with: req.session.userId, req.session.email, req.session.role,
 * req.session.fullName.
 */

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

function requireRole(role) {
  return function requireRoleMiddleware(req, res, next) {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const userRole = req.session.role || '';
    // Treat super_admin as a superset of admin.
    if (userRole === role || (role === 'admin' && userRole === 'super_admin')) {
      return next();
    }
    return res.status(403).json({ error: 'Forbidden' });
  };
}

/**
 * Gate an endpoint to a fixed allowlist of email addresses. Comparison is
 * case-insensitive. Use for endpoints that mutate global config which only a
 * specific operator should ever touch (e.g. the Settings page).
 */
function requireEmail(allowedEmails) {
  const allow = new Set(allowedEmails.map(e => String(e).toLowerCase()));
  return function requireEmailMiddleware(req, res, next) {
    if (!req.session || !req.session.userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    const email = String(req.session.email || '').toLowerCase();
    if (!email || !allow.has(email)) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requireEmail };
