const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');

test('migrate creates the projects, files, ai_providers, and user_profile tables', () => {
  const db = createConnection(':memory:');
  migrate(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ['ai_providers', 'files', 'projects', 'schema_migrations', 'user_profile']);
  db.close();
});

test('migrate records each migration exactly once, even when called twice', () => {
  const db = createConnection(':memory:');
  migrate(db);
  migrate(db);
  const applied = db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id);
  assert.deepEqual(applied, ['0001_baseline', '0002_user_profile']);
  db.close();
});

test('a migration already recorded as applied is genuinely skipped, not just idempotent by luck', () => {
  const db = createConnection(':memory:');
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));");
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0001_baseline')").run();
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0002_user_profile')").run();
  migrate(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ['schema_migrations']);
  db.close();
});

test('migrate seeds a default user_profile row', () => {
  const db = createConnection(':memory:');
  migrate(db);
  const row = db.prepare('SELECT * FROM user_profile WHERE id = 1').get();
  assert.equal(row.label, 'You');
  db.close();
});
