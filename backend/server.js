const http = require('http');
const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const { Server: SocketIO } = require('socket.io');
const env = require('./config/env');
const logger = require('./config/logger');
const corsMiddleware = require('./middleware/cors');
const sessionMiddleware = require('./config/session');
const errorHandler = require('./middleware/errorHandler');
const { globalLimiter } = require('./middleware/rateLimit');
const { initRealtime } = require('./lib/realtime');

const app = express();
const server = http.createServer(app);

// ── Socket.IO ──
const io = new SocketIO(server, {
  cors: { origin: env.ALLOWED_ORIGIN, credentials: true },
});
initRealtime(io);

// ── Trust IIS reverse proxy (needed for secure cookies behind HTTPS proxy) ──
// Also required so express-rate-limit's default req.ip key is the real client
// IP, not the proxy's address. Set to `1` because we have exactly one proxy
// (IIS ARR) in front of Node.
app.set('trust proxy', 1);

// ── Security headers (helmet) ──
// In production the CSP is strict. In development Vite's HMR needs
// inline scripts, ws:// for hot-reload, and eval (for some plugins),
// so we use a lenient CSP locally. NEVER ship the dev variant to prod.
const isProd = env.NODE_ENV === 'production';
app.use(helmet({
  contentSecurityPolicy: isProd
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", env.JOTFORM_HOST].filter(Boolean),
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      }
    : false, // Dev: disable CSP entirely so Vite HMR (inline scripts + ws://) works
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
  // JotForm embeds (iframes from a different origin) break with COEP enabled.
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
}));

// ── Global rate limiter (must run before routes) ──
app.use(globalLimiter);

app.use(corsMiddleware);
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

// ── Serve uploaded files ──
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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