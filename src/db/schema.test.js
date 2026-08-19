// src/db/schema.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');
const { createProvidersRepo } = require('./providers');
const { createSecretsService } = require('../crypto/secrets');

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
  assert.deepEqual(applied, ['0001_baseline', '0002_user_profile', '0003_provider_active_in_workspace']);
  db.close();
});

test('a migration already recorded as applied is genuinely skipped, not just idempotent by luck', () => {
  const db = createConnection(':memory:');
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));");
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0001_baseline')").run();
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0002_user_profile')").run();
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0003_provider_active_in_workspace')").run();
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

test('a migration adding a column to an existing table never touches existing rows in it', () => {
  const db = createConnection(':memory:');
  // Simulate a real, already-running database that only has migrations
  // 0001 and 0002 applied - i.e. an install from before this task shipped,
  // with real data already in it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id), path TEXT NOT NULL, title TEXT, mime_type TEXT NOT NULL DEFAULT 'text/markdown', content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(project_id, path));
    CREATE TABLE IF NOT EXISTS ai_providers (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, base_url TEXT NOT NULL, api_key_encrypted TEXT NOT NULL, default_model TEXT, avatar_url TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS user_profile (id INTEGER PRIMARY KEY CHECK (id = 1), label TEXT NOT NULL DEFAULT 'You', avatar_url TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO schema_migrations (id) VALUES ('0001_baseline');
    INSERT INTO schema_migrations (id) VALUES ('0002_user_profile');
    INSERT OR IGNORE INTO user_profile (id, label) VALUES (1, 'You');
  `);
  const secrets = createSecretsService(crypto.randomBytes(32).toString('base64'));
  const insertedId = db
    .prepare('INSERT INTO ai_providers (label, base_url, api_key_encrypted) VALUES (?, ?, ?)')
    .run('Existing Provider', 'http://example.com', secrets.encrypt('secret-key-1234')).lastInsertRowid;

  migrate(db);

  const columns = db.prepare('PRAGMA table_info(ai_providers)').all().map((c) => c.name);
  assert.ok(columns.includes('active_in_workspace'));
  const providers = createProvidersRepo(db, secrets);
  const stillThere = providers.getById(insertedId);
  assert.equal(stillThere.label, 'Existing Provider');
  assert.equal(stillThere.maskedKey, '•••• 1234');
  assert.equal(stillThere.activeInWorkspace, false);
  db.close();
});
