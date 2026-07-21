const test = require('node:test');
const assert = require('node:assert/strict');
const { workflowActionBodySchema } = require('../schemas/submissions');

test('admin override requires a reason while normal workflow actions do not', () => {
  const normal = workflowActionBodySchema.safeParse({ submissionId: '1', action: 'approve' });
  const missingReason = workflowActionBodySchema.safeParse({ submissionId: '1', taskId: '2', action: 'approve', adminOverride: true });
  const override = workflowActionBodySchema.safeParse({ submissionId: '1', taskId: '2', action: 'approve', adminOverride: true, overrideReason: 'Approver is unavailable today.' });

  assert.equal(normal.success, true);
  assert.equal(missingReason.success, false);
  assert.equal(override.success, true);
});
