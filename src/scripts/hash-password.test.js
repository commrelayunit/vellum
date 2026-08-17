const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { hashPassword } = require('./hash-password');

test('hashPassword() produces a hash bcrypt.compareSync accepts', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.equal(bcrypt.compareSync('correct horse battery staple', hash), true);
  assert.equal(bcrypt.compareSync('wrong password', hash), false);
});
