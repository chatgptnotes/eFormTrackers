const assert = require('assert');
const { findWorkflowOutcome } = require('../lib/workflow-task');

const outcomes = [
  { outcomeID: 1, type: 'APPROVE', text: 'Approve' },
  { outcomeID: 2, type: 'CUSTOM', text: 'Rejected' },
];

assert.strictEqual(findWorkflowOutcome(outcomes, 'approve').outcomeID, 1);
assert.strictEqual(findWorkflowOutcome(outcomes, 'reject').outcomeID, 2);
console.log('workflow outcome checks passed');
