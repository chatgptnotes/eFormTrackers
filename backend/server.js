const http = require('http');
const { Server: SocketIO } = require('socket.io');
const env = require('./config/env');
const logger = require('./config/logger');
const { initRealtime } = require('./lib/realtime');
const { startPoller } = require('./lib/poller');
const { createApp } = require('./app');
const { installProcessGuards } = require('./lib/process-guards');

installProcessGuards(logger);

const app = createApp();
const server = http.createServer(app);

// ── Socket.IO ──
const io = new SocketIO(server, {
  cors: { origin: env.ALLOWED_ORIGIN, credentials: true },
});
initRealtime(io);

// ── Start ──
server.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, '[JotFlow] Backend listening');
  if (process.env.ENABLE_POLLER === '1') {
    startPoller();
  } else {
    logger.warn('[JotFlow] Poller disabled (set ENABLE_POLLER=1 to enable). jf_forms table must exist.');
  }
});

// ── Graceful shutdown ──
// Without this, IIS/iisnode rolling restarts and container stops drop in-flight
// requests on the floor and leave Postgres connections half-open. SIGTERM/SIGINT
// close the HTTP server (refuse new conns, drain existing), then the PG pool.
// A 30s safety timeout force-exits if drain hangs.
function shutdown(signal) {
  logger.info({ signal }, '[JotFlow] Shutting down');
  const force = setTimeout(() => {
    logger.error('[JotFlow] Forced exit (30s drain timeout)');
    process.exit(1);
  }, 30000);
  force.unref();
  server.close(async () => {
    try {
      const pool = require('./db/pool');
      await pool.end();
    } catch (err) {
      logger.warn({ err: err.message }, '[JotFlow] pool.end() failed');
    }
    logger.info('[JotFlow] Drained cleanly');
    process.exit(0);
  });
}
['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => shutdown(sig)));
