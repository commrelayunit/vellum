# Real AI Chat Completions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the writing view's decorative chat panel (canned echo, fake 1s-delayed reply) with real, streaming AI chat completions from a selected active provider, with conversation history persisted per file.

**Architecture:** Two small schema migrations extend the existing safe-migrations system (a `chat_messages` table, and a `default_reasoning_effort` column on `ai_providers`). A new `src/services/chat-completion.js` wraps the `openai` npm SDK behind an injectable client factory (matching this codebase's existing dependency-injection style), so it can be unit-tested without real network calls. Two new routes persist and stream a completion over Server-Sent-Event-formatted chunks; the chat panel's client-side JS is rewritten to load history on page load and render the stream as it arrives, replacing the mock entirely.

**Tech Stack:** Same as the rest of the app — `better-sqlite3`, Express, EJS, vanilla JS, `node:test`. Plus one new dependency: `openai` (the official SDK, pointed at each provider's stored `baseUrl`).

**Spec:** `docs/superpowers/specs/2026-08-19-real-ai-chat-completions-design.md`

## Global Constraints

- `migrate(db)`'s public signature and file location (`src/db/schema.js`, exporting `{ migrate }`) must not change — continues the numbered migration sequence already at `0001`-`0003`; this plan adds `0004` and `0005`.
- Every schema change to an *existing* table (`ai_providers`, in `0005`) must use real DDL (`ALTER TABLE ... ADD COLUMN`), never `CREATE TABLE IF NOT EXISTS`.
- `providers.js`'s new `getDecryptedApiKey(id)` method is server-only — it must never be returned from any HTTP response, logged, or reachable from client-side code. It is called only inside the new chat-completion route.
- The `openai` npm package is an intentional, approved new dependency for this plan only — a deliberate departure from every other feature built this session, which stayed dependency-free. Do not add any other new dependency.
- `default_reasoning_effort` is `NULL` ("none", omitted from the completion request) or exactly one of the strings `'low'` / `'medium'` / `'high'`.
- This plan is chat-only: the model replies in the chat panel; it never edits the document directly. No diff/apply mechanics.
- No automated test for the chat panel's streaming JS, matching the established no-frontend-test-runner precedent elsewhere in `main.js` — verified manually in a real browser.

---

### Task 1: `chat_messages` table and repository

**Files:**
- Create: `src/db/migrations/0004_chat_messages.js`
- Create: `src/db/chat-messages.js`
- Create: `src/db/chat-messages.test.js`
- Modify: `src/db/schema.test.js` (full rewrite)

**Interfaces:**
- Consumes: `createConnection`, `migrate` (existing).
- Produces: `createChatMessagesRepo(db) => { listForFile(fileId) => [{id, role, content, providerLabel, createdAt}, ...], create({fileId, role, content, providerLabel}) => same shape }`. `role` is one of `'user'` / `'assistant'` / `'error'`. `providerLabel` is `null` when omitted (e.g. for `role: 'user'` messages).

- [ ] **Step 1: Write the failing tests**

```js
// src/db/chat-messages.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');
const { createProjectsRepo } = require('./projects');
const { createFilesRepo } = require('./files');
const { createChatMessagesRepo } = require('./chat-messages');

function setup() {
  const db = createConnection(':memory:');
  migrate(db);
  const projects = createProjectsRepo(db);
  const files = createFilesRepo(db);
  const project = projects.create({ name: 'Test Project', description: '' });
  const fileA = files.create({ projectId: project.id, path: 'a.md', title: 'A', content: '# A' });
  const fileB = files.create({ projectId: project.id, path: 'b.md', title: 'B', content: '# B' });
  return { chatMessages: createChatMessagesRepo(db), fileA, fileB };
}

test('create() persists a message and returns it with a real id and timestamp', () => {
  const { chatMessages, fileA } = setup();
  const message = chatMessages.create({ fileId: fileA.id, role: 'user', content: 'Hello' });
  assert.equal(message.role, 'user');
  assert.equal(message.content, 'Hello');
  assert.equal(message.providerLabel, null);
  assert.ok(message.id);
  assert.ok(message.createdAt);
});

test('listForFile() returns messages for that file in creation order', () => {
  const { chatMessages, fileA } = setup();
  chatMessages.create({ fileId: fileA.id, role: 'user', content: 'First' });
  chatMessages.create({ fileId: fileA.id, role: 'assistant', content: 'Second', providerLabel: 'OpenClaw' });
  const list = chatMessages.listForFile(fileA.id);
  assert.deepEqual(list.map((m) => m.content), ['First', 'Second']);
  assert.equal(list[1].providerLabel, 'OpenClaw');
});

test("listForFile() keeps each file's history isolated from other files", () => {
  const { chatMessages, fileA, fileB } = setup();
  chatMessages.create({ fileId: fileA.id, role: 'user', content: 'For A' });
  chatMessages.create({ fileId: fileB.id, role: 'user', content: 'For B' });
  assert.deepEqual(chatMessages.listForFile(fileA.id).map((m) => m.content), ['For A']);
  assert.deepEqual(chatMessages.listForFile(fileB.id).map((m) => m.content), ['For B']);
});

test('create() persists a role of "error" for failed requests', () => {
  const { chatMessages, fileA } = setup();
  const message = chatMessages.create({ fileId: fileA.id, role: 'error', content: 'Request failed: 401 Unauthorized' });
  assert.equal(message.role, 'error');
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test src/db/chat-messages.test.js`
Expected: FAIL — `Cannot find module './chat-messages'`

- [ ] **Step 3: Create the migration**

```js
// src/db/migrations/0004_chat_messages.js
module.exports = {
  id: '0004_chat_messages',
  up(db) {
    db.exec(`
      CREATE TABLE chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES files(id),
        role TEXT NOT NULL CHECK (role IN ('user','assistant','error')),
        content TEXT NOT NULL,
        provider_label TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }
};
```

- [ ] **Step 4: Create the repository**

```js
// src/db/chat-messages.js
function toViewModel(row) {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    providerLabel: row.provider_label,
    createdAt: row.created_at
  };
}

function createChatMessagesRepo(db) {
  return {
    listForFile(fileId) {
      return db.prepare('SELECT * FROM chat_messages WHERE file_id = ? ORDER BY id').all(fileId).map(toViewModel);
    },
    create({ fileId, role, content, providerLabel }) {
      const info = db
        .prepare('INSERT INTO chat_messages (file_id, role, content, provider_label) VALUES (?, ?, ?, ?)')
        .run(fileId, role, content, providerLabel || null);
      return toViewModel(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get(info.lastInsertRowid));
    }
  };
}

