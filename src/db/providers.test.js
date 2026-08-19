// src/db/providers.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');
const { createProvidersRepo } = require('./providers');
const { createSecretsService } = require('../crypto/secrets');

function setup() {
  const db = createConnection(':memory:');
  migrate(db);
  const secrets = createSecretsService(crypto.randomBytes(32).toString('base64'));
  return { db, secrets, providers: createProvidersRepo(db, secrets) };
}

test('create() stores a provider and returns a masked key, never the plaintext', () => {
  const { providers } = setup();
  const created = providers.create({
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'sk-abcdef1234',
    defaultModel: 'gpt-5'
  });
  assert.equal(created.label, 'OpenAI');
  assert.equal(created.baseUrl, 'https://api.openai.com/v1');
  assert.equal(created.defaultModel, 'gpt-5');
  assert.equal(created.maskedKey, '•••• 1234');
  assert.equal(JSON.stringify(created).includes('sk-abcdef1234'), false);
});

test('list() returns providers ordered by id, all with masked keys', () => {
  const { providers } = setup();
  providers.create({ label: 'A', baseUrl: 'http://a', apiKey: 'key-aaaa' });
  providers.create({ label: 'B', baseUrl: 'http://b', apiKey: 'key-bbbb' });
  const list = providers.list();
  assert.deepEqual(list.map((p) => p.label), ['A', 'B']);
  assert.equal(list[0].maskedKey, '•••• aaaa');
});

test('update() with a blank apiKey leaves the stored encrypted key unchanged', () => {
  const { providers } = setup();
  const created = providers.create({ label: 'A', baseUrl: 'http://a', apiKey: 'key-aaaa' });
  const updated = providers.update(created.id, {
    label: 'A renamed', baseUrl: 'http://a2', apiKey: '', defaultModel: null, avatarUrl: null
  });
  assert.equal(updated.label, 'A renamed');
  assert.equal(updated.maskedKey, '•••• aaaa');
});

test('update() with a new apiKey replaces the stored encrypted key', () => {
  const { providers } = setup();
  const created = providers.create({ label: 'A', baseUrl: 'http://a', apiKey: 'key-aaaa' });
  const updated = providers.update(created.id, {
    label: 'A', baseUrl: 'http://a', apiKey: 'key-zzzz', defaultModel: null, avatarUrl: null
  });
  assert.equal(updated.maskedKey, '•••• zzzz');
});

test('remove() deletes the provider', () => {
  const { providers } = setup();
  const created = providers.create({ label: 'A', baseUrl: 'http://a', apiKey: 'key-aaaa' });
  assert.equal(providers.remove(created.id), true);
  assert.equal(providers.getById(created.id), undefined);
});

test('avatarUrl round-trips through create and update', () => {
  const { providers } = setup();
  const created = providers.create({
    label: 'A', baseUrl: 'http://a', apiKey: 'key-aaaa', avatarUrl: 'https://example.com/a.png'
  });
  assert.equal(created.avatarUrl, 'https://example.com/a.png');
  const updated = providers.update(created.id, {
    label: 'A', baseUrl: 'http://a', apiKey: '', defaultModel: null, avatarUrl: 'https://example.com/b.png'
  });
  assert.equal(updated.avatarUrl, 'https://example.com/b.png');
});

test('create() stores ciphertext in the database, never the plaintext key', () => {
  const { db, providers } = setup();
  const created = providers.create({ label: 'A', baseUrl: 'http://a', apiKey: 'sk-super-secret-plaintext' });
  const row = db.prepare('SELECT api_key_encrypted FROM ai_providers WHERE id = ?').get(created.id);
  assert.ok(row, 'expected the row to exist');
  assert.notEqual(row.api_key_encrypted, 'sk-super-secret-plaintext');
  assert.equal(row.api_key_encrypted.includes('sk-super-secret-plaintext'), false);
});

test('a key of 4 characters or fewer is fully masked, not shown in full', () => {
  const { providers } = setup();
  const created = providers.create({ label: 'Short', baseUrl: 'http://a', apiKey: 'abcd' });
  assert.equal(created.maskedKey.includes('abcd'), false);
  assert.equal(created.maskedKey, '••••');

  const created2 = providers.create({ label: 'Shorter', baseUrl: 'http://a', apiKey: 'ab' });
  assert.equal(created2.maskedKey.includes('ab'), false);
});

test('a row that cannot be decrypted (e.g. stale/different ENCRYPTION_KEY) lists with a placeholder instead of throwing', () => {
  const { db, providers } = setup();
  const created = providers.create({ label: 'Undecryptable', baseUrl: 'http://a', apiKey: 'sk-abcdef1234' });

  // A second repo backed by a *different* secrets service, pointed at the
  // same database - simulates restoring a DB-only backup onto a host with a
  // different/missing ENCRYPTION_KEY. Decrypting the row's ciphertext with
  // the wrong key throws (AES-GCM auth tag mismatch).
  const otherSecrets = createSecretsService(crypto.randomBytes(32).toString('base64'));
  const providersWithWrongKey = createProvidersRepo(db, otherSecrets);

  assert.doesNotThrow(() => providersWithWrongKey.list());
  const listed = providersWithWrongKey.list().find((p) => p.id === created.id);
  assert.ok(listed, 'expected the un-decryptable row to still be listed');
  assert.equal(listed.maskedKey, '•••• (unreadable)');

  assert.doesNotThrow(() => providersWithWrongKey.getById(created.id));
  const byId = providersWithWrongKey.getById(created.id);
  assert.equal(byId.maskedKey, '•••• (unreadable)');
});

test('create() defaults activeInWorkspace to false when not provided', () => {
  const { providers } = setup();
  const created = providers.create({ label: 'A', baseUrl: 'http://a', apiKey: 'key-aaaa' });
  assert.equal(created.activeInWorkspace, false);
});

test('create() and update() persist activeInWorkspace as a real boolean', () => {
  const { providers } = setup();
  const created = providers.create({ label: 'A', baseUrl: 'http://a', apiKey: 'key-aaaa', activeInWorkspace: true });
  assert.equal(created.activeInWorkspace, true);
  const updated = providers.update(created.id, {
    label: 'A', baseUrl: 'http://a', apiKey: '', defaultModel: null, avatarUrl: null, activeInWorkspace: false
  });
  assert.equal(updated.activeInWorkspace, false);
});
