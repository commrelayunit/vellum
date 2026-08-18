# AI Provider Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings page where the operator can store credentials for one or more AI backends (agents, cloud subscriptions, self-hosted models — all treated identically as OpenAI-compatible endpoints), encrypted at rest, ready for a future piece of work to wire the chat panel to actually call them.

**Architecture:** A new `ai_providers` SQLite table holds provider records (label, base URL, encrypted API key, optional default model, optional avatar URL). A small AES-256-GCM encryption module keyed by a new `ENCRYPTION_KEY` env var protects the API keys; the repository layer never returns a decrypted key to a caller, only a masked last-4 display value. A settings page (server-rendered EJS, reachable from the existing ⋮ menu) lists providers and supports add/edit/delete through the same authenticated-route + vanilla-fetch pattern already used by the projects/writing views.

**Tech Stack:** Node's built-in `crypto` module (AES-256-GCM) — no new dependency. Everything else reuses the existing stack: Express, EJS, better-sqlite3, `node:test`.

**Spec:** `docs/superpowers/specs/2026-08-18-ai-provider-settings-design.md`

## Global Constraints

- Node.js >= 20 LTS only (matches the rest of the app).
- SQLite only, via the existing `src/db/connection.js`/`schema.js` pattern.
- No new frontend framework or build step. Keep server-rendered EJS + vanilla `src/public/js/main.js`.
- No new runtime dependency for encryption — use Node's built-in `crypto` module.
- Provider settings are instance-wide, not per-account (Vellum has no user-accounts system — see spec's "Scope note").
- API keys are never returned to the browser in plaintext after creation — only a masked last-4 value (see spec's "Key display" section).
- No image upload / file storage for avatars — `avatar_url` is a link to an externally-hosted image only.
- Making the chat panel actually call a configured provider is explicitly out of scope for this plan.

---

## Task 1: Encryption module

**Files:**
- Create: `src/crypto/secrets.js`
- Test: `src/crypto/secrets.test.js`

**Interfaces:**
- Produces: `createSecretsService(base64Key: string | null) => { encrypt(plaintext: string) => string, decrypt(ciphertext: string) => string }`. Both `encrypt`/`decrypt` throw a clear `Error` (message matching `/ENCRYPTION_KEY/`) if `base64Key` is missing or does not decode to exactly 32 bytes — validated once at construction, not re-checked on every call. This deviates from the spec's sketch of a bare module-level `encrypt`/`decrypt` pair in favor of a factory that takes its key explicitly, matching the codebase's existing pattern (`createConnection(dbPath)`, `createProjectsRepo(db)`, `createFilesRepo(db)`) and making it trivial to test wrong-key/missing-key behavior in isolation.

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/crypto/secrets.test.js`
Expected: FAIL — `Cannot find module './secrets'`

- [ ] **Step 3: Write the implementation**

```js
// src/crypto/secrets.js
const crypto = require('crypto');

function createSecretsService(base64Key) {
  let key = null;
  if (base64Key) {
    const decoded = Buffer.from(base64Key, 'base64');
    if (decoded.length === 32) {
      key = decoded;
    }
  }

  function requireKey() {
    if (!key) {
      throw new Error(
        'ENCRYPTION_KEY is missing or invalid. Generate one with `openssl rand -base64 32` ' +
        'and set it in your .env / systemd EnvironmentFile.'
      );
    }
    return key;
  }

  return {
    encrypt(plaintext) {
      const k = requireKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', k, iv);
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return Buffer.concat([iv, authTag, encrypted]).toString('base64');
    },
    decrypt(ciphertext) {
      const k = requireKey();
      const data = Buffer.from(ciphertext, 'base64');
      const iv = data.subarray(0, 12);
      const authTag = data.subarray(12, 28);
      const encrypted = data.subarray(28);
      const decipher = crypto.createDecipheriv('aes-256-gcm', k, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    }
  };
}

module.exports = { createSecretsService };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/crypto/secrets.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/crypto/secrets.js src/crypto/secrets.test.js
git commit -m "feat: add AES-256-GCM secrets service for provider API keys"
```

---

## Task 2: `ai_providers` schema

**Files:**
- Modify: `src/db/schema.js`
- Modify: `src/db/schema.test.js`

**Interfaces:**
- Consumes: `createConnection`, `migrate` (existing, from `src/db/connection.js`/`src/db/schema.js`).
- Produces: `migrate(db)` now also creates an `ai_providers` table (columns: `id`, `label`, `base_url`, `api_key_encrypted`, `default_model`, `avatar_url`, `created_at`, `updated_at`). Still idempotent.

- [ ] **Step 1: Write the failing test**

```js
// src/db/schema.test.js — replace the whole file
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');

test('migrate creates the projects, files, and ai_providers tables', () => {
  const db = createConnection(':memory:');
  migrate(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ['ai_providers', 'files', 'projects']);
  db.close();
});

test('migrate is idempotent', () => {
  const db = createConnection(':memory:');
  migrate(db);
  assert.doesNotThrow(() => migrate(db));
  db.close();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/db/schema.test.js`
Expected: FAIL — `assert.deepEqual` mismatch, `ai_providers` table missing from the actual list

- [ ] **Step 3: Add the table to the schema**

```js
// src/db/schema.js — replace the whole file
const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  path TEXT NOT NULL,
  title TEXT,
  mime_type TEXT NOT NULL DEFAULT 'text/markdown',
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, path)
);

CREATE TABLE IF NOT EXISTS ai_providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  default_model TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function migrate(db) {
  db.exec(SCHEMA);
}

module.exports = { migrate, SCHEMA };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/db/schema.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.js src/db/schema.test.js
git commit -m "feat: add ai_providers table to schema"
```

---

## Task 3: Providers repository

**Files:**
- Create: `src/db/providers.js`
- Test: `src/db/providers.test.js`

**Interfaces:**
- Consumes: `createConnection`, `migrate` (Task 2); `createSecretsService` (Task 1).
- Produces: `createProvidersRepo(db, secrets) => { list(), getById(id), create({label, baseUrl, apiKey, defaultModel, avatarUrl}), update(id, {label, baseUrl, apiKey, defaultModel, avatarUrl}), remove(id) }`.
  - `list()`/`getById()` return `{id, label, baseUrl, maskedKey, defaultModel, avatarUrl, createdAt, updatedAt}` — note this is a computed camelCase view-model (unlike `projects.js`/`files.js`, which return raw snake_case rows), because masking the key requires decrypting it first; doing that transformation once in the repo avoids every caller having to know about `secrets`.
  - `maskedKey` is `"•••• " + last 4 characters of the plaintext key`. The plaintext itself is never included in the returned object.
  - `create()`'s `apiKey` is required. `update()`'s `apiKey` is optional — a falsy value (`''`, `null`, `undefined`) leaves the stored encrypted key unchanged; a truthy value replaces it.
  - `remove(id)` returns `true`/`false` for whether a row was deleted (same convention as `filesRepo.updateContent`).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/db/providers.test.js`
Expected: FAIL — `Cannot find module './providers'`

- [ ] **Step 3: Write the implementation**

```js
// src/db/providers.js
function maskKey(plaintext) {
  const last4 = plaintext.slice(-4);
  return `•••• ${last4}`;
}

function toViewModel(row, secrets) {
  const plaintext = secrets.decrypt(row.api_key_encrypted);
  return {
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    maskedKey: maskKey(plaintext),
    defaultModel: row.default_model,
    avatarUrl: row.avatar_url,
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
    create({ label, baseUrl, apiKey, defaultModel, avatarUrl }) {
      const info = db
        .prepare('INSERT INTO ai_providers (label, base_url, api_key_encrypted, default_model, avatar_url) VALUES (?, ?, ?, ?, ?)')
        .run(label, baseUrl, secrets.encrypt(apiKey), defaultModel || null, avatarUrl || null);
      return this.getById(info.lastInsertRowid);
    },
    update(id, { label, baseUrl, apiKey, defaultModel, avatarUrl }) {
      if (apiKey) {
        db.prepare(
          "UPDATE ai_providers SET label = ?, base_url = ?, api_key_encrypted = ?, default_model = ?, avatar_url = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(label, baseUrl, secrets.encrypt(apiKey), defaultModel || null, avatarUrl || null, id);
      } else {
        db.prepare(
          "UPDATE ai_providers SET label = ?, base_url = ?, default_model = ?, avatar_url = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(label, baseUrl, defaultModel || null, avatarUrl || null, id);
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

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/db/providers.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/providers.js src/db/providers.test.js
git commit -m "feat: add providers repository with encrypted API keys"
```

---

## Task 4: Config, server wiring, `GET /settings` + `POST /api/providers`

**Files:**
- Modify: `src/config.js`
- Modify: `src/server.js`
- Modify: `src/server.test.js`
- Modify: `.env.example`
- Modify: `docs/DEPLOYMENT.md`

**Interfaces:**
- Consumes: `createSecretsService` (Task 1), `createProvidersRepo` (Task 3).
- Produces: `config.encryptionKey` (string or `null`); `GET /settings` (renders the provider list); `POST /api/providers` (create, 201 on success). Both routes gated by the existing `requireAuth`.

- [ ] **Step 1: Write the failing test**

Add to `src/server.test.js`. First, add this line near the top of the file, alongside the other `process.env` assignments that run before `require('./server')`:

```js
process.env.ENCRYPTION_KEY = require('crypto').randomBytes(32).toString('base64');
```

Then add these tests:

```js
test('unauthenticated GET /settings redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/settings`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
  server.close();
});

test('GET /settings renders the (empty) provider list', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/settings`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Settings/);
  server.close();
});

test('POST /api/providers creates a provider and masks the key in the response', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'OpenClaw', baseUrl: 'http://localhost:18789/v1', apiKey: 'secret-token-9999' })
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.provider.label, 'OpenClaw');
  assert.equal(data.provider.maskedKey, '•••• 9999');
  assert.equal(JSON.stringify(data).includes('secret-token-9999'), false);
  server.close();
});

test('POST /api/providers rejects a missing label, base URL, or API key', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: '', baseUrl: '', apiKey: '' })
  });
  assert.equal(res.status, 400);
  server.close();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/server.test.js`
Expected: FAIL — `/settings` and `/api/providers` don't exist yet (404s)

- [ ] **Step 3: Add `encryptionKey` to config**

In `src/config.js`, add `encryptionKey` to the object `loadConfig` returns:

```js
// src/config.js
const path = require('path');
require('dotenv').config({ quiet: true });

function loadConfig(env = process.env) {
  return {
    port: parseInt(env.PORT, 10) || 3001,
    dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'vellum.db'),
    sessionSecret: env.SESSION_SECRET || 'dev-secret-change-me',
    authPasswordHash: env.AUTH_PASSWORD_HASH || null,
    encryptionKey: env.ENCRYPTION_KEY || null
  };
}

module.exports = { loadConfig, config: loadConfig() };
```

- [ ] **Step 4: Wire the secrets service and providers repo into `server.js`**

Add these two requires near the other `require('./db/...')` lines:

```js
const { createSecretsService } = require('./crypto/secrets');
const { createProvidersRepo } = require('./db/providers');
```

Add these two lines right after `const filesRepo = createFilesRepo(db);`:

```js
const secrets = createSecretsService(config.encryptionKey);
const providersRepo = createProvidersRepo(db, secrets);
```

Add the two routes after the existing `POST /api/save-file/:fileId` handler, before the `if (process.env.NODE_ENV === 'production') {` block:

```js
app.get('/settings', requireAuth, (req, res) => {
  const providers = providersRepo.list();
  res.render('settings', { providers });
});

app.post('/api/providers', requireAuth, (req, res) => {
  const { label, baseUrl, apiKey, defaultModel, avatarUrl } = req.body;
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
    avatarUrl: typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl.trim() : null
  });
  res.status(201).json({ success: true, provider });
});
```

Add a third warning inside the existing `if (process.env.NODE_ENV === 'production') { ... }` block, alongside the `AUTH_PASSWORD_HASH`/`SESSION_SECRET` warnings already there:

```js
  if (!config.encryptionKey) {
    console.warn(
      'WARNING: ENCRYPTION_KEY is not set. Saving an AI provider will fail. ' +
      'Generate one with `openssl rand -base64 32` and set ENCRYPTION_KEY in your .env / ' +
      'systemd EnvironmentFile.'
    );
  }
```

Note: `settings.ejs` (the view `GET /settings` renders) doesn't exist yet — it's created in Task 6. `GET /settings`'s test will fail until then; that's expected and covered by Task 6's own test, not this task's. For this task, temporarily verify with a minimal placeholder view so Task 4's own tests pass in isolation:

```bash
mkdir -p src/views
cat > src/views/settings.ejs << 'EOF'
<%- include('partials/header', { title: 'Settings', page: 'settings' }) %>
<div class="projects-page"><h2>Settings</h2></div>
<%- include('partials/footer') %>
EOF
```

(Task 6 replaces this placeholder with the real view — this file is intentionally minimal here, just enough to prove the route wiring works end to end.)

- [ ] **Step 5: Run the test and verify it passes**

Run: `node --test src/server.test.js`
Expected: PASS (all tests, 4 new ones included)

- [ ] **Step 6: Document `ENCRYPTION_KEY`**

Add to `.env.example`, after the existing `AUTH_PASSWORD_HASH=` line:

```
ENCRYPTION_KEY=
```

Add to `docs/DEPLOYMENT.md`'s "## 6. Configure" section — in the env-file block, add a fourth line after `AUTH_PASSWORD_HASH=...`:

```
ENCRYPTION_KEY=<paste output of: openssl rand -base64 32>
```

In the same section, find this paragraph and its code block:

Generate the two secrets from inside `/opt/vellum` (as the `vellum` user, so file ownership stays correct):

```bash
su - vellum -s /bin/bash -c "cd /opt/vellum && openssl rand -hex 32"
su - vellum -s /bin/bash -c "cd /opt/vellum && node src/scripts/hash-password.js 'your chosen password'"
```

Replace it with:

Generate the three secrets from inside `/opt/vellum` (as the `vellum` user, so file ownership stays correct):

```bash
su - vellum -s /bin/bash -c "cd /opt/vellum && openssl rand -hex 32"
su - vellum -s /bin/bash -c "cd /opt/vellum && node src/scripts/hash-password.js 'your chosen password'"
su - vellum -s /bin/bash -c "cd /opt/vellum && openssl rand -base64 32"
```

- [ ] **Step 7: Commit**

```bash
git add src/config.js src/server.js src/server.test.js src/views/settings.ejs .env.example docs/DEPLOYMENT.md
git commit -m "feat: wire GET /settings and POST /api/providers to the database"
```

---

## Task 5: `POST /api/providers/:id` and `POST /api/providers/:id/delete`

**Files:**
- Modify: `src/server.js`
- Modify: `src/server.test.js`

**Interfaces:**
- Consumes: `providersRepo.update`/`providersRepo.remove` (Task 3).
- Produces: `POST /api/providers/:id` (update, 200 on success, 404 if the id doesn't exist); `POST /api/providers/:id/delete` (delete, 200 on success, 404 if the id doesn't exist). Both gated by `requireAuth`.

- [ ] **Step 1: Write the failing test**

Add to `src/server.test.js`:

```js
test('POST /api/providers/:id updates label/baseUrl without touching the key when apiKey is blank', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createRes = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'z.ai', baseUrl: 'https://api.z.ai/v1', apiKey: 'key-1111' })
  });
  const { provider } = await createRes.json();

  const updateRes = await fetch(`${base}/api/providers/${provider.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'z.ai renamed', baseUrl: 'https://api.z.ai/v1', apiKey: '' })
  });
  assert.equal(updateRes.status, 200);
  const data = await updateRes.json();
  assert.equal(data.success, true);
  assert.equal(data.provider.label, 'z.ai renamed');
  assert.equal(data.provider.maskedKey, '•••• 1111');
  server.close();
});

