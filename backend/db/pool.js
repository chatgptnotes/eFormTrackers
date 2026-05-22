const { Pool } = require('pg');
const env = require('../config/env');
const logger = require('../config/logger');

const pool = new Pool({ connectionString: env.DATABASE_URL });

pool.on('error', (err) => {
  logger.error({ err }, '[pool] Unexpected PG error');
});

module.exports = pool;
