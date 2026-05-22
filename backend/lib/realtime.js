const { Server: SocketIO } = require('socket.io');
const env = require('../config/env');

let _io = null;

/**
 * Construct a Socket.IO server bound to the existing http server and return
 * the io instance. CORS is locked to `env.ALLOWED_ORIGIN` with credentials.
 *
 * Wires a basic connection handler that joins per-user / per-org rooms based
 * on handshake.query and supports ad-hoc `subscribe` / `unsubscribe` events.
 */
function initRealtime(httpServer) {
  const io = new SocketIO(httpServer, {
    cors: { origin: env.ALLOWED_ORIGIN, credentials: true },
  });
  _io = io;

  io.on('connection', (socket) => {
    const email = socket.handshake.query.email;
    const orgId = socket.handshake.query.orgId;
    if (email) socket.join(`user:${email}`);
    if (orgId) socket.join(`org:${orgId}`);

    socket.on('subscribe', (room) => {
      if (room) socket.join(room);
    });
    socket.on('unsubscribe', (room) => {
      if (room) socket.leave(room);
    });
  });

  return io;
}

// ── Targeted emit helpers ──
// Broadcasts go to all connected clients by default; if `payload.orgId` is
// present, scope the emit to that org's room instead.
function emitSubmissionUpdated(submissionId, payload) {
  if (!_io) return;
  const body = { submissionId, ...payload };
  if (payload && payload.orgId) {
    _io.to(`org:${payload.orgId}`).emit('submission-updated', body);
  } else {
    _io.emit('submission-updated', body);
  }
}

function emitWorkflowChanged(formId, payload) {
  if (!_io) return;
  const body = { formId, ...payload };
  if (payload && payload.orgId) {
    _io.to(`org:${payload.orgId}`).emit('workflow-changed', body);
  } else {
    _io.emit('workflow-changed', body);
  }
}

// ── Legacy helpers (used by notifications.js) ──
function emitToUser(email, event, data) {
  if (_io) _io.to(`user:${email}`).emit(event, data);
}
function emitToAll(event, data) {
  if (_io) _io.emit(event, data);
}
function emitToRoom(room, event, data) {
  if (_io) _io.to(room).emit(event, data);
}

module.exports = {
  initRealtime,
  emitSubmissionUpdated,
  emitWorkflowChanged,
  emitToUser,
  emitToAll,
  emitToRoom,
};
