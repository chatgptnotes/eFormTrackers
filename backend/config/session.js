const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const pool = require('../db/pool');
const env = require('./env');

module.exports = session({
  store: new PgSession({ pool, tableName: 'session' }),
  secret: env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
  },
});