module.exports = { createChatMessagesRepo };
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `node --test src/db/chat-messages.test.js`
Expected: PASS (4 tests)

- [ ] **Step 6: Update `schema.test.js`**

Replace the whole file (adds `chat_messages` to the table-list assertion and `'0004_chat_messages'` to both migration-id lists; every other test's content is otherwise unchanged from what's already shipped):

```js
// src/db/schema.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');
const { createProvidersRepo } = require('./providers');
const { createSecretsService } = require('../crypto/secrets');

test('migrate creates the projects, files, ai_providers, user_profile, and chat_messages tables', () => {
  const db = createConnection(':memory:');
  migrate(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ['ai_providers', 'chat_messages', 'files', 'projects', 'schema_migrations', 'user_profile']);
  db.close();
});

test('migrate records each migration exactly once, even when called twice', () => {
  const db = createConnection(':memory:');
  migrate(db);
  migrate(db);
  const applied = db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id);
  assert.deepEqual(applied, ['0001_baseline', '0002_user_profile', '0003_provider_active_in_workspace', '0004_chat_messages']);
  db.close();
});

test('a migration already recorded as applied is genuinely skipped, not just idempotent by luck', () => {
  const db = createConnection(':memory:');
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));");
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0001_baseline')").run();
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0002_user_profile')").run();
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0003_provider_active_in_workspace')").run();
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0004_chat_messages')").run();
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
```

- [ ] **Step 7: Run the tests and verify they pass**

Run: `node --test src/db/schema.test.js src/db/chat-messages.test.js`
Expected: PASS (9 tests)

- [ ] **Step 8: Run the full suite to check for regressions**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/db/migrations/0004_chat_messages.js src/db/chat-messages.js src/db/chat-messages.test.js src/db/schema.test.js
git commit -m "feat: add chat_messages table and repository"
```

---

### Task 2: `default_reasoning_effort` on `ai_providers`, and server-only decrypted-key access

**Files:**
- Create: `src/db/migrations/0005_provider_reasoning_effort.js`
- Modify: `src/db/providers.js` (full rewrite)
- Modify: `src/db/providers.test.js` (append tests, keep existing ones)
- Modify: `src/db/schema.test.js` (full rewrite — adds a second no-data-loss test for this migration)

**Interfaces:**
- Consumes: `createConnection`, `migrate`, `createSecretsService` (existing).
- Produces: `createProvidersRepo(db, secrets)`'s `create()`/`update()` now accept an optional `defaultReasoningEffort` string (`'low'`/`'medium'`/`'high'`, or omitted); every returned view-model includes `defaultReasoningEffort` (`null` when unset). A new method, `getDecryptedApiKey(id) => string | undefined`, returns the real plaintext key for a provider — this is the one place in the app that ever exposes a decrypted key.

- [ ] **Step 1: Write the failing tests**

Add to `src/db/providers.test.js` (append — do not remove the existing tests already in that file):

```js
test('create() and update() persist defaultReasoningEffort, defaulting to null', () => {
  const { providers } = setup();
  const created = providers.create({ label: 'A', baseUrl: 'http://a', apiKey: 'key-aaaa' });
  assert.equal(created.defaultReasoningEffort, null);
  const withEffort = providers.create({ label: 'B', baseUrl: 'http://b', apiKey: 'key-bbbb', defaultReasoningEffort: 'high' });
  assert.equal(withEffort.defaultReasoningEffort, 'high');
  const updated = providers.update(withEffort.id, {
    label: 'B', baseUrl: 'http://b', apiKey: '', defaultModel: null, avatarUrl: null, activeInWorkspace: false, defaultReasoningEffort: 'low'
  });
  assert.equal(updated.defaultReasoningEffort, 'low');
});

test('getDecryptedApiKey() returns the real plaintext key, not the masked version', () => {
  const { providers } = setup();
  const created = providers.create({ label: 'A', baseUrl: 'http://a', apiKey: 'sk-real-secret-key' });
  assert.equal(providers.getDecryptedApiKey(created.id), 'sk-real-secret-key');
});
```

Also replace `src/db/schema.test.js` in full (adds `'0005_provider_reasoning_effort'` to the migration-id lists, renames the existing no-data-loss test for clarity, and adds a second no-data-loss test for this task's own column addition):

```js
// src/db/schema.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');
const { createProvidersRepo } = require('./providers');
const { createSecretsService } = require('../crypto/secrets');

test('migrate creates the projects, files, ai_providers, user_profile, and chat_messages tables', () => {
  const db = createConnection(':memory:');
  migrate(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ['ai_providers', 'chat_messages', 'files', 'projects', 'schema_migrations', 'user_profile']);
  db.close();
});

test('migrate records each migration exactly once, even when called twice', () => {
  const db = createConnection(':memory:');
  migrate(db);
  migrate(db);
  const applied = db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id);
  assert.deepEqual(applied, ['0001_baseline', '0002_user_profile', '0003_provider_active_in_workspace', '0004_chat_messages', '0005_provider_reasoning_effort']);
  db.close();
});

test('a migration already recorded as applied is genuinely skipped, not just idempotent by luck', () => {
  const db = createConnection(':memory:');
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));");
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0001_baseline')").run();
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0002_user_profile')").run();
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0003_provider_active_in_workspace')").run();
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0004_chat_messages')").run();
  db.prepare("INSERT INTO schema_migrations (id) VALUES ('0005_provider_reasoning_effort')").run();
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

