const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const env = require('./config/env');
const logger = require('./config/logger');
const corsMiddleware = require('./middleware/cors');
const sessionMiddleware = require('./config/session');
const errorHandler = require('./middleware/errorHandler');
const { globalLimiter, authLimiter, webhookLimiter, apiLimiter } = require('./middleware/rateLimit');

/**
 * Build the fully-wired Express app. Both entry points use this so their
 * middleware order and route mounts can never drift:
 *   - backend/server.js  → local dev (listens on PORT, attaches Socket.IO)
 *   - server.js (root)   → IIS / iisnode production (same, behind ARR proxy)
 *
 * Socket.IO + server.listen live in the entry files because they need the
 * http.Server instance; everything else is here.
 */
function createApp() {
  const app = express();

  // Trust the single reverse proxy (IIS ARR / dev) in front of Node so
  // req.ip is the real client IP (correct rate-limit keying) and secure
  // cookies work behind an HTTPS proxy.
  app.set('trust proxy', 1);

  // ── Security headers (helmet) ──
  // Strict CSP in production; lenient in dev so Vite HMR (inline scripts +
  // ws://) works. NEVER ship the dev variant.
  const isProd = env.NODE_ENV === 'production';
  app.use(helmet({
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", env.JOTFORM_HOST].filter(Boolean),
            frameSrc: ["'self'", env.JOTFORM_HOST].filter(Boolean),
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
          },
        }
      : false,
    frameguard: { action: 'deny' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
  }));

  // ── Global rate limiter (before routes) ──
  app.use(globalLimiter);

  app.use(corsMiddleware);
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(sessionMiddleware);

  // ── Serve uploaded files ──
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

  // ── Health check (public — must be before authed /api routers) ──
  // Shallow `/api/health` stays 200 for liveness probes.
  // `/api/health?deep=1` (and the alias `/api/health/ready`) verify Postgres
  // connectivity — use this for readiness probes / load balancers.
  app.get(['/api/health', '/api/health/ready'], async (req, res) => {
    const deep = req.path.endsWith('/ready') || req.query.deep === '1';
    // L-2: env.NODE_ENV removed — environment disclosure is unnecessary for health probes.
    const out = { ok: true, uptime: process.uptime() };
    if (!deep) return res.json(out);
    try {
      const pool = require('./db/pool');
      await pool.query('SELECT 1');
      res.json({ ...out, db: 'up' });
    } catch (err) {
      res.status(503).json({ ...out, ok: false, db: 'down', error: err.message });
    }
  });

  // ── M-7: CSRF defence — verify Origin/Referer on state-changing requests ──
  // Rejects cross-site POST/PUT/PATCH/DELETE that don't originate from an allowed origin.
  // sameSite:lax already blocks most CSRF; this is defence-in-depth for edge cases.
  const allowedOrigins = env.ALLOWED_ORIGIN === '*'
    ? null
    : env.ALLOWED_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin || req.headers.referer || '';
    const allowed = !allowedOrigins || !origin
      || allowedOrigins.some(o => origin.startsWith(o));
    if (!allowed) return res.status(403).json({ error: 'Cross-site request blocked' });
    next();
  });

  // ── Per-area rate limiting ──
  app.use('/api/auth', authLimiter);
  app.use('/api/webhook', webhookLimiter);
  app.use('/api', apiLimiter);

  // ── Routes ──
  app.use('/api/auth', require('./routes/auth-local'));
  app.use('/api/auth', require('./routes/auth-microsoft'));
  app.use('/api', require('./routes/submissions-jotform'));
  app.use('/api', require('./routes/submissions-sync'));
  app.use('/api', require('./routes/submissions-actions'));
  app.use('/api', require('./routes/submissions-cleanup'));
  app.use('/api', require('./routes/forms-workflow'));
  app.use('/api', require('./routes/forms-admin'));
  app.use('/api', require('./routes/config'));
  app.use('/api', require('./routes/data-submissions'));
  app.use('/api', require('./routes/data-profiles'));
  app.use('/api', require('./routes/data-org'));
  app.use('/api', require('./routes/uploads'));
  app.use('/api', require('./routes/users'));
  app.use('/api', require('./routes/admin-sync'));
  app.use('/api', require('./routes/signature-proxy'));
  app.use('/api', require('./routes/support'));
  app.use('/api/email-logs', require('./routes/email-logs'));

  // ── Serve built frontend (production) ──
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    const index = path.join(distPath, 'index.html');
    if (fs.existsSync(index)) return res.sendFile(index);
    next();
  });

  // ── Error handler (must be last) ──
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
