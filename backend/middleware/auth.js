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

module.exports = { requireAuth, requireRole };
