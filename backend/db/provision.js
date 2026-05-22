// Provision the PostgreSQL role + database on a fresh machine.
// Uses node-postgres (no dependency on psql being in PATH).
//
//   node db/provision.js
//
// Connects as a superuser to the maintenance database and creates the app
// role + database if they do not already exist. Safe to re-run (idempotent).
//
// Superuser connection (env, with defaults):
//   PGHOST            (default: localhost)
//   PGPORT            (default: 5432)
//   PGSUPERUSER       (default: postgres)
//   PGSUPERPASSWORD   (default: postgres)
//   PGSUPERDB         (default: postgres)
//
// App role/database to create (env, with defaults):
//   FA_DB_NAME        (default: jotflow)
//   FA_DB_USER        (default: jotflow)
//   FA_DB_PASSWORD    (default: jotflow)

const { Client } = require('pg');

const host = process.env.PGHOST || 'localhost';
const port = parseInt(process.env.PGPORT || '5432', 10);
const superUser = process.env.PGSUPERUSER || 'postgres';
const superPass = process.env.PGSUPERPASSWORD || 'postgres';
const superDb = process.env.PGSUPERDB || 'postgres';

const dbName = process.env.FA_DB_NAME || 'jotflow';
const dbUser = process.env.FA_DB_USER || 'jotflow';
const dbPass = process.env.FA_DB_PASSWORD || 'jotflow';

// Identifiers are validated (not user-facing input) but kept simple/safe.
const ident = (s) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(s)) {
    throw new Error(`Unsafe identifier: ${s}`);
  }
  return `"${s}"`;
};

async function provision() {
  const client = new Client({
    host, port, user: superUser, password: superPass, database: superDb,
  });
  try {
    await client.connect();
    console.log(`[provision] Connected to ${host}:${port} as ${superUser}`);

    // 1. Role
    const role = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [dbUser]);
    if (role.rowCount === 0) {
      await client.query(`CREATE ROLE ${ident(dbUser)} LOGIN PASSWORD $1`, [dbPass]);
      console.log(`[provision] Role '${dbUser}' created`);
    } else {
      // Keep the password in sync with what the installer expects.
      await client.query(`ALTER ROLE ${ident(dbUser)} LOGIN PASSWORD $1`, [dbPass]);
      console.log(`[provision] Role '${dbUser}' already exists (password synced)`);
    }

    // 2. Database (CREATE DATABASE cannot run inside a transaction / be parameterized)
    const db = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (db.rowCount === 0) {
      await client.query(`CREATE DATABASE ${ident(dbName)} OWNER ${ident(dbUser)}`);
      console.log(`[provision] Database '${dbName}' created (owner ${dbUser})`);
    } else {
      console.log(`[provision] Database '${dbName}' already exists`);
    }

    await client.query(`GRANT ALL PRIVILEGES ON DATABASE ${ident(dbName)} TO ${ident(dbUser)}`);
    console.log('[provision] Privileges granted. Done.');
  } catch (err) {
    console.error('[provision] Error:', err.message);
    console.error('[provision] Hint: set PGSUPERPASSWORD if your postgres superuser password is not "postgres".');
    process.exit(1);
  } finally {
    await client.end();
  }
}

provision();
