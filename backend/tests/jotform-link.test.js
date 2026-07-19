/**
 * Plain-node tests for lib/jotform-link.js.
 * Run: node tests/jotform-link.test.js
 */
process.env.JOTFORM_HOST = 'https://workspace.example.test';
process.env.JOTFORM_PREFILL_HOST = 'https://workspace.example.test';
process.env.JOTFORM_BASE = 'https://workspace.example.test/API';

const assert = require('assert');
const {
  parseJotformTaskLink,
  normalizeTaskLink,
  buildApprovalFormUrl,
  buildWorkflowTaskUrl,
  applyResourceShareLinks,
  pickShareLink,
  linkResponse,
} = require('../lib/jotform-link');

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('  OK ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}

(async () => {
  console.log('\n=== jotform-link test suite ===\n');

  await t('parses approval-form access-token URLs', () => {
    const parsed = parseJotformTaskLink('https://workspace.example.test/approval-form/260824338075964/task/18271261750332222671/access-token/SUpCRUFzejhJT1F4V0NY');
    assert.strictEqual(parsed.linkType, 'approval-form');
    assert.strictEqual(parsed.taskFormId, '260824338075964');
    assert.strictEqual(parsed.taskId, '18271261750332222671');
    assert.strictEqual(parsed.accessToken, 'SUpCRUFzejhJT1F4V0NY');
  });

  await t('parses prefill assign-form URLs', () => {
    const parsed = parseJotformTaskLink('https://workspace.example.test/260825008947058/prefill/6a2966b6663633e488202773ee6c?workflowAssignFormTask=1&taskID=18271261603416013220');
    assert.strictEqual(parsed.linkType, 'prefill');
    assert.strictEqual(parsed.taskFormId, '260825008947058');
    assert.strictEqual(parsed.prefillId, '6a2966b6663633e488202773ee6c');
    assert.strictEqual(parsed.taskId, '18271261603416013220');
  });

  await t('converts share links to approval-form links when task context exists', () => {
    const normalized = normalizeTaskLink('https://workspace.example.test/share/ABC123?teamID=260', {
      internalFormID: '260824338075964',
      taskId: '18271261750332222671',
    });
    assert.strictEqual(normalized.linkType, 'share');
    assert.strictEqual(
      normalized.normalizedUrl,
      'https://workspace.example.test/approval-form/260824338075964/task/18271261750332222671/access-token/ABC123',
    );
  });

  await t('does not use the parent form to construct an assign-task URL', () => {
    const normalized = normalizeTaskLink('https://workspace.example.test/share/ABC123', {
      formId: '261771528652968',
      taskId: '18271261771501201930',
    });
    assert.strictEqual(
      normalized.normalizedUrl,
      'https://workspace.example.test/share/ABC123',
    );
  });

  await t('does not treat a foreign JotForm email share token as an access token', () => {
    const normalized = normalizeTaskLink('https://bettroi.jotform.com/share/A%2FB%2B%3D?outcomeID=1', {
      internalFormID: '261980862105964',
      taskId: '18271261980034220224',
    });
    assert.strictEqual(
      normalized.normalizedUrl,
      'https://bettroi.jotform.com/share/A%2FB%2B%3D?outcomeID=1',
    );
  });

  await t('serves foreign email share tokens through the configured workspace host', () => {
    const response = linkResponse({
      url: 'https://bettroi.jotform.com/share/EMAIL-TOKEN?outcomeID=1',
      source: 'sent-email',
      formId: 'FORM-1',
      submissionId: 'SUB-1',
      task: { internalFormID: 'TASK-FORM-1', taskId: 'TASK-1' },
    });
    assert.strictEqual(
      response.approvalUrl,
      'https://workspace.example.test/share/EMAIL-TOKEN?outcomeID=1',
    );
  });

  await t('does not fall back to another email task token', () => {
    const rows = [{ action_links: [{ type: 'task', taskId: '', url: 'https://bettroi.jotform.com/share/WRONG' }] }];
    assert.strictEqual(pickShareLink(rows, 'RIGHT', 'TASK-1'), '');
  });

  await t('selects an exact matching task token', () => {
    const right = 'https://workspace.example.test/share/RIGHT';
    const rows = [{ action_links: [
      { type: 'task', url: 'https://bettroi.jotform.com/share/WRONG' },
      { type: 'task', url: right },
    ] }];
    assert.strictEqual(pickShareLink(rows, 'RIGHT', 'TASK-1'), right);
  });

  await t('rebuilds stale approval-form links with task internalFormID', () => {
    const normalized = normalizeTaskLink(
      'https://workspace.example.test/approval-form/261771528652968/task/18271261771501201930/access-token/ABC123',
      {
        internalFormID: '261771850840965',
        taskId: '18271261771501201930',
      },
    );
    assert.strictEqual(
      normalized.normalizedUrl,
      'https://workspace.example.test/approval-form/261771850840965/task/18271261771501201930/access-token/ABC123',
    );
  });

  await t('does not replace an email task form with the parent form', () => {
    const normalized = normalizeTaskLink(
      'https://workspace.example.test/approval-form/TASK-FORM/task/TASK-1/access-token/TOKEN',
      { formId: 'PARENT-FORM', taskId: 'TASK-1' },
    );
    assert.strictEqual(
      normalized.normalizedUrl,
      'https://workspace.example.test/approval-form/TASK-FORM/task/TASK-1/access-token/TOKEN',
    );
  });

  await t('parses inbox fallback URLs', () => {
    const parsed = parseJotformTaskLink('https://workspace.example.test/inbox/2601/9999?taskID=T1');
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
      'https://workspace.example.test/approval-form/F1/task/T1/access-token/A%20B',
    );
  });

  await t('constructs the assigned-task approval-form URL', () => {
    assert.strictEqual(
      buildWorkflowTaskUrl({
        type: 'workflow_assign_task',
        taskId: '18271261980034220224',
        internalFormID: '261980862105964',
        accessLink: 'https://workspace.example.test/share/TASK-TOKEN',
      }),
      'https://workspace.example.test/approval-form/261980862105964/task/18271261980034220224/access-token/TASK-TOKEN',
    );
  });

  await t('normalizes assigned-task tokens into external URLs', () => {
    assert.strictEqual(normalizeTaskLink(
      'https://workspace.example.test/share/TOKEN',
      { type: 'workflow_assign_task', taskId: 'T1', internalFormID: 'F1' },
    ).normalizedUrl, 'https://workspace.example.test/approval-form/F1/task/T1/access-token/TOKEN');
  });

  await t('does not substitute a normal form URL when a task token is missing', () => {
    assert.strictEqual(buildWorkflowTaskUrl({ type: 'workflow_assign_task', taskId: 'T1' }, 'F1'), '');
  });

  await t('does not fabricate a task URL without internalFormID', () => {
    assert.strictEqual(buildWorkflowTaskUrl({
      type: 'workflow_assign_task', taskId: 'T1', accessLink: 'https://workspace.example.test/share/TOKEN',
    }, 'FORM-1'), '');
  });

  await t('applies the matching resource-share token to an assigned task', () => {
    const tasks = [{ type: 'workflow_assign_task', taskId: 'T1', internalFormID: 'F1', accessLink: '' }];
    applyResourceShareLinks(tasks, [{ resource_id: 'T1', token: 'A B=', status: 'ACTIVE' }]);
    assert.strictEqual(tasks[0].accessLink, 'https://workspace.example.test/approval-form/F1/task/T1/access-token/A%20B%3D');
  });

  await t('constructs prefill task URLs on the configured prefill host', () => {
    assert.strictEqual(
      buildWorkflowTaskUrl({
        type: 'workflow_assign_form', taskId: 'T1', internalFormID: 'F1',
        accessLink: 'https://workspace.example.test/F1/prefill/P1?workflowAssignFormTask=1&taskID=T1',
      }),
      'https://workspace.example.test/F1/prefill/P1?workflowAssignFormTask=1&taskID=T1',
    );
  });

  await t('constructs a normal assigned-form URL only when JSON says prefill is not required', () => {
    assert.strictEqual(buildWorkflowTaskUrl({
      type: 'workflow_assign_form', taskId: 'T1', internalFormID: 'F1', accessLink: '',
    }), '');
    assert.strictEqual(buildWorkflowTaskUrl({
      type: 'workflow_assign_form', taskId: 'T1', internalFormID: 'F1', accessLink: '', prefillState: 'not_required',
    }), 'https://workspace.example.test/F1?workflowAssignFormTask=1&taskID=T1');
  });

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail ? 1 : 0);
})();
