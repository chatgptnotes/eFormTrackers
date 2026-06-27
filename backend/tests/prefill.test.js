/**
 * Test suite for lib/prefill.js — the workflow_assign_form direct-link resolver.
 * Plain-node (no framework). Run: node tests/prefill.test.js
 *
 * No DB and no live JotForm key required: lib/jotform is stubbed via the require
 * cache so getPrefills() reads a fixed in-memory prefills fixture.
 */

// Pin the host BEFORE requiring env/prefill (dotenv won't overwrite a value
// already present in process.env), so the expected URL is deterministic.
process.env.JOTFORM_HOST = 'https://bettroi.jotform.com';
process.env.JOTFORM_BASE = 'https://bettroi.jotform.com/API';

const assert = require('assert');

// ── Stub lib/jotform before lib/prefill captures jotformFetch ────────────────
const FORM = '260825008947058';
const SUB = '6571458336016798785';
// REAL response shape: content[] = prefill TEMPLATES, each with the actual
// per-submission URLs nested under urls[]. The resolver must flatten urls[].
// Same submission, two assignees + a reminder duplicate (newest created_at wins).
const URLS = [
  { id: 'OLD_A', created_at: '2026-06-10 01:00:00', settings: { id: SUB, metadata: { email: 'a@gdmo.ae' } } },
  { id: 'NEW_A', created_at: '2026-06-13 03:43:56', settings: { id: SUB, metadata: { email: 'a@gdmo.ae' } } },
  { id: 'NEWEST_B', created_at: '2026-06-14 09:00:00', settings: { id: SUB, metadata: { email: 'b@gdmo.ae' } } },
];
const PREFILLS_RESPONSE = {
  content: [
    { id: '260824768641061', form_id: FORM, provider: 'workflow', urls: URLS },
  ],
};
const jotformPath = require.resolve('../lib/jotform');
require.cache[jotformPath] = {
  id: jotformPath,
  filename: jotformPath,
  loaded: true,
  exports: {
    jotformFetch: async (path) => {
      // getPrefills calls `form/{formId}/prefills`.
      if (/\/prefills$/.test(path) && path.includes(FORM)) return PREFILLS_RESPONSE;
      return { content: [] };
    },
  },
};

const { resolvePrefillUrl, enrichTasksWithPrefill, getPrefills } = require('../lib/prefill');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  ✅ ' + name); pass++; }
  catch (e) { console.log('  ❌ ' + name + '\n       ' + e.message); fail++; }
}

(async () => {
  console.log('\n=== prefill resolver test suite ===\n');

  console.log('-- getPrefills (flatten nested urls[]) --');
  await t('flattens content[].urls[] into the URL list', async () => {
    const flat = await getPrefills(FORM, 'gdmo');
    assert.strictEqual(flat.length, URLS.length, `expected ${URLS.length} flattened entries, got ${flat.length}`);
    assert.ok(flat.every(p => p.settings && p.settings.id), 'every entry must expose settings.id');
  });

  console.log('-- resolvePrefillUrl --');
  await t('builds the /prefill/ URL in the documented shape', async () => {
    const url = await resolvePrefillUrl({
      formId: FORM, submissionId: SUB, taskId: 'T123', assigneeEmail: 'a@gdmo.ae',
    });
    assert.strictEqual(
      url,
      `https://bettroi.jotform.com/${FORM}/prefill/NEW_A?workflowAssignFormTask=1&taskID=T123`,
    );
  });

  await t('scopes to the assignee email (picks B\'s prefill for B)', async () => {
    const url = await resolvePrefillUrl({
      formId: FORM, submissionId: SUB, taskId: 'T9', assigneeEmail: 'b@gdmo.ae',
    });
    assert.ok(url.includes('/prefill/NEWEST_B?'), url);
  });

  await t('picks newest by created_at among the assignee\'s prefills', async () => {
    const url = await resolvePrefillUrl({
      formId: FORM, submissionId: SUB, taskId: 'T1', assigneeEmail: 'a@gdmo.ae',
    });
    assert.ok(url.includes('/prefill/NEW_A?') && !url.includes('OLD_A'), url);
  });

  await t('returns empty string when no prefill matches the submission', async () => {
    const url = await resolvePrefillUrl({
      formId: FORM, submissionId: 'NO_SUCH_SUB', taskId: 'T1', assigneeEmail: 'a@gdmo.ae',
    });
    assert.strictEqual(url, '');
  });

  console.log('-- enrichTasksWithPrefill (precedence) --');
  await t('OVERWRITES a harvested /share/ accessLink with the /prefill/ link', async () => {
    const tasks = [{
      type: 'workflow_assign_form', status: 'ACTIVE',
      accessLink: 'https://bettroi.jotform.com/share/SVdmVjBvVWtp',
      internalFormID: FORM, taskId: 'T123', assigneeEmail: 'a@gdmo.ae',
    }];
    await enrichTasksWithPrefill(tasks, SUB, 'gdmo');
    assert.ok(tasks[0].accessLink.includes('/prefill/NEW_A'), tasks[0].accessLink);
    assert.ok(!tasks[0].accessLink.includes('/share/'), tasks[0].accessLink);
  });

  await t('keeps an existing /prefill/ accessLink untouched', async () => {
    const existing = `https://bettroi.jotform.com/${FORM}/prefill/ALREADY?workflowAssignFormTask=1&taskID=T123`;
    const tasks = [{
      type: 'workflow_assign_form', status: 'ACTIVE',
      accessLink: existing, internalFormID: FORM, taskId: 'T123', assigneeEmail: 'a@gdmo.ae',
    }];
    await enrichTasksWithPrefill(tasks, SUB, 'gdmo');
    assert.strictEqual(tasks[0].accessLink, existing);
  });

  await t('ignores non-assign_form and non-ACTIVE tasks', async () => {
    const tasks = [
      { type: 'workflow_approval', status: 'ACTIVE', accessLink: '', internalFormID: FORM, taskId: 'T', assigneeEmail: 'a@gdmo.ae' },
      { type: 'workflow_assign_form', status: 'COMPLETED', accessLink: '', internalFormID: FORM, taskId: 'T', assigneeEmail: 'a@gdmo.ae' },
    ];
    await enrichTasksWithPrefill(tasks, SUB, 'gdmo');
    assert.strictEqual(tasks[0].accessLink, '');
    assert.strictEqual(tasks[1].accessLink, '');
  });

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})();
