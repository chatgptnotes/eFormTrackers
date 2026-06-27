/**
 * Test suite for the enterprise/history audit-trail feature + a live JotForm
 * API health check. Plain-node (no framework). Run: node tests/enterprise-history.test.js
 *
 * Requires: DB reachable (db/pool) and live JotForm GDMO key (config/env).
 * Exits non-zero if any assertion fails.
 */
const assert = require('assert');
const pool = require('../db/pool');
const env = require('../config/env');
const { jotformFetch } = require('../lib/jotform');
const { syncEnterpriseHistory, toIso, extract, isEvent } = require('../lib/history-sync');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ✅ ' + name); pass++; }
  catch (e) { console.log('  ❌ ' + name + '\n       ' + e.message); fail++; }
}

(async () => {
  console.log('\n=== enterprise/history test suite ===\n');

  console.log('-- unit: date conversion --');
  await t('toIso(Unix seconds) -> 2026 ISO', () => {
    assert.ok(toIso(1781420997).startsWith('2026-'));
  });
  await t('toIso("YYYY-MM-DD HH:MM:SS") parses to valid ISO', () => {
    // Parsed as local time then emitted as UTC, so the day may shift by the
    // local offset — assert a valid 2026-06 ISO string rather than an exact day.
    const iso = toIso('2026-06-13 02:53:01');
    assert.ok(/^2026-06-\d{2}T/.test(iso), iso);
    assert.ok(!Number.isNaN(Date.parse(iso)));
  });
  await t('toIso(null / empty) -> null', () => {
    assert.strictEqual(toIso(null), null);
    assert.strictEqual(toIso(''), null);
  });

  console.log('-- unit: isEvent (cursor filter) --');
  await t('real event (has id) -> true', () => {
    assert.strictEqual(isEvent({ id: 'x', type: 'userLogin' }), true);
  });
  await t('sync-cursor object -> false', () => {
    assert.strictEqual(isEvent({ lastFormsDate: '2026-06-13 02:53:01' }), false);
    assert.strictEqual(isEvent({ lastSubmissionsDate: '' }), false);
  });

  console.log('-- unit: extract (field mapping) --');
  await t('maps action/user/ip/date from real shape', () => {
    const c = extract({ type: 'userLogin', username: 'btthomas', ip: '1.2.3.4',
      timestamp: 1781420997, userEmail: 'bt@x.com', name: 'admin', id: 'abc' });
    assert.strictEqual(c.action, 'userLogin');
    assert.strictEqual(c.actor_username, 'btthomas');
    assert.strictEqual(c.actor_email, 'bt@x.com');
    assert.strictEqual(c.ip_address, '1.2.3.4');
    assert.ok(c.logged_at.startsWith('2026-'));
  });

  console.log('-- integration: live JotForm history --');
  let liveEvents = 0;
  await t('fetch + filter cursors + all events dated', async () => {
    const data = await jotformFetch('enterprise/history',
      { params: { limit: 1000, sortWay: 'DESC', sortBy: 'date' }, keyType: 'gdmo', timeoutMs: 30000 });
    const entries = Array.isArray(data.content) ? data.content
      : Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [];
    const events = entries.filter(isEvent);
    liveEvents = events.length;
    assert.ok(events.length > 0, 'expected at least one event');
    const cols = events.map(extract);
    assert.strictEqual(cols.filter(c => !c.logged_at).length, 0, 'some events have no date');
    assert.strictEqual(cols.filter(c => !c.action).length, 0, 'some events have no action');
  });

  console.log('-- integration: DB sync --');
  await t('enterprise_history table exists', async () => {
    const r = await pool.query("SELECT to_regclass('public.enterprise_history') AS t");
    assert.ok(r.rows[0].t, 'table missing — run node db/migrate.js');
  });
  await t('sync runs and DB has >= live event count', async () => {
    await syncEnterpriseHistory();             // may skip if run <10min ago; either way DB should be populated
    const r = await pool.query('SELECT count(*)::int c FROM enterprise_history');
    assert.ok(r.rows[0].c >= liveEvents, `DB has ${r.rows[0].c}, live had ${liveEvents}`);
  });
  await t('no junk rows (blank action / null / pre-2000 date)', async () => {
    const r = await pool.query(
      "SELECT count(*)::int c FROM enterprise_history WHERE action='' OR logged_at IS NULL OR logged_at < '2000-01-01'");
    assert.strictEqual(r.rows[0].c, 0);
  });
  await t('interval guard skips immediate re-run', async () => {
    const r = await syncEnterpriseHistory();
    assert.strictEqual(r.skipped, true);
  });

  console.log('-- integration: JotForm API health (gdmo) --');
  const health = [
    ['user/forms', { params: { limit: 3 } }],
    ['users', { params: { limit: 3 } }],
    ['team/user/me', {}],
    ['enterprise/system-logs', { params: { limit: 3 } }],
    ['enterprise/history', { params: { limit: 3 } }],
  ];
  for (const [ep, opts] of health) {
    await t('GET ' + ep, async () => {
      const d = await jotformFetch(ep, { keyType: 'gdmo', timeoutMs: 20000, ...opts });
      assert.ok(d && (d.responseCode === 200 || d.content !== undefined), 'bad response');
    });
  }

  console.log('\n=== RESULT: ' + pass + ' passed, ' + fail + ' failed ===\n');
  await pool.end().catch(() => {});
  process.exit(fail > 0 ? 1 : 0);
})();