test('POST /api/providers/:id 404s for an unknown id', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/providers/999999`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'x', baseUrl: 'http://x', apiKey: '' })
  });
  assert.equal(res.status, 404);
  server.close();
});

test('POST /api/providers/:id/delete removes the provider', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const createRes = await fetch(`${base}/api/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ label: 'temp', baseUrl: 'http://temp', apiKey: 'key-temp' })
  });
  const { provider } = await createRes.json();

  const deleteRes = await fetch(`${base}/api/providers/${provider.id}/delete`, {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  assert.equal(deleteRes.status, 200);
  const data = await deleteRes.json();
  assert.equal(data.success, true);

  const listRes = await fetch(`${base}/settings`, { headers: { Cookie: cookie } });
  const listBody = await listRes.text();
  assert.doesNotMatch(listBody, /temp/);
  server.close();
});

test('POST /api/providers/:id/delete 404s for an unknown id', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const cookie = await login(base);
  const res = await fetch(`${base}/api/providers/999999/delete`, {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  assert.equal(res.status, 404);
  server.close();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/server.test.js`
Expected: FAIL — `/api/providers/:id` and `/api/providers/:id/delete` don't exist yet (404s on the update test's non-404-expecting assertions, or wrong status codes)

- [ ] **Step 3: Add the routes**

Add after the `POST /api/providers` handler added in Task 4:

```js
app.post('/api/providers/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { label, baseUrl, apiKey, defaultModel, avatarUrl } = req.body;
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
    avatarUrl: typeof avatarUrl === 'string' && avatarUrl.trim() ? avatarUrl.trim() : null
  });
  res.json({ success: true, provider });
});