test('the 0003 migration adding active_in_workspace never touches pre-existing ai_providers rows', () => {
  const db = createConnection(':memory:');
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

test('the 0005 migration adding default_reasoning_effort never touches pre-existing ai_providers rows', () => {
  const db = createConnection(':memory:');
  // Simulate a real, already-running database with migrations 0001-0004
  // applied (i.e. right after chat_messages shipped, before reasoning
  // effort existed), with a real, active provider row already in it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS projects (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id), path TEXT NOT NULL, title TEXT, mime_type TEXT NOT NULL DEFAULT 'text/markdown', content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(project_id, path));
    CREATE TABLE IF NOT EXISTS ai_providers (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL, base_url TEXT NOT NULL, api_key_encrypted TEXT NOT NULL, default_model TEXT, avatar_url TEXT, active_in_workspace INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS user_profile (id INTEGER PRIMARY KEY CHECK (id = 1), label TEXT NOT NULL DEFAULT 'You', avatar_url TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, file_id INTEGER NOT NULL REFERENCES files(id), role TEXT NOT NULL CHECK (role IN ('user','assistant','error')), content TEXT NOT NULL, provider_label TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    INSERT INTO schema_migrations (id) VALUES ('0001_baseline');
    INSERT INTO schema_migrations (id) VALUES ('0002_user_profile');
    INSERT INTO schema_migrations (id) VALUES ('0003_provider_active_in_workspace');
    INSERT INTO schema_migrations (id) VALUES ('0004_chat_messages');
    INSERT OR IGNORE INTO user_profile (id, label) VALUES (1, 'You');
  `);
  const secrets = createSecretsService(crypto.randomBytes(32).toString('base64'));
  const insertedId = db
    .prepare('INSERT INTO ai_providers (label, base_url, api_key_encrypted, active_in_workspace) VALUES (?, ?, ?, ?)')
    .run('Existing Provider', 'http://example.com', secrets.encrypt('secret-key-1234'), 1).lastInsertRowid;

  migrate(db);

  const columns = db.prepare('PRAGMA table_info(ai_providers)').all().map((c) => c.name);
  assert.ok(columns.includes('default_reasoning_effort'));
  const providers = createProvidersRepo(db, secrets);
  const stillThere = providers.getById(insertedId);
  assert.equal(stillThere.label, 'Existing Provider');
  assert.equal(stillThere.maskedKey, '•••• 1234');
  assert.equal(stillThere.activeInWorkspace, true);
  assert.equal(stillThere.defaultReasoningEffort, null);
  db.close();
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test src/db/schema.test.js src/db/providers.test.js`
Expected: FAIL — no `0005_provider_reasoning_effort` migration exists yet; `providers.js` doesn't know about `defaultReasoningEffort` or `getDecryptedApiKey` yet.

- [ ] **Step 3: Create the migration**

```js
// src/db/migrations/0005_provider_reasoning_effort.js
module.exports = {
  id: '0005_provider_reasoning_effort',
  up(db) {
    db.exec('ALTER TABLE ai_providers ADD COLUMN default_reasoning_effort TEXT');
  }
};
```

- [ ] **Step 4: Update the providers repository**

Replace the whole file:

```js
// src/db/providers.js
const UNREADABLE_KEY_LABEL = '•••• (unreadable)';

function maskKey(plaintext) {
  if (plaintext.length <= 4) {
    return '•'.repeat(Math.max(plaintext.length, 4));
  }
  const last4 = plaintext.slice(-4);
  return `•••• ${last4}`;
}

function toViewModel(row, secrets) {
  let maskedKey;
  try {
    maskedKey = maskKey(secrets.decrypt(row.api_key_encrypted));
  } catch {
    maskedKey = UNREADABLE_KEY_LABEL;
  }
  return {
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    maskedKey,
    defaultModel: row.default_model,
    avatarUrl: row.avatar_url,
    activeInWorkspace: !!row.active_in_workspace,
    defaultReasoningEffort: row.default_reasoning_effort,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createProvidersRepo(db, secrets) {
  return {
    list() {
      return db.prepare('SELECT * FROM ai_providers ORDER BY id').all().map((row) => toViewModel(row, secrets));
    },
    getById(id) {
      const row = db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id);
      return row ? toViewModel(row, secrets) : undefined;
    },
    getDecryptedApiKey(id) {
      const row = db.prepare('SELECT api_key_encrypted FROM ai_providers WHERE id = ?').get(id);
      return row ? secrets.decrypt(row.api_key_encrypted) : undefined;
    },
    create({ label, baseUrl, apiKey, defaultModel, avatarUrl, activeInWorkspace, defaultReasoningEffort }) {
      const info = db
        .prepare('INSERT INTO ai_providers (label, base_url, api_key_encrypted, default_model, avatar_url, active_in_workspace, default_reasoning_effort) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(label, baseUrl, secrets.encrypt(apiKey), defaultModel || null, avatarUrl || null, activeInWorkspace ? 1 : 0, defaultReasoningEffort || null);
      return this.getById(info.lastInsertRowid);
    },
    update(id, { label, baseUrl, apiKey, defaultModel, avatarUrl, activeInWorkspace, defaultReasoningEffort }) {
      if (apiKey) {
        db.prepare(
          "UPDATE ai_providers SET label = ?, base_url = ?, api_key_encrypted = ?, default_model = ?, avatar_url = ?, active_in_workspace = ?, default_reasoning_effort = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(label, baseUrl, secrets.encrypt(apiKey), defaultModel || null, avatarUrl || null, activeInWorkspace ? 1 : 0, defaultReasoningEffort || null, id);
      } else {
        db.prepare(
          "UPDATE ai_providers SET label = ?, base_url = ?, default_model = ?, avatar_url = ?, active_in_workspace = ?, default_reasoning_effort = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(label, baseUrl, defaultModel || null, avatarUrl || null, activeInWorkspace ? 1 : 0, defaultReasoningEffort || null, id);
      }
      return this.getById(id);
    },
    remove(id) {
      const info = db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id);
      return info.changes > 0;
    }
  };
}

module.exports = { createProvidersRepo };
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `node --test src/db/schema.test.js src/db/providers.test.js`
Expected: PASS (10 tests in schema.test.js + providers.test.js's existing tests + 2 new ones)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/db/migrations/0005_provider_reasoning_effort.js src/db/providers.js src/db/providers.test.js src/db/schema.test.js
git commit -m "feat: add default_reasoning_effort and server-only decrypted-key access to providers"
```

---

### Task 3: `openai` dependency and the chat-completion service

**Files:**
- Modify: `package.json` (add `openai` dependency)
- Create: `src/services/chat-completion.js`
- Create: `src/services/chat-completion.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks directly (pure service, takes all data as parameters).
- Produces: `createChatCompletionService({ createClient } = {}) => { complete({apiKey, baseUrl, model, reasoningEffort, filePath, fileContent, history, userMessage, onDelta}) => Promise<string> }`. `createClient` is an optional factory `(apiKey, baseURL) => client` (where `client.chat.completions.create(request)` returns an async-iterable stream of OpenAI-shaped chunks); defaults to `(apiKey, baseURL) => new OpenAI({ apiKey, baseURL })`. `history` is an array of `{role, content}` (the shape `chatMessagesRepo.listForFile()` returns). `onDelta(text)` is called once per streamed text chunk. The returned promise resolves to the full assembled reply text, or rejects if the client throws.

- [ ] **Step 1: Add the dependency**

In `package.json`, add to `"dependencies"` (alphabetically, after `"express-session"`):

```json
    "openai": "^7.5.0",
```

Run: `npm install`
Expected: `openai` appears in `node_modules/` and `package-lock.json` is updated.

- [ ] **Step 2: Write the failing tests**

```js
// src/services/chat-completion.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChatCompletionService } = require('./chat-completion');

function fakeClient(chunks) {
  return {
    chat: {
      completions: {
        create: async () => ({
          [Symbol.asyncIterator]: async function* () {
            for (const chunk of chunks) yield chunk;
          }
        })
      }
    }
  };
}

function capturingClient(capture) {
  return {
    chat: {
      completions: {
        create: async (request) => {
          capture.request = request;
          return { [Symbol.asyncIterator]: async function* () {} };
        }
      }
    }
  };
}

test('complete() streams deltas via onDelta and returns the full assembled text', async () => {
  const chunks = [
    { choices: [{ delta: { content: 'Hel' } }] },
    { choices: [{ delta: { content: 'lo' } }] }
  ];
  const service = createChatCompletionService({ createClient: () => fakeClient(chunks) });
  const deltas = [];
  const fullText = await service.complete({
    apiKey: 'key', baseUrl: 'http://x', model: 'gpt-5',
    filePath: 'a.md', fileContent: '# A', history: [], userMessage: 'hi',
    onDelta: (d) => deltas.push(d)
  });
  assert.equal(fullText, 'Hello');
  assert.deepEqual(deltas, ['Hel', 'lo']);
});

test('complete() includes the file path and content in a system message', async () => {
  const capture = {};
  const service = createChatCompletionService({ createClient: () => capturingClient(capture) });
  await service.complete({
    apiKey: 'key', baseUrl: 'http://x', model: 'gpt-5',
    filePath: 'notes.md', fileContent: '# My Notes', history: [], userMessage: 'hi', onDelta: () => {}
  });
  assert.equal(capture.request.messages[0].role, 'system');
  assert.match(capture.request.messages[0].content, /notes\.md/);
  assert.match(capture.request.messages[0].content, /# My Notes/);
});

test('complete() includes reasoning_effort only when provided', async () => {
  const capture = {};
  const service = createChatCompletionService({ createClient: () => capturingClient(capture) });
  await service.complete({ apiKey: 'k', baseUrl: 'http://x', model: 'm', reasoningEffort: 'high', filePath: 'a.md', fileContent: '', history: [], userMessage: 'hi', onDelta: () => {} });
  assert.equal(capture.request.reasoning_effort, 'high');

  await service.complete({ apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '', history: [], userMessage: 'hi', onDelta: () => {} });
  assert.equal('reasoning_effort' in capture.request, false);
});

test('complete() maps persisted history into the request, translating a prior error role to assistant', async () => {
  const capture = {};
  const service = createChatCompletionService({ createClient: () => capturingClient(capture) });
  await service.complete({
    apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '',
    history: [{ role: 'user', content: 'first' }, { role: 'error', content: 'oops' }],
    userMessage: 'second', onDelta: () => {}
  });
  assert.deepEqual(capture.request.messages.slice(1), [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'oops' },
    { role: 'user', content: 'second' }
  ]);
});

test('complete() propagates a rejection when the client throws', async () => {
  const client = { chat: { completions: { create: async () => { throw new Error('401 Unauthorized'); } } } };
  const service = createChatCompletionService({ createClient: () => client });
  await assert.rejects(
    () => service.complete({ apiKey: 'k', baseUrl: 'http://x', model: 'm', filePath: 'a.md', fileContent: '', history: [], userMessage: 'hi', onDelta: () => {} }),
    /401 Unauthorized/
  );
});
```

- [ ] **Step 3: Run the tests and verify they fail**

Run: `node --test src/services/chat-completion.test.js`
Expected: FAIL — `Cannot find module './chat-completion'`

- [ ] **Step 4: Create the service**

```js
// src/services/chat-completion.js
const OpenAI = require('openai');

function buildSystemPrompt(filePath, fileContent) {
  return `You are an AI assistant helping edit a document called ${filePath}. Current document content:\n\n${fileContent}`;
}

function toRequestMessage(message) {
  return { role: message.role === 'error' ? 'assistant' : message.role, content: message.content };
}

function createChatCompletionService({ createClient } = {}) {
  const clientFactory = createClient || ((apiKey, baseURL) => new OpenAI({ apiKey, baseURL }));

  return {
    async complete({ apiKey, baseUrl, model, reasoningEffort, filePath, fileContent, history, userMessage, onDelta }) {
      const client = clientFactory(apiKey, baseUrl);
      const messages = [
        { role: 'system', content: buildSystemPrompt(filePath, fileContent) },
        ...history.map(toRequestMessage),
        { role: 'user', content: userMessage }
      ];
      const requestBody = { model, messages, stream: true };
      if (reasoningEffort) {
        requestBody.reasoning_effort = reasoningEffort;
      }
      const stream = await client.chat.completions.create(requestBody);
      let fullText = '';
      for await (const chunk of stream) {
        const delta = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
        if (delta) {
          fullText += delta;
          onDelta(delta);
        }
      }
      return fullText;
    }
  };
}

module.exports = { createChatCompletionService };
```

- [ ] **Step 5: Run the tests and verify they pass**

Run: `node --test src/services/chat-completion.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/services/chat-completion.js src/services/chat-completion.test.js
git commit -m "feat: add openai dependency and a chat-completion service"
```

---

### Task 4: Chat routes with SSE streaming

**Files:**
- Modify: `src/server.js`
- Modify: `src/server.test.js`

**Interfaces:**
- Consumes: `createChatMessagesRepo` (Task 1), `providersRepo.getDecryptedApiKey`/`defaultReasoningEffort` (Task 2), `createChatCompletionService` (Task 3).
- Produces: `chatMessagesRepo` instantiated at server startup; `app.locals.chatCompletionService` (an Express app-level slot the route reads from, so tests can substitute a fake service without touching the module's real network-calling default). `GET /api/chat/:fileId/messages` (`requireAuth`) returns `{success: true, messages}`. `POST /api/chat/:fileId/messages` (`requireAuth`) accepts `{providerId, message}`, persists the user message, streams the reply as newline-delimited SSE frames (`data: {"type":"delta","text":"..."}\n\n`, ending in `data: {"type":"done"}\n\n` on success or `data: {"type":"error","message":"..."}\n\n` on failure), and persists the assistant/error message once the stream ends.

- [ ] **Step 1: Write the failing tests**

Add to `src/server.test.js`:

```js
test('GET /api/chat/:fileId/messages returns an empty list for a file with no history', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createProject = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Chat Empty Project' })
  });
  const { file } = await createProject.json();
  const res = await fetch(`${base}/api/chat/${file.id}/messages`, { headers: { Cookie: cookie } });
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(data.messages, []);
  server.close();
});

test('POST /api/chat/:fileId/messages persists the user message and the streamed assistant reply', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);

  const createProject = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Chat Reply Project' })
  });
  const { file } = await createProject.json();

  const createProvider = await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Fake Provider', baseUrl: 'http://fake', apiKey: 'key-zzzz' })
  });
  const { provider } = await createProvider.json();
  await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Fake Provider', baseUrl: 'http://fake', apiKey: '', activeInWorkspace: true })
  });

  app.locals.chatCompletionService = {
    complete: async ({ onDelta }) => {
      onDelta('Hel');
      onDelta('lo');
      return 'Hello';
    }
  };

  const res = await fetch(`${base}/api/chat/${file.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ providerId: provider.id, message: 'Hi there' })
  });
  const body = await res.text();
  assert.match(body, /"type":"delta","text":"Hel"/);
  assert.match(body, /"type":"delta","text":"lo"/);
  assert.match(body, /"type":"done"/);

  const historyRes = await fetch(`${base}/api/chat/${file.id}/messages`, { headers: { Cookie: cookie } });
  const { messages } = await historyRes.json();
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'Hi there');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].content, 'Hello');
  assert.equal(messages[1].providerLabel, 'Fake Provider');
  server.close();
});

test('POST /api/chat/:fileId/messages persists a role:"error" message when the provider call fails', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);

  const createProject = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Chat Error Project' })
  });
  const { file } = await createProject.json();

  const createProvider = await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Failing Provider', baseUrl: 'http://fake', apiKey: 'key-yyyy' })
  });
  const { provider } = await createProvider.json();
  await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Failing Provider', baseUrl: 'http://fake', apiKey: '', activeInWorkspace: true })
  });

  app.locals.chatCompletionService = {
    complete: async () => { throw new Error('simulated failure'); }
  };

  const res = await fetch(`${base}/api/chat/${file.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ providerId: provider.id, message: 'Break please' })
  });
  const body = await res.text();
  assert.match(body, /"type":"error"/);
  assert.match(body, /simulated failure/);

  const historyRes = await fetch(`${base}/api/chat/${file.id}/messages`, { headers: { Cookie: cookie } });
  const { messages } = await historyRes.json();
  assert.equal(messages[1].role, 'error');
  server.close();
});

