// Seed a default admin user so a fresh install can log in immediately.
// Idempotent: re-running updates the password/role instead of erroring.
//
//   node db/seed-admin.js
//
// Credentials come from env (set by the installer) or fall back to defaults:
//   ADMIN_EMAIL    (default: admin@flowaccel.local)
//   ADMIN_PASSWORD (default: Admin@12345)
//   ADMIN_NAME     (default: Administrator)

const bcrypt = require('bcrypt');
const { Client } = require('pg');
const env = require('../config/env');

const SALT_ROUNDS = 12;
// Matches the default org seeded by schema.sql and the ORG_ID in routes/auth.js
const ORG_ID = '971589dd-afcb-4a12-8900-47626e4d59cc';

const email = env.ADMIN_EMAIL || 'admin@flowaccel.local';
const password = env.ADMIN_PASSWORD || 'Admin@12345';
const fullName = env.ADMIN_NAME || 'Administrator';

async function seed() {
  const client = new Client({ connectionString: env.DATABASE_URL });
  try {
    await client.connect();
    const hash = await bcrypt.hash(password, SALT_ROUNDS);

    // Ensure the default org exists (schema.sql seeds it too — kept here for safety).
    await client.query(
      `INSERT INTO organizations (id, name, slug)
       VALUES ($1, 'Default Org', 'default')
       ON CONFLICT (id) DO NOTHING`,
      [ORG_ID]
    );

    // Upsert the user — re-running resets the password so it is never "stuck".
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             full_name     = EXCLUDED.full_name,
             updated_at    = now()
       RETURNING id`,
      [email, hash, fullName]
    );
    const userId = rows[0].id;

    // Profile with admin role.
    await client.query(
      `INSERT INTO profiles (user_id, full_name, department, role, org_id, preferences)
       VALUES ($1, $2, '', 'admin', $3, '{"theme":"dark","language":"en"}')
       ON CONFLICT (user_id) DO UPDATE
         SET role = 'admin', org_id = EXCLUDED.org_id, full_name = EXCLUDED.full_name, updated_at = now()`,
      [userId, fullName, ORG_ID]
    );

    // Org membership with admin role.
    await client.query(
      `INSERT INTO org_members (org_id, user_id, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (org_id, user_id) DO UPDATE SET role = 'admin'`,
      [ORG_ID, userId]
    );

    console.log('[seed-admin] Admin ready:');
    console.log(`[seed-admin]   email:    ${email}`);
    console.log(`[seed-admin]   password: ${password}`);
    console.log('[seed-admin] Change this password after first login.');
  } catch (err) {
    console.error('[seed-admin] Error:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