app.post('/api/providers/:id/delete', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const removed = providersRepo.remove(id);
  if (removed) {
    res.json({ success: true });
  } else {
    res.status(404).json({ success: false, message: 'Provider not found' });
  }
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/server.test.js`
Expected: PASS (all tests, 4 new ones included)

- [ ] **Step 5: Commit**

```bash
git add src/server.js src/server.test.js
git commit -m "feat: wire provider update and delete routes"
```

---

## Task 6: Settings page shell, styling, and navigation

**Files:**
- Modify: `src/views/settings.ejs` (replaces Task 4's placeholder)
- Modify: `src/views/views.test.js`
- Modify: `src/views/partials/header.ejs`
- Modify: `src/public/css/style.css`
- Modify: `src/public/js/main.js`

**Interfaces:**
- Consumes: the provider view-model shape from Task 3/4 — `{id, label, baseUrl, maskedKey, defaultModel, avatarUrl}` per provider, passed to the view as `providers: [...]`.
- Produces: no new interfaces — this task is the server-rendered page shell (list markup, styling, nav entry). The add/edit/delete buttons are present but not yet wired to any JS — that's Task 7.

- [ ] **Step 1: Write the failing test**

Add to `src/views/views.test.js`:

```js
test('settings.ejs renders a provider card with masked key and no plaintext', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'settings.ejs'), {
    providers: [
      {
        id: 1,
        label: 'OpenClaw – home',
        baseUrl: 'http://localhost:18789/v1',
        maskedKey: '•••• 9999',
        defaultModel: 'claude-sonnet-4-5',
        avatarUrl: null
      }
    ]
  });
  assert.match(html, /OpenClaw – home/);
  assert.match(html, /•••• 9999/);
  assert.doesNotMatch(html, /block\(/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/views/views.test.js`
Expected: FAIL — Task 4's placeholder `settings.ejs` doesn't render provider cards, so the label/masked-key assertions don't match

- [ ] **Step 3: Write the real `settings.ejs`**

Replace the placeholder content from Task 4 entirely:

```ejs
<%- include('partials/header', { title: 'Settings', page: 'settings' }) %>

<div class="projects-page">
    <div class="page-header">
        <h2>Settings</h2>
        <button class="btn btn-primary" id="new-provider-btn" aria-label="Add provider" title="Add provider">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 5v14"/>
                <path d="M5 12h14"/>
            </svg>
        </button>
    </div>

    <div class="projects-list" id="providers-list">
        <% providers.forEach(provider => { %>
            <div class="provider-card" data-provider-id="<%= provider.id %>" data-label="<%= provider.label %>" data-base-url="<%= provider.baseUrl %>" data-default-model="<%= provider.defaultModel || '' %>" data-avatar-url="<%= provider.avatarUrl || '' %>">
                <div class="provider-avatar" data-avatar-target data-label="<%= provider.label %>" <% if (provider.avatarUrl) { %>data-avatar-url="<%= provider.avatarUrl %>"<% } %>></div>
                <div class="project-info">
                    <h3><%= provider.label %></h3>
                    <p class="project-meta"><%= provider.baseUrl %></p>
                    <p class="project-meta"><%= provider.maskedKey %><% if (provider.defaultModel) { %> &middot; <%= provider.defaultModel %><% } %></p>
                </div>
                <div class="provider-actions">
                    <button class="btn provider-edit-btn" aria-label="Edit <%= provider.label %>" title="Edit">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M12 20h9"/>
                            <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
                        </svg>
                    </button>
                    <button class="btn provider-delete-btn" aria-label="Delete <%= provider.label %>" title="Delete">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M3 6h18"/>
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        </svg>
                    </button>
                </div>
            </div>
        <% }); %>
    </div>
</div>

<%- include('partials/footer') %>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/views/views.test.js`
Expected: PASS (all tests, 1 new one included)

- [ ] **Step 5: Add the "Settings" menu item**

In `src/views/partials/header.ejs`, add a third item to `.menu-dropdown`, after the existing "Back to projects" item:

```html
                        <a href="/settings" class="menu-item" data-menu-action="settings" role="menuitem">
                            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <circle cx="12" cy="12" r="3"/>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                            </svg>
                            <span>Settings</span>
                        </a>
```

- [ ] **Step 6: Hide the "Settings" item when already on the settings page**

In `src/public/js/main.js`, immediately after the existing block that hides the "overview" item:

```js
        const overviewItem = menuDropdown.querySelector('[data-menu-action="overview"]');
        if (overviewItem && document.body.dataset.page === 'projects') {
            // Already on the overview - no point linking back to it
            overviewItem.style.display = 'none';
        }

        const settingsItem = menuDropdown.querySelector('[data-menu-action="settings"]');
        if (settingsItem && document.body.dataset.page === 'settings') {
            // Already on settings - no point linking back to it
            settingsItem.style.display = 'none';
        }
```

- [ ] **Step 7: Add provider-specific CSS**

Append to `src/public/css/style.css`:

```css
/* Settings page: provider cards */
.provider-card {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 0;
}

.provider-card + .provider-card {
  margin-top: 0.5rem;
}

.provider-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: bold;
  color: #fff;
  flex-shrink: 0;
  overflow: hidden;
}

.provider-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.provider-actions {
  display: flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

/* Inline add/edit provider form: a stacked field list, since a provider
   needs more fields than fit comfortably in a single row like
   .new-project-form does. Used both for the "+ Add provider" flow (as a
   new card prepended to the list) and for in-place editing (replacing an
   existing card's .project-info). */
.provider-form {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  flex: 1;
}

.provider-form input {
  background: none;
  border: none;
  font-family: inherit;
  font-size: 12px;
  color: var(--ink);
  padding: 0.25rem;
}

.provider-form-actions {
  display: flex;
  gap: 0.25rem;
  margin-top: 0.25rem;
}
```

- [ ] **Step 8: Commit**

```bash
git add src/views/settings.ejs src/views/views.test.js src/views/partials/header.ejs src/public/css/style.css src/public/js/main.js
git commit -m "feat: add settings page shell, styling, and navigation entry"
```

---

## Task 7: Settings page interactivity (avatars + add/edit/delete)

**Files:**
- Modify: `src/public/js/main.js`

**Interfaces:**
- Consumes: the DOM structure from Task 6 (`#providers-list`, `#new-provider-btn`, `.provider-card[data-provider-id][data-label][data-base-url][data-default-model][data-avatar-url]`, `[data-avatar-target][data-label][data-avatar-url]`, `.provider-edit-btn`, `.provider-delete-btn`); the routes from Tasks 4/5 (`POST /api/providers`, `POST /api/providers/:id`, `POST /api/providers/:id/delete`).
- Produces: no new server-facing interface — this is client-only behavior. No automated test (this codebase has no frontend test runner; every other piece of `main.js` interactivity — chat panel, new-project flow, presence avatars — was verified the same way: manually, via a running server). This task's "test cycle" is the manual verification in Step 3.

- [ ] **Step 1: Add avatar resolution logic**

Append to `src/public/js/main.js`, inside the existing `document.addEventListener('DOMContentLoaded', function() { ... })` block (add it near the end, after the existing presence-avatar code):

```js
    // Settings page: resolve each provider's avatar (custom URL > known-brand
    // icon via Simple Icons > initials+color fallback, same visual pattern as
    // the collaborator presence avatars).
    const KNOWN_PROVIDER_ICONS = [
        { pattern: /openai|gpt/i, slug: 'openai' },
        { pattern: /anthropic|claude/i, slug: 'anthropic' },
        { pattern: /google|gemini/i, slug: 'googlegemini' },
        { pattern: /mistral/i, slug: 'mistralai' },
        { pattern: /meta|llama/i, slug: 'meta' },
        { pattern: /ollama/i, slug: 'ollama' }
    ];

    const AVATAR_COLORS = ['var(--presence-you)', 'var(--presence-2)', 'var(--presence-3)'];

    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = (hash * 31 + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash);
    }

    function initialsFor(label) {
        const words = label.trim().split(/\s+/).filter(Boolean);
        if (words.length === 0) return '?';
        if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
        return (words[0][0] + words[1][0]).toUpperCase();
    }

    function resolveProviderAvatar(target) {
        const customUrl = target.dataset.avatarUrl;
        const label = target.dataset.label || '';

        if (customUrl) {
            const img = document.createElement('img');
            img.src = customUrl;
            img.alt = label;
            target.appendChild(img);
            return;
        }

        const known = KNOWN_PROVIDER_ICONS.find(function(entry) { return entry.pattern.test(label); });
        if (known) {
            const img = document.createElement('img');
            img.src = `https://cdn.simpleicons.org/${known.slug}`;
            img.alt = label;
            target.appendChild(img);
            return;
        }

        const color = AVATAR_COLORS[hashString(label) % AVATAR_COLORS.length];
        target.style.backgroundColor = color;
        target.textContent = initialsFor(label);
    }

    document.querySelectorAll('[data-avatar-target]').forEach(resolveProviderAvatar);