test('POST /api/chat/:fileId/messages rejects a provider that is not active in the workspace', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);

  const createProject = await fetch(`${base}/api/projects`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ name: 'Chat Inactive Project' })
  });
  const { file } = await createProject.json();

  const createProvider = await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Inactive Provider', baseUrl: 'http://fake', apiKey: 'key-wwww' })
  });
  const { provider } = await createProvider.json();

  const res = await fetch(`${base}/api/chat/${file.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ providerId: provider.id, message: 'Should fail' })
  });
  assert.equal(res.status, 400);
  server.close();
});

test('unauthenticated GET /api/chat/:fileId/messages redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/chat/1/messages`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  server.close();
});

test('unauthenticated POST /api/chat/:fileId/messages redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/chat/1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ providerId: 1, message: 'x' }),
    redirect: 'manual'
  });
  assert.equal(res.status, 302);
  server.close();
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test src/server.test.js`
Expected: FAIL — the chat routes don't exist yet (404s)

- [ ] **Step 3: Wire it into `server.js`**

Add these requires near the other `./db/*` requires:

```js
const { createChatMessagesRepo } = require('./db/chat-messages');
const { createChatCompletionService } = require('./services/chat-completion');
```

Add this line right after `const userProfileRepo = createUserProfileRepo(db);`:

```js
const chatMessagesRepo = createChatMessagesRepo(db);
```

Right after `const app = express();`, add:

```js
app.locals.chatCompletionService = createChatCompletionService();
```

Add the two routes after the existing `POST /api/profile` handler, before the `if (process.env.NODE_ENV === 'production')` block:

```js
function writeSseEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

app.get('/api/chat/:fileId/messages', requireAuth, (req, res) => {
  const fileId = parseInt(req.params.fileId, 10);
  res.json({ success: true, messages: chatMessagesRepo.listForFile(fileId) });
});

app.post('/api/chat/:fileId/messages', requireAuth, async (req, res) => {
  const fileId = parseInt(req.params.fileId, 10);
  const file = filesRepo.getById(fileId);
  if (!file) {
    return res.status(404).json({ success: false, message: 'File not found' });
  }
  const { providerId, message } = req.body;
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ success: false, message: 'Message is required' });
  }
  const provider = providersRepo.getById(parseInt(providerId, 10));
  if (!provider || !provider.activeInWorkspace) {
    return res.status(400).json({ success: false, message: 'Provider is not active in this workspace' });
  }

  const trimmedMessage = message.trim();
  chatMessagesRepo.create({ fileId, role: 'user', content: trimmedMessage });
  const history = chatMessagesRepo.listForFile(fileId).slice(0, -1);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');

  try {
    const apiKey = providersRepo.getDecryptedApiKey(provider.id);
    const fullText = await req.app.locals.chatCompletionService.complete({
      apiKey,
      baseUrl: provider.baseUrl,
      model: provider.defaultModel,
      reasoningEffort: provider.defaultReasoningEffort,
      filePath: file.path,
      fileContent: file.content,
      history,
      userMessage: trimmedMessage,
      onDelta: (delta) => writeSseEvent(res, { type: 'delta', text: delta })
    });
    chatMessagesRepo.create({ fileId, role: 'assistant', content: fullText, providerLabel: provider.label });
    writeSseEvent(res, { type: 'done' });
    res.end();
  } catch (err) {
    const errorText = `Request failed: ${err.message}`;
    chatMessagesRepo.create({ fileId, role: 'error', content: errorText });
    writeSseEvent(res, { type: 'error', message: errorText });
    res.end();
  }
});
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `node --test src/server.test.js`
Expected: PASS (all tests, 6 new ones included)

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server.js src/server.test.js
git commit -m "feat: add streaming chat-completion routes"
```

---

### Task 5: Settings UI — reasoning effort field

**Files:**
- Modify: `src/server.js` (`POST /api/providers` and `POST /api/providers/:id` accept `defaultReasoningEffort`)
- Modify: `src/server.test.js`
- Modify: `src/views/settings.ejs`
- Modify: `src/views/views.test.js`
- Modify: `src/public/js/main.js`
- Modify: `src/public/css/style.css`

**Interfaces:**
- Consumes: `providersRepo` with `defaultReasoningEffort` support (Task 2).
- Produces: `POST /api/providers` and `POST /api/providers/:id` now accept an optional `defaultReasoningEffort` string in the body, normalized the same way `defaultModel` already is (trimmed non-empty string, or `null`).

- [ ] **Step 1: Write the failing tests**

Add to `src/server.test.js`:

```js
test('POST /api/providers persists defaultReasoningEffort', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Effort Test', baseUrl: 'http://x', apiKey: 'key-vvvv', defaultReasoningEffort: 'medium' })
  });
  const { provider } = await res.json();
  assert.equal(provider.defaultReasoningEffort, 'medium');
  server.close();
});

test('GET /settings renders the reasoning effort field for editing', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  await fetch(`${base}/api/providers`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'Effort Render Test', baseUrl: 'http://x', apiKey: 'key-uuuu', defaultReasoningEffort: 'high' })
  });
  const res = await fetch(`${base}/settings`, { headers: { Cookie: cookie } });
  const body = await res.text();
  assert.match(body, /data-default-reasoning-effort="high"/);
  server.close();
});
```

Add to `src/views/views.test.js`:

```js
test('settings.ejs renders a provider card with its reasoning effort data attribute', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'settings.ejs'), {
    providers: [{ id: 1, label: 'Test', baseUrl: 'http://x', maskedKey: '•••• aaaa', defaultModel: null, avatarUrl: null, activeInWorkspace: false, defaultReasoningEffort: 'low' }],
    profile: { label: 'Test Person', avatarUrl: null }
  });
  assert.match(html, /data-default-reasoning-effort="low"/);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test src/server.test.js src/views/views.test.js`
Expected: FAIL — routes ignore `defaultReasoningEffort`; `settings.ejs` doesn't render the attribute.

- [ ] **Step 3: Update `POST /api/providers` and `POST /api/providers/:id` in `server.js`**

Replace the `POST /api/providers` handler:

```js
app.post('/api/providers', requireAuth, (req, res) => {
  const { label, baseUrl, apiKey, defaultModel, avatarUrl, defaultReasoningEffort } = req.body;
  if (typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ success: false, message: 'Label is required' });
  }
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return res.status(400).json({ success: false, message: 'Base URL is required' });
  }
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    return res.status(400).json({ success: false, message: 'API key is required' });
  }
  const provider = providersRepo.create({
    label: label.trim(),
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    defaultModel: typeof defaultModel === 'string' && defaultModel.trim() ? defaultModel.trim() : null,
    avatarUrl: typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl.trim() : null,
    defaultReasoningEffort: typeof defaultReasoningEffort === 'string' && defaultReasoningEffort.trim() ? defaultReasoningEffort.trim() : null
  });
  res.status(201).json({ success: true, provider });
});
```

Replace the `POST /api/providers/:id` handler:

```js
app.post('/api/providers/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { label, baseUrl, apiKey, defaultModel, avatarUrl, activeInWorkspace, defaultReasoningEffort } = req.body;
  if (typeof label !== 'string' || !label.trim()) {
    return res.status(400).json({ success: false, message: 'Label is required' });
  }
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    return res.status(400).json({ success: false, message: 'Base URL is required' });
  }
  const existing = providersRepo.getById(id);
  if (!existing) {
    return res.status(404).json({ success: false, message: 'Provider not found' });
  }
  const provider = providersRepo.update(id, {
    label: label.trim(),
    baseUrl: baseUrl.trim(),
    apiKey: typeof apiKey === 'string' ? apiKey.trim() : '',
    defaultModel: typeof defaultModel === 'string' && defaultModel.trim() ? defaultModel.trim() : null,
    avatarUrl: typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl.trim() : null,
    activeInWorkspace: typeof activeInWorkspace === 'boolean' ? activeInWorkspace : existing.activeInWorkspace,
    defaultReasoningEffort: typeof defaultReasoningEffort === 'string' && defaultReasoningEffort.trim() ? defaultReasoningEffort.trim() : null
  });
  res.json({ success: true, provider });
});
```

- [ ] **Step 4: Add the data attribute in `settings.ejs`**

Find:

```ejs
            <div class="provider-card" data-provider-id="<%= provider.id %>" data-label="<%= provider.label %>" data-base-url="<%= provider.baseUrl %>" data-default-model="<%= provider.defaultModel || '' %>" data-avatar-url="<%= provider.avatarUrl || '' %>">
```

Replace with:

```ejs
            <div class="provider-card" data-provider-id="<%= provider.id %>" data-label="<%= provider.label %>" data-base-url="<%= provider.baseUrl %>" data-default-model="<%= provider.defaultModel || '' %>" data-default-reasoning-effort="<%= provider.defaultReasoningEffort || '' %>" data-avatar-url="<%= provider.avatarUrl || '' %>">
```

- [ ] **Step 5: Add the reasoning-effort select to `buildProviderForm` in `main.js`**

Find:

```js
            const defaultModelInput = document.createElement('input');
            defaultModelInput.type = 'text';
            defaultModelInput.placeholder = 'Default model (optional)';
            defaultModelInput.autocomplete = 'off';
            defaultModelInput.value = existing ? existing.defaultModel : '';

            const avatarUrlInput = document.createElement('input');
```

Replace with:

```js
            const defaultModelInput = document.createElement('input');
            defaultModelInput.type = 'text';
            defaultModelInput.placeholder = 'Default model (optional)';
            defaultModelInput.autocomplete = 'off';
            defaultModelInput.value = existing ? existing.defaultModel : '';

            const reasoningEffortSelect = document.createElement('select');
            [
                { value: '', label: 'Reasoning effort: none' },
                { value: 'low', label: 'Reasoning effort: low' },
                { value: 'medium', label: 'Reasoning effort: medium' },
                { value: 'high', label: 'Reasoning effort: high' }
            ].forEach(function(opt) {
                const optionEl = document.createElement('option');
                optionEl.value = opt.value;
                optionEl.textContent = opt.label;
                reasoningEffortSelect.appendChild(optionEl);
            });
            reasoningEffortSelect.value = existing ? (existing.defaultReasoningEffort || '') : '';

            const avatarUrlInput = document.createElement('input');
```

Find:

```js
            form.appendChild(labelInput);
            form.appendChild(baseUrlInput);
            form.appendChild(apiKeyInput);
            form.appendChild(defaultModelInput);
            form.appendChild(avatarUrlInput);
```

Replace with:

```js
            form.appendChild(labelInput);
            form.appendChild(baseUrlInput);
            form.appendChild(apiKeyInput);
            form.appendChild(defaultModelInput);
            form.appendChild(reasoningEffortSelect);
            form.appendChild(avatarUrlInput);
```

Find:

```js
                const payload = {
                    label: labelInput.value.trim(),
                    baseUrl: baseUrlInput.value.trim(),
                    apiKey: apiKeyInput.value.trim(),
                    defaultModel: defaultModelInput.value.trim(),
                    avatarUrl: avatarUrlInput.value.trim()
                };
```

Replace with:

```js
                const payload = {
                    label: labelInput.value.trim(),
                    baseUrl: baseUrlInput.value.trim(),
                    apiKey: apiKeyInput.value.trim(),
                    defaultModel: defaultModelInput.value.trim(),
                    defaultReasoningEffort: reasoningEffortSelect.value,
                    avatarUrl: avatarUrlInput.value.trim()
                };
```

Find (inside the `providersList.addEventListener('click', ...)` edit-button handler):

```js
                const existing = {
                    id: card.dataset.providerId,
                    label: card.dataset.label,
                    baseUrl: card.dataset.baseUrl,
                    defaultModel: card.dataset.defaultModel,
                    avatarUrl: card.dataset.avatarUrl
                };
```

Replace with:

```js
                const existing = {
                    id: card.dataset.providerId,
                    label: card.dataset.label,
                    baseUrl: card.dataset.baseUrl,
                    defaultModel: card.dataset.defaultModel,
                    defaultReasoningEffort: card.dataset.defaultReasoningEffort,
                    avatarUrl: card.dataset.avatarUrl
                };
```

- [ ] **Step 6: Add select styling in `style.css`**

Find:

```css
.provider-form input {
  background: none;
  border: none;
  font-family: inherit;
  font-size: 12px;
  color: var(--ink);
  padding: 0.25rem;
}
```

Replace with:

```css
.provider-form input,
.provider-form select {
  background: none;
  border: none;
  font-family: inherit;
  font-size: 12px;
  color: var(--ink);
  padding: 0.25rem;
}
```

- [ ] **Step 7: Run the tests and verify they pass**

Run: `node --test src/server.test.js src/views/views.test.js`
Expected: PASS (all tests, 3 new ones included)

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/server.js src/server.test.js src/views/settings.ejs src/views/views.test.js src/public/js/main.js src/public/css/style.css
git commit -m "feat: add reasoning effort field to the provider settings form"
```

---

### Task 6: Chat panel — real streaming send/receive and persisted history

**Files:**
- Modify: `src/views/writing.ejs`
- Modify: `src/views/views.test.js`
- Modify: `src/public/js/main.js` (full replacement of the chat functionality block)
- Modify: `src/public/css/style.css`

**Interfaces:**
- Consumes: `GET`/`POST /api/chat/:fileId/messages` (Task 4), `activeProviders` (already passed to `writing.ejs` by `GET /writing`), the existing `#markdown-editor[data-file-id]` attribute (already rendered).
- Produces: no new interfaces for other tasks to consume — this is the final task in the plan.

- [ ] **Step 1: Write the failing tests**

Add to `src/views/views.test.js`:

```js
test('writing.ejs renders a provider selector when providers are active', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    profile: { label: 'Real User', avatarUrl: null },
    activeProviders: [{ id: 7, label: 'Active Agent', avatarUrl: null }]
  });
  assert.match(html, /id="chat-provider-select"/);
  assert.match(html, /<option value="7">Active Agent<\/option>/);
  assert.doesNotMatch(html, /id="chat-input"[^>]*disabled/);
});

test('writing.ejs disables chat input when no providers are active', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' },
    profile: { label: 'Solo User', avatarUrl: null },
    activeProviders: []
  });
  assert.doesNotMatch(html, /id="chat-provider-select"/);
  assert.match(html, /id="chat-input"[^>]*disabled/);
  assert.match(html, /id="send-chat-btn"[^>]*disabled/);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `node --test src/views/views.test.js`
Expected: FAIL — `writing.ejs` still has the old hardcoded two-message markup and no provider selector.

- [ ] **Step 3: Rewrite the chat panel markup in `writing.ejs`**

Find:

```ejs
<div class="chat-panel" id="chat-panel">
    <div class="chat-header">
        <h3>Chat</h3>
        <button class="toggle-chat" id="toggle-chat" aria-label="Collapse chat" aria-expanded="true" title="Collapse chat">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6"/>
            </svg>
        </button>
    </div>
    <div class="chat-messages">
        <div class="message">
            <div class="message-author">You</div>
            <div class="message-content">I'm working on the <%= file.path %> file. Can you help me improve the introduction?</div>
            <div class="message-time">Just now</div>
        </div>
        <div class="message agent-message">
            <div class="message-author">Agent</div>
            <div class="message-content">Sure! I can help you rewrite that introduction to be more engaging. What specific aspects would you like to improve?</div>
            <div class="message-time">Just now</div>
        </div>
    </div>
    <div class="chat-input">
        <input type="text" placeholder="Ask about this file..." id="chat-input">
        <button class="btn btn-primary" id="send-chat-btn" aria-label="Send message" title="Send">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 2L11 13"/>
                <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
        </button>
    </div>
</div>
```

Replace with:

```ejs
<div class="chat-panel" id="chat-panel">
    <div class="chat-header">
        <h3>Chat</h3>
        <% if (activeProviders.length > 0) { %>
            <select id="chat-provider-select" aria-label="Choose provider">
                <% activeProviders.forEach(function(provider) { %>
                    <option value="<%= provider.id %>"><%= provider.label %></option>
                <% }); %>
            </select>
        <% } %>
        <button class="toggle-chat" id="toggle-chat" aria-label="Collapse chat" aria-expanded="true" title="Collapse chat">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M9 6l6 6-6 6"/>
            </svg>
        </button>
    </div>
    <div class="chat-messages"></div>
    <div class="chat-input">
        <input type="text" placeholder="<% if (activeProviders.length > 0) { %>Ask about this file...<% } else { %>Activate a provider in Settings to chat<% } %>" id="chat-input" <% if (activeProviders.length === 0) { %>disabled<% } %>>
        <button class="btn btn-primary" id="send-chat-btn" aria-label="Send message" title="Send" <% if (activeProviders.length === 0) { %>disabled<% } %>>
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M22 2L11 13"/>
                <path d="M22 2l-7 20-4-9-9-4 20-7z"/>
            </svg>
        </button>
    </div>
</div>
```

- [ ] **Step 4: Run the view tests and verify they pass**

Run: `node --test src/views/views.test.js`
Expected: PASS (all tests, 2 new ones included)

- [ ] **Step 5: Replace the chat functionality in `main.js`**

Find this whole block (from the comment through its closing brace):

```js
    // Chat functionality with Enter key support
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const chatMessages = document.querySelector('.chat-messages');
    
    if (chatInput && sendChatBtn && chatMessages) {
        function sendMessage() {
            const message = chatInput.value.trim();
            if (message) {
                addMessage('You', message, true);
                chatInput.value = '';
                
                // Simulate agent response after a short delay
                setTimeout(() => {
                    addMessage('Agent', 'I\'ve received your message. How can I help you with this file?', false);
                }, 1000);
            }
        }
        
        // Send on button click
        sendChatBtn.addEventListener('click', sendMessage);
        
        // Send on Enter key press (with Ctrl modifier for clarity)
        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault(); // Prevent default form submission
                sendMessage();
            }
        });
        
        function addMessage(author, content, isUser) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${isUser ? '' : 'agent-message'}`;

            const now = new Date();
            const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const authorDiv = document.createElement('div');
            authorDiv.className = 'message-author';
            authorDiv.textContent = author;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = content;

            const timeDiv = document.createElement('div');
            timeDiv.className = 'message-time';
            timeDiv.textContent = timeString;

            messageDiv.appendChild(authorDiv);
            messageDiv.appendChild(contentDiv);
            messageDiv.appendChild(timeDiv);

            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    }
```

Replace with:

```js
    // Chat functionality: real streaming completions, per-file history
    const chatInput = document.getElementById('chat-input');
    const sendChatBtn = document.getElementById('send-chat-btn');
    const chatMessages = document.querySelector('.chat-messages');
    const chatProviderSelect = document.getElementById('chat-provider-select');
    const editorForChat = document.getElementById('markdown-editor');

    if (chatInput && sendChatBtn && chatMessages && editorForChat) {
        const fileId = editorForChat.dataset.fileId;

        function formatTime(isoString) {
            const date = isoString ? new Date(isoString) : new Date();
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }

        function addMessage(author, content, className, timeString) {
            const messageDiv = document.createElement('div');
            messageDiv.className = `message ${className || ''}`;

            const authorDiv = document.createElement('div');
            authorDiv.className = 'message-author';
            authorDiv.textContent = author;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.textContent = content;

            const timeDiv = document.createElement('div');
            timeDiv.className = 'message-time';
            timeDiv.textContent = timeString || formatTime();

            messageDiv.appendChild(authorDiv);
            messageDiv.appendChild(contentDiv);
            messageDiv.appendChild(timeDiv);

            chatMessages.appendChild(messageDiv);
            chatMessages.scrollTop = chatMessages.scrollHeight;
            return contentDiv;
        }

        function loadHistory() {
            fetch(`/api/chat/${fileId}/messages`)
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (!data.success) return;
                    data.messages.forEach(function(message) {
                        if (message.role === 'user') {
                            addMessage('You', message.content, '', formatTime(message.createdAt));
                        } else if (message.role === 'assistant') {
                            addMessage(message.providerLabel || 'Agent', message.content, 'agent-message', formatTime(message.createdAt));
                        } else {
                            addMessage('Error', message.content, 'error-message', formatTime(message.createdAt));
                        }
                    });
                });
        }

        function sendMessage() {
            const message = chatInput.value.trim();
            if (!message || !chatProviderSelect) return;

            addMessage('You', message, '');
            chatInput.value = '';
            chatInput.disabled = true;
            sendChatBtn.disabled = true;

            const providerId = chatProviderSelect.value;
            const providerLabel = chatProviderSelect.options[chatProviderSelect.selectedIndex].textContent;
            let replyContentEl = null;

            fetch(`/api/chat/${fileId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ providerId, message })
            })
            .then(function(response) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                function readChunk() {
                    return reader.read().then(function(result) {
                        if (result.done) return;
                        buffer += decoder.decode(result.value, { stream: true });
                        const events = buffer.split('\n\n');
                        buffer = events.pop();
                        events.forEach(function(eventText) {
                            if (!eventText.startsWith('data: ')) return;
                            const payload = JSON.parse(eventText.slice(6));
                            if (payload.type === 'delta') {
                                if (!replyContentEl) {
                                    replyContentEl = addMessage(providerLabel, '', 'agent-message');
                                }
                                replyContentEl.textContent += payload.text;
                                chatMessages.scrollTop = chatMessages.scrollHeight;
                            } else if (payload.type === 'error') {
                                addMessage('Error', payload.message, 'error-message');
                            }
                        });
                        return readChunk();
                    });
                }

                return readChunk();
            })
            .catch(function() {
                addMessage('Error', 'Could not reach the server — check your connection and try again.', 'error-message');
            })
            .then(function() {
                chatInput.disabled = false;
                sendChatBtn.disabled = false;
                chatInput.focus();
            });
        }

        sendChatBtn.addEventListener('click', sendMessage);

        chatInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendMessage();
            }
        });

        loadHistory();
    }
```

Note for whoever implements this: `editorForChat` is a fresh `getElementById('markdown-editor')` lookup local to this block, not a reuse of the `editorTextarea` binding declared earlier in the file for cursor-line tracking — reusing that binding here would hit a temporal-dead-zone `ReferenceError`, since this chat block executes earlier in the file than that declaration.

- [ ] **Step 6: Add error-message and select styling in `style.css`**

Find:

```css
.message-time {
  font-size: 10px;
  color: var(--ink);
  opacity: 0.5;
}
```

Replace with:

```css
.message-time {
  font-size: 10px;
  color: var(--ink);
  opacity: 0.5;
}

.message.error-message .message-content {
  font-weight: bold;
}

#chat-provider-select {
  background: none;
  border: none;
  font-family: inherit;
  font-size: 11px;
  color: var(--ink);
  margin-right: 0.5rem;
}

#chat-input:disabled {
  opacity: 0.5;
}
```

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 8: Manual verification**

This task's client-side streaming logic has no automated coverage (matching the established no-frontend-test-runner precedent used for cursor-line tracking and avatar resolution). Verify by hand:

```bash
node src/scripts/seed.js
PORT=3099 node src/server.js &
sleep 1
```

Open `http://localhost:3099/settings` in a browser, sign in, add a real AI provider with a real API key and a real `baseUrl`/model (or a locally-running OpenAI-compatible endpoint), and mark it active in workspace. Then open a file's writing view and confirm:
- The chat provider selector shows the active provider(s).
- Typing a message and pressing Enter (or clicking send) shows your message immediately, then streams the model's reply token-by-token into a new bubble.
- Reloading the page shows the full prior conversation, loaded from persisted history.
- Deactivating all providers in Settings, then reloading the writing view, disables the chat input with the "Activate a provider in Settings to chat" placeholder.
- Setting an invalid API key on the active provider and sending a message produces a visibly distinct (bold) error message in the chat, and reloading shows that error persisted in history too.

```bash
kill %1
```

- [ ] **Step 9: Commit**

```bash
git add src/views/writing.ejs src/views/views.test.js src/public/js/main.js src/public/css/style.css
git commit -m "feat: replace mock chat with real streaming completions and persisted history"
```
