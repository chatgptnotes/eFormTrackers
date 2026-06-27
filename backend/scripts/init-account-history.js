const pool = require('../db/pool');
const { ensureAccountHistoryTable, syncAccountHistory } = require('../lib/account-history-sync');

function argValue(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find(arg => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : '';
}

(async () => {
  try {
    const profileId = argValue('profile') || process.env.JOTFORM_PROFILE || undefined;
    await ensureAccountHistoryTable();
    console.log('[init-account-history] table ready');

    const result = await syncAccountHistory({ profileId, force: true });
    console.log('[init-account-history] initial sync:', result);
  } catch (err) {
    console.error('[init-account-history] error:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