```

- [ ] **Step 2: Add the add/edit/delete form handlers**

Append immediately after the avatar resolution code from Step 1, still inside the same `DOMContentLoaded` handler:

```js
    // Settings page: add/edit/delete provider forms
    const providersList = document.getElementById('providers-list');
    const newProviderBtn = document.getElementById('new-provider-btn');

    if (providersList && newProviderBtn) {
        function buildProviderForm(existing) {
            const form = document.createElement('form');
            form.className = 'provider-form';

            const labelInput = document.createElement('input');
            labelInput.type = 'text';
            labelInput.placeholder = 'Label (e.g. "Claude direct")';
            labelInput.required = true;
            labelInput.value = existing ? existing.label : '';

            const baseUrlInput = document.createElement('input');
            baseUrlInput.type = 'text';
            baseUrlInput.placeholder = 'Base URL (e.g. https://api.anthropic.com/v1)';
            baseUrlInput.required = true;
            baseUrlInput.value = existing ? existing.baseUrl : '';

            const apiKeyInput = document.createElement('input');
            apiKeyInput.type = 'password';
            apiKeyInput.placeholder = existing ? 'New API key (leave blank to keep current)' : 'API key';
            apiKeyInput.required = !existing;

            const defaultModelInput = document.createElement('input');
            defaultModelInput.type = 'text';
            defaultModelInput.placeholder = 'Default model (optional)';
            defaultModelInput.value = existing ? existing.defaultModel : '';

            const avatarUrlInput = document.createElement('input');
            avatarUrlInput.type = 'text';
            avatarUrlInput.placeholder = 'Avatar image URL (optional)';
            avatarUrlInput.value = existing ? existing.avatarUrl : '';

            const confirmBtn = document.createElement('button');
            confirmBtn.type = 'submit';
            confirmBtn.className = 'btn';
            confirmBtn.setAttribute('aria-label', existing ? 'Save provider' : 'Create provider');
            confirmBtn.title = existing ? 'Save' : 'Create';
            confirmBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.className = 'btn';
            cancelBtn.setAttribute('aria-label', 'Cancel');
            cancelBtn.title = 'Cancel';
            cancelBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>';

            const actions = document.createElement('div');
            actions.className = 'provider-form-actions';
            actions.appendChild(confirmBtn);
            actions.appendChild(cancelBtn);

            form.appendChild(labelInput);
            form.appendChild(baseUrlInput);
            form.appendChild(apiKeyInput);
            form.appendChild(defaultModelInput);
            form.appendChild(avatarUrlInput);
            form.appendChild(actions);

            form.addEventListener('submit', function(e) {
                e.preventDefault();
                confirmBtn.disabled = true;
                const payload = {
                    label: labelInput.value.trim(),
                    baseUrl: baseUrlInput.value.trim(),
                    apiKey: apiKeyInput.value.trim(),
                    defaultModel: defaultModelInput.value.trim(),
                    avatarUrl: avatarUrlInput.value.trim()
                };
                const url = existing ? `/api/providers/${existing.id}` : '/api/providers';
                fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                })
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (data.success) {
                        window.location.reload();
                    } else {
                        confirmBtn.disabled = false;
                    }
                })
                .catch(function() {
                    confirmBtn.disabled = false;
                });
            });

            return { form, cancelBtn };
        }

        newProviderBtn.addEventListener('click', function() {
            if (document.querySelector('.provider-form')) return;
            newProviderBtn.disabled = true;
            const { form, cancelBtn } = buildProviderForm(null);
            const wrapper = document.createElement('div');
            wrapper.className = 'provider-card';
            wrapper.appendChild(form);
            providersList.insertBefore(wrapper, providersList.firstChild);
            cancelBtn.addEventListener('click', function() {
                wrapper.remove();
                newProviderBtn.disabled = false;
            });
            form.querySelector('input').focus();
        });

        providersList.addEventListener('click', function(e) {
            const editBtn = e.target.closest('.provider-edit-btn');
            const deleteBtn = e.target.closest('.provider-delete-btn');

            if (editBtn) {
                const card = editBtn.closest('.provider-card');
                if (card.querySelector('.provider-form')) return;
                const existing = {
                    id: card.dataset.providerId,
                    label: card.dataset.label,
                    baseUrl: card.dataset.baseUrl,
                    defaultModel: card.dataset.defaultModel,
                    avatarUrl: card.dataset.avatarUrl
                };
                const info = card.querySelector('.project-info');
                const { form, cancelBtn } = buildProviderForm(existing);
                info.replaceWith(form);
                cancelBtn.addEventListener('click', function() {
                    form.replaceWith(info);
                });
            }

            if (deleteBtn) {
                const card = deleteBtn.closest('.provider-card');
                deleteBtn.disabled = true;
                fetch(`/api/providers/${card.dataset.providerId}/delete`, { method: 'POST' })
                    .then(function(response) { return response.json(); })
                    .then(function(data) {
                        if (data.success) {
                            card.remove();
                        } else {
                            deleteBtn.disabled = false;
                        }
                    })
                    .catch(function() {
                        deleteBtn.disabled = false;
                    });
            }
        });
    }
