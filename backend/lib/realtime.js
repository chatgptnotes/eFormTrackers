let _io = null;

function initRealtime(io) {
  _io = io;

  io.on('connection', (socket) => {
    const email = socket.handshake.query.email;
    if (email) {
      socket.join(`user:${email}`);
    }

    socket.on('subscribe', (room) => {
      if (room) socket.join(room);
    });

    socket.on('unsubscribe', (room) => {
      if (room) socket.leave(room);
    });
  });
}

function emitToUser(email, event, data) {
  if (_io) _io.to(`user:${email}`).emit(event, data);
}

function emitToAll(event, data) {
  if (_io) _io.emit(event, data);
}

function emitToRoom(room, event, data) {
  if (_io) _io.to(room).emit(event, data);
}

module.exports = { initRealtime, emitToUser, emitToAll, emitToRoom };
