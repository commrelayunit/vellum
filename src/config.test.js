// src/config.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('./config');

test('loadConfig() applies defaults when env vars are missing', () => {
  const cfg = loadConfig({});
  assert.equal(cfg.port, 3001);
  assert.equal(cfg.authPasswordHash, null);
});

test('loadConfig() reads provided env vars', () => {
  const cfg = loadConfig({ PORT: '4000', DB_PATH: '/tmp/x.db', SESSION_SECRET: 's', AUTH_PASSWORD_HASH: 'h' });
  assert.equal(cfg.port, 4000);
  assert.equal(cfg.dbPath, '/tmp/x.db');
  assert.equal(cfg.sessionSecret, 's');
  assert.equal(cfg.authPasswordHash, 'h');
});
