const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');

test('migrate creates the projects and files tables', () => {
  const db = createConnection(':memory:');
  migrate(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ['files', 'projects']);
  db.close();
});

test('migrate is idempotent', () => {
  const db = createConnection(':memory:');
  migrate(db);
  assert.doesNotThrow(() => migrate(db));
  db.close();
});
