/**
 * Plain-node tests for lib/jotform-link.js.
 * Run: node tests/jotform-link.test.js
 */
process.env.JOTFORM_HOST = 'https://bettroi.jotform.com';
process.env.JOTFORM_BASE = 'https://bettroi.jotform.com/API';

const assert = require('assert');
const {
  parseJotformTaskLink,
  normalizeTaskLink,
  buildApprovalFormUrl,
} = require('../lib/jotform-link');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  OK ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}

(async () => {
  console.log('\n=== jotform-link test suite ===\n');

  await t('parses approval-form access-token URLs', () => {
    const parsed = parseJotformTaskLink('https://bettroi.jotform.com/approval-form/260824338075964/task/18271261750332222671/access-token/SUpCRUFzejhJT1F4V0NY');
    assert.strictEqual(parsed.linkType, 'approval-form');
    assert.strictEqual(parsed.taskFormId, '260824338075964');
    assert.strictEqual(parsed.taskId, '18271261750332222671');
    assert.strictEqual(parsed.accessToken, 'SUpCRUFzejhJT1F4V0NY');
  });

  await t('parses prefill assign-form URLs', () => {
    const parsed = parseJotformTaskLink('https://bettroi.jotform.com/260825008947058/prefill/6a2966b6663633e488202773ee6c?workflowAssignFormTask=1&taskID=18271261603416013220');
    assert.strictEqual(parsed.linkType, 'prefill');
    assert.strictEqual(parsed.taskFormId, '260825008947058');
    assert.strictEqual(parsed.prefillId, '6a2966b6663633e488202773ee6c');
    assert.strictEqual(parsed.taskId, '18271261603416013220');
  });

  await t('converts share links to approval-form links when task context exists', () => {
    const normalized = normalizeTaskLink('https://bettroi.jotform.com/share/ABC123?teamID=260', {
      internalFormID: '260824338075964',
      taskId: '18271261750332222671',
    });
    assert.strictEqual(normalized.linkType, 'share');
    assert.strictEqual(
      normalized.normalizedUrl,
      'https://bettroi.jotform.com/approval-form/260824338075964/task/18271261750332222671/access-token/ABC123',
    );
  });

  await t('converts share links using parent formId for assign-task rows', () => {
    const normalized = normalizeTaskLink('https://bettroi.jotform.com/share/ABC123', {
      formId: '261771528652968',
      taskId: '18271261771501201930',
    });
    assert.strictEqual(
      normalized.normalizedUrl,
      'https://bettroi.jotform.com/approval-form/261771528652968/task/18271261771501201930/access-token/ABC123',
    );
  });

  await t('parses inbox fallback URLs', () => {
    const parsed = parseJotformTaskLink('https://bettroi.jotform.com/inbox/2601/9999?taskID=T1');
    assert.strictEqual(parsed.linkType, 'inbox');
    assert.strictEqual(parsed.taskFormId, '2601');
    assert.strictEqual(parsed.submissionId, '9999');
    assert.strictEqual(parsed.taskId, 'T1');
  });

  await t('rejects non-JotForm hosts', () => {
    const parsed = parseJotformTaskLink('https://example.com/share/ABC');
    assert.strictEqual(parsed.linkType, 'unknown');
    assert.strictEqual(parsed.normalizedUrl, '');
  });

  await t('builds approval-form URLs', () => {
    assert.strictEqual(
      buildApprovalFormUrl({ taskFormId: 'F1', taskId: 'T1', token: 'A B' }),
      'https://bettroi.jotform.com/approval-form/F1/task/T1/access-token/A%20B',
    );
  });

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})();
