const { Pool } = require('pg');
const env = require('../config/env');

const pool = new Pool({ connectionString: env.DATABASE_URL });

pool.on('error', (err) => {
  console.error('[pool] Unexpected PG error:', err.message);
});

module.exports = pool;
