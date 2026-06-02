/**
 * ensure-jf-forms.js
 *
 * Creates the jf_forms table the background poller writes to. The poller was
 * disabled (server.js) because this table was never migrated — without it every
 * poll cycle errors with "relation jf_forms does not exist".
 *
 * Idempotent (CREATE TABLE IF NOT EXISTS) and additive — creates an empty table,
 * touches no existing data. Reads DATABASE_URL from backend/.env.
 *
 * Run from the backend dir:   node scripts/ensure-jf-forms.js
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const envtxt = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
const url = (envtxt.match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim().replace(/^["']|["']$/g, '');
const pool = new Pool({ connectionString: url });

const DDL = `
CREATE TABLE IF NOT EXISTS jf_forms (
  form_id          TEXT PRIMARY KEY,
  title            TEXT DEFAULT '',
  creator_username TEXT DEFAULT '',
  status           TEXT DEFAULT '',
  created_at_jf    TIMESTAMPTZ,
  updated_at_jf    TIMESTAMPTZ,
  last_synced      TIMESTAMPTZ DEFAULT now()
);`;

(async () => {
  await pool.query(DDL);
  const { rows } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name='jf_forms') AS ok`
  );
  console.log(rows[0].ok ? '✓ jf_forms table ready' : '✗ jf_forms still missing');
  await pool.end();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
