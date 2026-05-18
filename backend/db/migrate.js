const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('../config/env');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const client = new Client({ connectionString: process.env.DATABASE_URL });

  try {
    await client.connect();
    console.log('[migrate] Connected to PostgreSQL');
    await client.query(sql);
    console.log('[migrate] Schema applied successfully');
  } catch (err) {
    console.error('[migrate] Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
