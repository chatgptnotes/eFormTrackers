const { Pool } = require('pg');
const env = require('../config/env');
const logger = require('../config/logger');

// Bounded pool so a hung query or runaway worker can't exhaust connections.
// Defaults sized for a single-instance Node backend; override via env.
const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: parseInt(env.PG_POOL_MAX || '20', 10) || 20,
  idleTimeoutMillis: parseInt(env.PG_IDLE_TIMEOUT_MS || '30000', 10) || 30000,
  connectionTimeoutMillis: parseInt(env.PG_CONNECT_TIMEOUT_MS || '5000', 10) || 5000,
  statement_timeout: parseInt(env.PG_STATEMENT_TIMEOUT_MS || '30000', 10) || 30000,
});

pool.on('error', (err) => {
  logger.error({ err }, '[pool] Unexpected PG error');
});

module.exports = pool;
