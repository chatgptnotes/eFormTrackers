const pool = require('../db/pool');
const { syncSystemLogs } = require('../lib/system-log-sync');

(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_logs (
        id            TEXT PRIMARY KEY,
        event_type    TEXT DEFAULT '',
        description   TEXT DEFAULT '',
        form_id       TEXT DEFAULT '',
        submission_id TEXT DEFAULT '',
        ip_address    TEXT DEFAULT '',
        actor_email   TEXT DEFAULT '',
        raw           JSONB,
        logged_at     TIMESTAMPTZ,
        created_at    TIMESTAMPTZ DEFAULT now()
      )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_logs_form       ON system_logs (form_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_logs_submission ON system_logs (submission_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_system_logs_logged_at  ON system_logs (logged_at DESC)`);
    console.log('[init-system-logs] table ready');

    const result = await syncSystemLogs();
    console.log('[init-system-logs] initial sync:', result);
  } catch (err) {
    console.error('[init-system-logs] error:', err.message);
  } finally {
    await pool.end();
  }
})();
