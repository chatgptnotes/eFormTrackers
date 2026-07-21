const assert = require('assert');
const { ownerFrom } = require('../lib/profile-owner');

assert.deepStrictEqual(
  ownerFrom({ content: { username: 'bk683', name: 'Murali', email: 'bk@bettroi.com' } }),
  { username: 'bk683', name: 'Murali', email: 'bk@bettroi.com' }
);
console.log('profile owner checks passed');
