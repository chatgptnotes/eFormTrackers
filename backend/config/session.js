const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const pool = require('../db/pool');
const env = require('./env');

module.exports = session({
  // M-5: TTL enforced server-side so stolen cookies expire even if the client never logs out.
  store: new PgSession({ pool, tableName: 'session', ttl: 8 * 60 * 60 }),
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000, // 8 hours — matches server TTL
    httpOnly: true,
    secure: 'auto',
    // 'lax' is required for Microsoft OAuth redirect flow (cross-origin redirect).
    sameSite: 'lax',
  },
});
