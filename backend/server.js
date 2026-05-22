const http = require('http');
const express = require('express');
const helmet = require('helmet');
const { Server: SocketIO } = require('socket.io');
const env = require('./config/env');
const corsMiddleware = require('./middleware/cors');
const sessionMiddleware = require('./config/session');
const errorHandler = require('./middleware/errorHandler');
const { initRealtime } = require('./lib/realtime');
const { authLimiter, webhookLimiter, apiLimiter } = require('./middleware/rateLimiter');
const { startPoller } = require('./lib/poller');

const app = express();
const server = http.createServer(app);

// ── Socket.IO ──
const io = new SocketIO(server, {
  cors: { origin: env.ALLOWED_ORIGIN, credentials: true },
});
initRealtime(io);

// ── Trust IIS reverse proxy (needed for secure cookies behind HTTPS proxy) ──
app.set('trust proxy', 1);

// ── Global middleware ──
app.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: false }));
app.use(corsMiddleware);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

// ── Serve uploaded files ──
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Rate limiting ──
app.use('/api/auth', authLimiter);
app.use('/api/webhook', webhookLimiter);
app.use('/api', apiLimiter);

// ── Routes ──
app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/submissions'));
app.use('/api', require('./routes/forms'));
app.use('/api', require('./routes/config'));
app.use('/api', require('./routes/data'));
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
  console.log(`[JotFlow] Backend listening on port ${env.PORT} (${env.NODE_ENV})`);
  startPoller();
});