// src/crypto/secrets.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createSecretsService } = require('./secrets');

test('encrypt() then decrypt() returns the original plaintext', () => {
  const key = crypto.randomBytes(32).toString('base64');
  const secrets = createSecretsService(key);
  const ciphertext = secrets.encrypt('sk-super-secret-key');
  assert.equal(secrets.decrypt(ciphertext), 'sk-super-secret-key');
});

test('encrypt() output does not contain the plaintext', () => {
  const key = crypto.randomBytes(32).toString('base64');
  const secrets = createSecretsService(key);
  const ciphertext = secrets.encrypt('sk-super-secret-key');
  assert.equal(ciphertext.includes('sk-super-secret-key'), false);
});

test('decrypt() fails when the key is wrong', () => {
  const secretsA = createSecretsService(crypto.randomBytes(32).toString('base64'));
  const secretsB = createSecretsService(crypto.randomBytes(32).toString('base64'));
  const ciphertext = secretsA.encrypt('sk-super-secret-key');
  assert.throws(() => secretsB.decrypt(ciphertext));
});

test('encrypt() throws a clear error when no key is configured', () => {
  const secrets = createSecretsService(null);
  assert.throws(() => secrets.encrypt('anything'), /ENCRYPTION_KEY/);
});

test('encrypt() throws a clear error when the key is the wrong length', () => {
  const secrets = createSecretsService(Buffer.from('too-short').toString('base64'));
  assert.throws(() => secrets.encrypt('anything'), /ENCRYPTION_KEY/);
});
