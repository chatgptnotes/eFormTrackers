/**
 * IIS Entry Point (iisnode)
 *
 * This file is the single entry point for iisnode. It:
 * 1. Loads the Express backend (API routes, session, auth)
 * 2. Serves the React production build (dist/)
 * 3. Falls back to index.html for SPA client-side routing
 *
 * Deployment folder structure:
 *   C:\inetpub\jotflow\
 *   ├── backend\          (Express app + node_modules)
 *   ├── dist\             (React build output)
 *   ├── web.config        (IIS rewrite rules)
 *   └── server.js         (this file)
 */

const path = require('path');

// Allow require() to find packages installed in backend/node_modules
module.paths.unshift(path.join(__dirname, 'backend', 'node_modules'));

const http = require('http');
const express = require('express');
const helmet = require('helmet');
const { Server: SocketIO } = require('socket.io');

// Load backend config (reads backend/.env via dotenv)
const env = require('./backend/config/env');
const corsMiddleware = require('./backend/middleware/cors');
const sessionMiddleware = require('./backend/config/session');
const errorHandler = require('./backend/middleware/errorHandler');
const { initRealtime } = require('./backend/lib/realtime');

const app = express();
const server = http.createServer(app);

// ── Socket.IO ──
const io = new SocketIO(server, {
  cors: { origin: env.ALLOWED_ORIGIN, credentials: true },
});
initRealtime(io);

// ── Global middleware ──
app.use(helmet({ contentSecurityPolicy: false }));
app.use(corsMiddleware);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

// ── Serve uploaded files (avatars, signatures) ──
app.use('/uploads', express.static(path.join(__dirname, 'backend', 'uploads')));

// ── API routes ──
app.use('/api/auth', require('./backend/routes/auth'));
app.use('/api', require('./backend/routes/submissions'));
app.use('/api', require('./backend/routes/forms'));
app.use('/api', require('./backend/routes/config'));
app.use('/api', require('./backend/routes/data'));
app.use('/api', require('./backend/routes/uploads'));
app.use('/api', require('./backend/routes/users'));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), env: env.NODE_ENV });
});

// ── Serve React static build ──
app.use(express.static(path.join(__dirname, 'dist'), { index: 'index.html' }));

// ── SPA fallback: all non-API routes return index.html ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ── Error handler ──
app.use(errorHandler);

// ── Start server ──
// iisnode passes a named pipe via process.env.PORT
const port = process.env.PORT || env.PORT || 3001;
server.listen(port, () => {
  console.log(`[JotFlow] Server listening on ${port} (${env.NODE_ENV})`);
});
