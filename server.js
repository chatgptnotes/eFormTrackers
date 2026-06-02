/**
 * IIS Entry Point (iisnode)
 *
 * Single entry point for iisnode. Builds the Express app via the shared
 * factory (backend/app.js) — identical middleware + routes to local dev —
 * then serves the React build (dist/) and attaches Socket.IO.
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
const { Server: SocketIO } = require('socket.io');

const env = require('./backend/config/env');
const logger = require('./backend/config/logger');
const { initRealtime } = require('./backend/lib/realtime');
const { createApp } = require('./backend/app');
const { installProcessGuards } = require('./backend/lib/process-guards');

installProcessGuards(logger);

const app = createApp();
const server = http.createServer(app);

// ── Socket.IO ──
const io = new SocketIO(server, {
  cors: { origin: env.ALLOWED_ORIGIN, credentials: true },
});
initRealtime(io);

// ── Start ──
// iisnode passes a named pipe via process.env.PORT
const port = process.env.PORT || env.PORT || 3001;
server.listen(port, () => {
  logger.info({ port, env: env.NODE_ENV }, '[JotFlow] Server listening (IIS entry)');
});
