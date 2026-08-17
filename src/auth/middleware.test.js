// src/auth/middleware.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requireAuth, verifyPassword } = require('./middleware');
const { hashPassword } = require('../scripts/hash-password');

test('requireAuth calls next() when the session is authenticated', () => {
  let called = false;
  requireAuth({ session: { authenticated: true } }, {}, () => { called = true; });
  assert.equal(called, true);
});

test('requireAuth redirects to /login when not authenticated', () => {
  let redirectedTo = null;
  requireAuth({ session: {} }, { redirect: (to) => { redirectedTo = to; } }, () => {
    throw new Error('next() should not be called');
  });
  assert.equal(redirectedTo, '/login');
});

test('verifyPassword accepts the correct password and rejects wrong ones', () => {
  const hash = hashPassword('hunter2');
  assert.equal(verifyPassword('hunter2', hash), true);
  assert.equal(verifyPassword('nope', hash), false);
});

test('verifyPassword returns false when no hash is configured', () => {
  assert.equal(verifyPassword('anything', undefined), false);
});
