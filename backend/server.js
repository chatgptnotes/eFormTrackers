const http = require('http');
const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const env = require('./config/env');
const logger = require('./config/logger');
const corsMiddleware = require('./middleware/cors');
const sessionMiddleware = require('./config/session');
const errorHandler = require('./middleware/errorHandler');
const { globalLimiter } = require('./middleware/rateLimit');
const { etagMiddleware } = require('./middleware/etag');
const { initRealtime } = require('./lib/realtime');

const app = express();
const server = http.createServer(app);

// ── Socket.IO ──
// CORS + connection handlers live in lib/realtime.js; we just hand it the
// http server and stash the returned io on the app so route handlers can
// reach it via `req.app.get('io')`.
const io = initRealtime(server);
app.set('io', io);

// ── Trust IIS reverse proxy (needed for secure cookies behind HTTPS proxy) ──
// Also required so express-rate-limit's default req.ip key is the real client
// IP, not the proxy's address. Set to `1` because we have exactly one proxy
// (IIS ARR) in front of Node.
app.set('trust proxy', 1);

// ── Security headers (helmet) ──
// CSP is explicit. If a directive ever breaks the prod frontend, document
// the failure here and *narrow* the policy — never wholesale-disable.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // No 'unsafe-inline' / 'unsafe-eval'. Vite production bundle is hashed
      // and external; if a future feature needs inline scripts, switch to
      // nonces, do not relax this directive.
      scriptSrc: ["'self'"],
      // Tailwind/Framer inject inline styles, so style-src needs unsafe-inline.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      // Frontend may call JotForm-hosted assets (eforms.mediaoffice.ae) via
      // the backend proxy, but XHR/fetch from the page itself only hits 'self'
      // and the JotForm host (used for some asset URLs).
      connectSrc: ["'self'", env.JOTFORM_HOST].filter(Boolean),
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
  // JotForm embeds (iframes from a different origin) break with COEP enabled.
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
}));

// ── Global rate limiter (must run before routes) ──
app.use(globalLimiter);

app.use(corsMiddleware);
app.use(pinoHttp({
  logger,
  customLogLevel: function (req, res, err) {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    if (res.responseTime > 2000) return 'warn';  // >2s = slow request
    return 'info';
  },
  customProps: function (req, res) {
    return {
      slow: res.responseTime > 1000,
    };
  },
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

// ── Serve uploaded files ──
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use('/api', etagMiddleware);

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

// ── Health check ──
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ── Serve built frontend (production) ──
const distPath = path.join(__dirname, '..', 'dist');
const fs = require('fs');
app.use(express.static(distPath));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const index = path.join(distPath, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  next();
});

// ── Error handler ──
app.use(errorHandler);

// ── Start ──
server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, '[JotFlow] Backend listening');
});