```

- [ ] **Step 3: Manual verification**

```bash
export DB_PATH=/tmp/vellum-settings-smoke.db
export SESSION_SECRET=smoke-test-secret
export ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
export AUTH_PASSWORD_HASH=$(node src/scripts/hash-password.js smoketest)
export PORT=3098

node src/server.js &
sleep 1

# Log in and keep the session cookie
curl -s -c /tmp/vellum-settings-cookies.txt -X POST http://localhost:3098/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'password=smoketest' -o /dev/null -w "%{http_code}\n"
# Expected: 302

# Settings page loads
curl -s -b /tmp/vellum-settings-cookies.txt http://localhost:3098/settings | grep -o "Settings"
# Expected: Settings

# Create a provider via the real API
curl -s -b /tmp/vellum-settings-cookies.txt -X POST http://localhost:3098/api/providers \
  -H 'Content-Type: application/json' \
  -d '{"label":"OpenClaw – home","baseUrl":"http://localhost:18789/v1","apiKey":"secret-token-abcd","defaultModel":"claude-sonnet-4-5"}'
# Expected: {"success":true,"provider":{...,"maskedKey":"•••• abcd",...}}

# Settings page now shows the masked key, never the plaintext
curl -s -b /tmp/vellum-settings-cookies.txt http://localhost:3098/settings > /tmp/vellum-settings-page.html
grep -o "OpenClaw" /tmp/vellum-settings-page.html
# Expected: OpenClaw
grep -o "abcd" /tmp/vellum-settings-page.html
# Expected: abcd (only as the masked last-4 fragment, inside "•••• abcd")
grep -c "secret-token-abcd" /tmp/vellum-settings-page.html
# Expected: 0

kill %1
rm -f /tmp/vellum-settings-smoke.db /tmp/vellum-settings-cookies.txt /tmp/vellum-settings-page.html
```

Expected: every check above matches. This confirms the route wiring, masking, and page rendering all work end to end with a real server and a real (temporary) database. Avatar rendering (the known-brand lookup and initials+color fallback) and the interactive add/edit/delete form flows are pure client-side JS with no server round-trip to script here — these should be spot-checked in a browser (open `http://localhost:3098/settings`, click "+ Add provider", fill the form, confirm it appears with an initials+color avatar since "OpenClaw" isn't in the known-brand list; try editing and deleting it).

- [ ] **Step 4: Commit**

```bash
git add src/public/js/main.js
git commit -m "feat: wire settings page avatar resolution and add/edit/delete forms"
```
