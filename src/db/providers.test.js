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
  return { providers: createProvidersRepo(db, secrets) };
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
