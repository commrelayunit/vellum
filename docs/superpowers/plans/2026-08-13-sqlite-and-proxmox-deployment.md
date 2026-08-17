# Vellum SQLite Persistence & Proxmox LXC Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Vellum's static-HTML/in-memory mock with real SQLite-backed persistence behind a minimal private-login gate, and package it to run as a systemd-managed service inside a self-hosted, unprivileged Proxmox LXC container.

**Architecture:** Express renders EJS views (via two plain partials, replacing the current broken `layout.ejs`/`block()` pattern) backed by a `better-sqlite3` database module (`src/db/`) that replaces `src/models/memory-db.js` and the unused `src/models/database.js`. A single-shared-password, session-cookie auth layer gates every app route. In production the Node process runs under systemd inside a Debian 12 unprivileged LXC, with the SQLite file stored outside the app directory so code upgrades never touch data, and nightly `sqlite3 .backup` dumps plus Proxmox-level `vzdump` snapshots as the safety net.

**Tech Stack:**
- `better-sqlite3` — synchronous SQLite driver, replaces the `sqlite3` dependency that was never actually wired up
- `express-session` + `bcryptjs` — single-password session auth (pure-JS bcrypt, no extra native build dependency)
- `dotenv` — local-dev `.env` loading (production uses systemd `EnvironmentFile=` instead)
- `ejs` (already a dependency) — server-rendered views via plain `<%- include() %>` partials
- Node's built-in `node:test` + `node:assert/strict` — zero-dependency test runner (`node --test`)
- systemd — process supervision inside the LXC
- Debian 12 (bookworm) unprivileged LXC + Node.js 20 LTS (NodeSource)

## Global Constraints

- Node.js >= 20 LTS only (matches Debian 12's NodeSource package; don't rely on syntax newer than Node 20 supports).
- SQLite only — no Postgres/MySQL driver additions. This matches the "Personal mode" self-host target in `docs/SPEC.md` (single user / small trusted pair).
- No new frontend framework or build step. Keep server-rendered EJS + the existing vanilla `src/public/js/main.js`.
- Single shared-password auth only in this plan — no multi-user account system (`docs/SPEC.md`'s "Personal mode").
- Keep the existing query-param routing convention (`/writing?project=<id>`), not the path-param routes sketched in `docs/SPEC.md`.
- Out of scope for this plan: chat message persistence, snapshots/named versions, git materialization, live collaboration, agent integration. Those remain milestones M2–M7 in `docs/IMPLEMENTATION_PLAN.md` and are not touched here.
- Every new dependency must be pure-JS or ship prebuilt binaries, to keep LXC provisioning simple.

---

## Phase 1: Database Layer

### Task 1: Database connection module

**Files:**
- Create: `src/db/connection.js`
- Test: `src/db/connection.test.js`
- Modify: `package.json` (remove `sqlite3`, add `better-sqlite3`)

**Interfaces:**
- Produces: `createConnection(dbPath?: string) => Database` — `dbPath` defaults to `process.env.DB_PATH` or `<repo>/data/vellum.db`; passing `':memory:'` opens an in-memory database (used by every later repository test).

- [ ] **Step 1: Write the failing test**

```js
// src/db/connection.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createConnection } = require('./connection');

test('createConnection opens a file db and creates the parent directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vellum-test-'));
  const dbPath = path.join(tmpDir, 'nested', 'vellum.db');
  const db = createConnection(dbPath);
  assert.equal(fs.existsSync(dbPath), true);
  db.close();
});

test('createConnection(":memory:") opens an in-memory db without touching disk', () => {
  const db = createConnection(':memory:');
  db.prepare('CREATE TABLE t (id INTEGER)').run();
  assert.equal(db.prepare('SELECT COUNT(*) as n FROM t').get().n, 0);
  db.close();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/db/connection.test.js`
Expected: FAIL — `Cannot find module './connection'`

- [ ] **Step 3: Swap the SQLite dependency**

```bash
npm uninstall sqlite3
npm install better-sqlite3
```

- [ ] **Step 4: Write the implementation**

```js
// src/db/connection.js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

function createConnection(dbPath) {
  const resolvedPath = dbPath || process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'vellum.db');

  if (resolvedPath !== ':memory:') {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  }

  const db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

module.exports = { createConnection };
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `node --test src/db/connection.test.js`
Expected: PASS (2 tests)

- [ ] **Step 6: Add the zero-dependency test script**

Add to `package.json` `"scripts"`:

```json
"test": "node --test src"
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/db/connection.js src/db/connection.test.js
git commit -m "feat: add better-sqlite3 connection module, drop unused sqlite3 dep"
```

---

### Task 2: Schema and migration runner

**Files:**
- Create: `src/db/schema.js`
- Test: `src/db/schema.test.js`

**Interfaces:**
- Consumes: `createConnection` from Task 1.
- Produces: `migrate(db: Database) => void` — creates `projects` and `files` tables if they don't exist. Idempotent (safe to call on every startup).

- [ ] **Step 1: Write the failing test**

```js
// src/db/schema.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');

test('migrate creates the projects and files tables', () => {
  const db = createConnection(':memory:');
  migrate(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ['files', 'projects']);
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
Expected: FAIL — `Cannot find module './schema'`

- [ ] **Step 3: Write the implementation**

```js
// src/db/schema.js
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
git commit -m "feat: add projects/files schema migration"
```

---

### Task 3: Projects repository

**Files:**
- Create: `src/db/projects.js`
- Test: `src/db/projects.test.js`

**Interfaces:**
- Consumes: `createConnection`, `migrate`.
- Produces: `createProjectsRepo(db) => { list(), getById(id), getBySlug(slug), create({name, description}) }`. `create()` auto-generates a unique slug. Also exports `slugify(name)`.

- [ ] **Step 1: Write the failing test**

```js
// src/db/projects.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');
const { createProjectsRepo } = require('./projects');

function setup() {
  const db = createConnection(':memory:');
  migrate(db);
  return createProjectsRepo(db);
}

test('create() inserts a project with a generated slug', () => {
  const projects = setup();
  const project = projects.create({ name: 'Sample Project', description: 'demo' });
  assert.equal(project.name, 'Sample Project');
  assert.equal(project.slug, 'sample-project');
  assert.equal(project.description, 'demo');
});

test('create() deduplicates slugs', () => {
  const projects = setup();
  projects.create({ name: 'Notes' });
  const second = projects.create({ name: 'Notes' });
  assert.equal(second.slug, 'notes-2');
});

test('list() returns projects ordered by id', () => {
  const projects = setup();
  projects.create({ name: 'A' });
  projects.create({ name: 'B' });
  const all = projects.list();
  assert.equal(all.length, 2);
  assert.equal(all[0].name, 'A');
});

test('getById() returns undefined for a missing project', () => {
  const projects = setup();
  assert.equal(projects.getById(999), undefined);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/db/projects.test.js`
Expected: FAIL — `Cannot find module './projects'`

- [ ] **Step 3: Write the implementation**

```js
// src/db/projects.js
function slugify(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function createProjectsRepo(db) {
  return {
    list() {
      return db.prepare('SELECT * FROM projects ORDER BY id').all();
    },
    getById(id) {
      return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    },
    getBySlug(slug) {
      return db.prepare('SELECT * FROM projects WHERE slug = ?').get(slug);
    },
    create({ name, description }) {
      const baseSlug = slugify(name);
      let slug = baseSlug;
      let n = 2;
      while (db.prepare('SELECT 1 FROM projects WHERE slug = ?').get(slug)) {
        slug = `${baseSlug}-${n}`;
        n += 1;
      }
      const info = db
        .prepare('INSERT INTO projects (name, slug, description) VALUES (?, ?, ?)')
        .run(name, slug, description || '');
      return this.getById(info.lastInsertRowid);
    }
  };
}

module.exports = { createProjectsRepo, slugify };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/db/projects.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/projects.js src/db/projects.test.js
git commit -m "feat: add projects repository"
```

---

### Task 4: Files repository

**Files:**
- Create: `src/db/files.js`
- Test: `src/db/files.test.js`

**Interfaces:**
- Consumes: `createConnection`, `migrate`, `createProjectsRepo`.
- Produces: `createFilesRepo(db) => { listByProjectId(projectId), getById(id), getFirstForProject(projectId), create({projectId, path, title, content}), updateContent(id, content) }`. `updateContent` returns `true`/`false` for whether a row was updated.

- [ ] **Step 1: Write the failing test**

```js
// src/db/files.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('./connection');
const { migrate } = require('./schema');
const { createProjectsRepo } = require('./projects');
const { createFilesRepo } = require('./files');

function setup() {
  const db = createConnection(':memory:');
  migrate(db);
  const projects = createProjectsRepo(db);
  const files = createFilesRepo(db);
  const project = projects.create({ name: 'Sample Project' });
  return { files, project };
}

test('create() and getFirstForProject() round-trip', () => {
  const { files, project } = setup();
  files.create({ projectId: project.id, path: 'README.md', content: '# hi' });
  files.create({ projectId: project.id, path: 'Draft.md', content: 'draft' });
  const first = files.getFirstForProject(project.id);
  assert.equal(first.path, 'README.md');
});

test('updateContent() persists new content and returns true', () => {
  const { files, project } = setup();
  const file = files.create({ projectId: project.id, path: 'Notes.md', content: 'old' });
  const changed = files.updateContent(file.id, 'new content');
  assert.equal(changed, true);
  assert.equal(files.getById(file.id).content, 'new content');
});

test('updateContent() returns false for a missing file', () => {
  const { files } = setup();
  assert.equal(files.updateContent(999, 'x'), false);
});

test('listByProjectId() returns files ordered by id', () => {
  const { files, project } = setup();
  files.create({ projectId: project.id, path: 'A.md' });
  files.create({ projectId: project.id, path: 'B.md' });
  const list = files.listByProjectId(project.id);
  assert.equal(list.length, 2);
  assert.equal(list[0].path, 'A.md');
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/db/files.test.js`
Expected: FAIL — `Cannot find module './files'`

- [ ] **Step 3: Write the implementation**

```js
// src/db/files.js
function createFilesRepo(db) {
  return {
    listByProjectId(projectId) {
      return db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY id').all(projectId);
    },
    getById(id) {
      return db.prepare('SELECT * FROM files WHERE id = ?').get(id);
    },
    getFirstForProject(projectId) {
      return db.prepare('SELECT * FROM files WHERE project_id = ? ORDER BY id LIMIT 1').get(projectId);
    },
    create({ projectId, path: filePath, title, content }) {
      const info = db
        .prepare('INSERT INTO files (project_id, path, title, content) VALUES (?, ?, ?, ?)')
        .run(projectId, filePath, title || filePath, content || '');
      return this.getById(info.lastInsertRowid);
    },
    updateContent(id, content) {
      const info = db
        .prepare("UPDATE files SET content = ?, updated_at = datetime('now') WHERE id = ?")
        .run(content, id);
      return info.changes > 0;
    }
  };
}

module.exports = { createFilesRepo };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/db/files.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/db/files.js src/db/files.test.js
git commit -m "feat: add files repository"
```

---

### Task 5: Rewrite the seed script against the real DB

**Files:**
- Modify: `src/scripts/seed.js` (currently targets the unused `src/models/database.js`)
- Test: `src/scripts/seed.test.js`

**Interfaces:**
- Consumes: `createConnection`, `migrate`, `createProjectsRepo`, `createFilesRepo`, `slugify`.
- Produces: `seedDatabase(db) => Project[]` — idempotent; running it twice does not duplicate projects. The CLI entry point (`node src/scripts/seed.js`) connects to the real configured DB and calls this.

- [ ] **Step 1: Write the failing test**

```js
// src/scripts/seed.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createConnection } = require('../db/connection');
const { seedDatabase } = require('./seed');

test('seedDatabase() creates the two sample projects with their files', () => {
  const db = createConnection(':memory:');
  const projects = seedDatabase(db);
  assert.equal(projects.length, 2);
  assert.equal(projects[0].name, 'Sample Project');
});

test('seedDatabase() is idempotent', () => {
  const db = createConnection(':memory:');
  seedDatabase(db);
  const second = seedDatabase(db);
  assert.equal(second.length, 2);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/scripts/seed.test.js`
Expected: FAIL — old `seed.js` doesn't export `seedDatabase` (it requires `../models/database`, a different, unrelated module)

- [ ] **Step 3: Replace the implementation**

```js
// src/scripts/seed.js
const { createConnection } = require('../db/connection');
const { migrate } = require('../db/schema');
const { createProjectsRepo, slugify } = require('../db/projects');
const { createFilesRepo } = require('../db/files');

const SEED_DATA = [
  {
    name: 'Sample Project',
    description: 'A sample project for demonstration',
    files: [
      {
        path: 'README.md',
        title: 'README',
        content:
          "# Sample Project\n\nThis is a sample project to demonstrate Vellum's capabilities.\n\n## Features\n\n- Project-based file organization\n- Markdown editing\n- File history and versioning\n- Agent-assisted writing (coming soon)"
      },
      { path: 'Draft.md', title: 'Draft', content: '# Draft Document\n\nThis is a draft document that can be edited and improved.' },
      { path: 'Notes.md', title: 'Notes', content: '# Notes\n\nImportant notes and ideas for this project.' },
      {
        path: 'Checklist.md',
        title: 'Checklist',
        content: '# Checklist\n\n- [ ] Complete initial setup\n- [ ] Create first document\n- [ ] Test editing features\n- [ ] Review history functionality'
      }
    ]
  },
  {
    name: 'Documentation',
    description: 'Project documentation and notes',
    files: [
      { path: 'README.md', title: 'README', content: '# Documentation Project\n\nThis project contains all documentation for our software.' }
    ]
  }
];

function seedDatabase(db) {
  migrate(db);
  const projects = createProjectsRepo(db);
  const files = createFilesRepo(db);

  SEED_DATA.forEach((seed) => {
    const existing = projects.getBySlug(slugify(seed.name));
    if (existing) return;

    const project = projects.create({ name: seed.name, description: seed.description });
    seed.files.forEach((f) => {
      files.create({ projectId: project.id, path: f.path, title: f.title, content: f.content });
    });
  });

  return projects.list();
}

if (require.main === module) {
  const db = createConnection();
  const seeded = seedDatabase(db);
  console.log(`Seeded ${seeded.length} project(s).`);
  db.close();
}

module.exports = { seedDatabase, SEED_DATA };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/scripts/seed.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/scripts/seed.js src/scripts/seed.test.js
git commit -m "feat: rewrite seed script against the sqlite repositories"
```

---

## Phase 2: Server-Rendered Views and Routes

### Task 6: Config module and `.env.example`

**Files:**
- Create: `src/config.js`
- Create: `.env.example`
- Test: `src/config.test.js`
- Modify: `package.json` (add `dotenv` dependency)
- Modify: `.gitignore` (ensure `.env` and `data/` are ignored — check first, they may already be covered by a blanket rule)

**Interfaces:**
- Produces: `loadConfig(env?) => { port, dbPath, sessionSecret, authPasswordHash }` (pure function, defaults `env` to `process.env`) and `config` (the module's own `loadConfig()` result, for convenience imports).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/config.test.js`
Expected: FAIL — `Cannot find module './config'`

- [ ] **Step 3: Install dotenv and write the implementation**

```bash
npm install dotenv
```

```js
// src/config.js
const path = require('path');
require('dotenv').config();

function loadConfig(env = process.env) {
  return {
    port: parseInt(env.PORT, 10) || 3001,
    dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'vellum.db'),
    sessionSecret: env.SESSION_SECRET || 'dev-secret-change-me',
    authPasswordHash: env.AUTH_PASSWORD_HASH || null
  };
}

module.exports = { loadConfig, config: loadConfig() };
```

- [ ] **Step 4: Add `.env.example`**

```
PORT=3001
DB_PATH=./data/vellum.db
SESSION_SECRET=change-me-to-a-random-string
AUTH_PASSWORD_HASH=
```

- [ ] **Step 5: Confirm `.gitignore` covers local secrets/data**

Run: `grep -E "^\.env$|^data/" .gitignore || echo "MISSING"`
If it prints `MISSING`, add these two lines to `.gitignore`:

```
.env
data/
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `node --test src/config.test.js`
Expected: PASS (2 tests)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/config.js src/config.test.js .env.example .gitignore
git commit -m "feat: add env-driven config module"
```

---

### Task 7: View partials, and rewrite `projects.ejs` / `writing.ejs`

The existing `src/views/layout.ejs` uses `include('layout', {...})` plus `block('body')`/`endblock` — a layout-helper pattern that isn't standard EJS and has no implementation anywhere in this repo (confirmed: these templates have never actually been renderable). This task replaces it with two plain partials, which is all plain `ejs` needs.

This task also fixes a real bug in the current `writing.ejs`/`writing.html`: the `<textarea>` has a newline between the opening tag and `<%= file.content %>`, and another before the closing tag. That whitespace becomes part of the textarea's initial value, and the autosave handler then persists it back — every save silently grows a stray leading/trailing newline. Fixing it here means content is byte-for-byte what's in the database.

**Files:**
- Create: `src/views/partials/header.ejs`
- Create: `src/views/partials/footer.ejs`
- Modify: `src/views/projects.ejs`
- Modify: `src/views/writing.ejs`
- Delete: `src/views/layout.ejs`
- Test: `src/views/views.test.js`

**Interfaces:**
- `partials/header` consumes locals `title` (string) and `page` (`'projects'` | `'writing'` | `'login'`).
- `projects.ejs` consumes `projects: Array<{id, name, description, fileCount, updatedAt, recentFiles: string[]}>` — this view-model shape is what Task 8's route must produce.
- `writing.ejs` consumes `project: {name}` and `file: {id, path, title, content}`.

- [ ] **Step 1: Write the failing test**

```js
// src/views/views.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const ejs = require('ejs');

test('projects.ejs renders a project card with file details', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'projects.ejs'), {
    projects: [
      {
        id: 1,
        name: 'Sample Project',
        description: 'demo',
        fileCount: 2,
        updatedAt: new Date().toISOString(),
        recentFiles: ['README.md', 'Draft.md']
      }
    ]
  });
  assert.match(html, /Sample Project/);
  assert.match(html, /README\.md/);
  assert.doesNotMatch(html, /block\(/);
});

test('writing.ejs renders file content with no stray whitespace', async () => {
  const html = await ejs.renderFile(path.join(__dirname, 'writing.ejs'), {
    project: { name: 'Sample Project' },
    file: { id: 1, path: 'README.md', title: 'README', content: '# Hello' }
  });
  assert.match(html, /<textarea[^>]*>#\sHello<\/textarea>/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/views/views.test.js`
Expected: FAIL — current `projects.ejs`/`writing.ejs` call `include('layout', ...)` and reference `block`/`endblock`, which throws `block is not defined`

- [ ] **Step 3: Create the header partial**

```ejs
<!-- src/views/partials/header.ejs -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><%= title %> - Vellum</title>
    <link rel="stylesheet" href="/css/style.css">
    <link rel="icon" href="/img/vellum-mark.svg" type="image/svg+xml">
</head>
<body data-page="<%= page %>">
    <div class="app-container">
        <header class="app-header">
            <div class="header-left">
                <div class="menu-wrap">
                    <button class="menu-button" id="menu-toggle" aria-label="Menu" aria-haspopup="true" aria-expanded="false" title="Menu">
                        <svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                            <circle cx="12" cy="5" r="1.4"/>
                            <circle cx="12" cy="12" r="1.4"/>
                            <circle cx="12" cy="19" r="1.4"/>
                        </svg>
                    </button>
                    <div class="menu-dropdown" id="menu-dropdown" role="menu">
                        <a href="/projects#new-project" class="menu-item" data-menu-action="new-project" role="menuitem">
                            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M12 5v14"/>
                                <path d="M5 12h14"/>
                            </svg>
                            <span>New project</span>
                        </a>
                        <a href="/projects" class="menu-item" data-menu-action="overview" role="menuitem">
                            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                <path d="M4 11l8-7 8 7"/>
                                <path d="M6 10v9h12v-9"/>
                            </svg>
                            <span>Back to projects</span>
                        </a>
                    </div>
                </div>
                <h1 class="app-title">Vellum</h1>
            </div>
        </header>

        <main class="app-main">
```

- [ ] **Step 4: Create the footer partial**

```ejs
<!-- src/views/partials/footer.ejs -->
        </main>
    </div>

    <script src="/js/main.js"></script>
</body>
</html>
```

- [ ] **Step 5: Rewrite `projects.ejs`**

```ejs
<%- include('partials/header', { title: 'Projects', page: 'projects' }) %>

<div class="projects-page">
    <div class="page-header">
        <h2>Projects</h2>
        <button class="btn btn-primary" id="new-project-btn" aria-label="New project" title="New project">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 5v14"/>
                <path d="M5 12h14"/>
            </svg>
        </button>
    </div>

    <div class="projects-list">
        <% projects.forEach(project => { %>
            <div class="project-card">
                <div class="project-info">
                    <h3><%= project.name %></h3>
                    <p class="project-description"><%= project.description %></p>
                    <div class="project-meta">
                        <span class="file-count"><%= project.fileCount %> file<%= project.fileCount === 1 ? '' : 's' %></span>
                        <time data-updated="<%= project.updatedAt %>">updated recently</time>
                    </div>
                    <% if (project.recentFiles.length) { %>
                        <div class="recent-files">
                            <% project.recentFiles.forEach(f => { %>
                                <span><%= f %></span>
                            <% }); %>
                        </div>
                    <% } %>
                </div>
                <div class="project-actions">
                    <a href="/writing?project=<%= project.id %>" class="btn btn-secondary" aria-label="Open <%= project.name %>" title="Open">
                        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M5 12h14"/>
                            <path d="M13 6l6 6-6 6"/>
                        </svg>
                    </a>
                </div>
            </div>
        <% }); %>
    </div>
</div>

<%- include('partials/footer') %>
```

- [ ] **Step 6: Rewrite `writing.ejs`**

```ejs
<%- include('partials/header', { title: file.title || file.path, page: 'writing' }) %>

<div class="editor-container">
    <div class="editor-header">
        <div class="file-path"><%= project.name %> / <%= file.path %></div>
        <div class="editor-header-right">
            <div class="presence-stack" id="presence-stack" aria-label="People in this file"></div>
            <div class="editor-actions">
                <button class="btn btn-secondary" id="preview-toggle" aria-label="Show preview" title="Preview">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>
                        <circle cx="12" cy="12" r="3"/>
                    </svg>
                </button>
                <button class="btn btn-primary" id="export-btn" aria-label="Export file" title="Export">
                    <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M12 3v12"/>
                        <path d="M7 10l5 5 5-5"/>
                        <path d="M5 21h14"/>
                    </svg>
                </button>
            </div>
        </div>
    </div>

    <div class="editor-content">
        <div class="cursor-line-tint" id="cursor-line-tint"></div>
        <textarea id="markdown-editor" class="editor-textarea" data-file-id="<%= file.id %>"><%= file.content %></textarea>
        <div class="cursor-flag" id="cursor-demo" aria-hidden="true"></div>
    </div>
</div>

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

<%- include('partials/footer') %>
```

- [ ] **Step 7: Delete the dead layout file**

```bash
rm src/views/layout.ejs
```

- [ ] **Step 8: Run the test and verify it passes**

Run: `node --test src/views/views.test.js`
Expected: PASS (2 tests)

- [ ] **Step 9: Commit**

```bash
git add -A src/views
git commit -m "fix: replace broken layout/block pattern with plain partials; fix textarea whitespace bug"
```

---

### Task 8: Wire `GET /projects` and `POST /api/projects` to the database

**Files:**
- Modify: `src/server.js`
- Test: `src/server.test.js` (new; this task starts the file, Task 9 and Task 12 extend it)

**Interfaces:**
- Consumes: `loadConfig`/`config` (Task 6), `createConnection`/`migrate` (Tasks 1–2), `createProjectsRepo`/`createFilesRepo` (Tasks 3–4).
- Produces: exported Express `app` (unchanged export, but `app.listen` now only runs when the file is executed directly, so tests can `require('./server')` safely and call `app.listen(0)` themselves).

- [ ] **Step 1: Write the failing test**

```js
// src/server.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';

const app = require('./server');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

test('GET /projects renders the (empty) projects list', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/projects`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Projects/);
  server.close();
});

test('POST /api/projects creates a project with a default file', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'New Idea' })
  });
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.project.name, 'New Idea');
  assert.equal(data.file.path, 'Untitled.md');
  server.close();
});

test('POST /api/projects rejects an empty name', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '  ' })
  });
  assert.equal(res.status, 400);
  server.close();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/server.test.js`
Expected: FAIL — `/projects` currently 404s or serves the old static file depending on what's left from earlier manual edits; `/api/projects` doesn't exist yet (404)

- [ ] **Step 3: Rewrite the top of `server.js`**

```js
// src/server.js
const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');

const { config } = require('./config');
const { createConnection } = require('./db/connection');
const { migrate } = require('./db/schema');
const { createProjectsRepo } = require('./db/projects');
const { createFilesRepo } = require('./db/files');

const db = createConnection(config.dbPath);
migrate(db);
const projectsRepo = createProjectsRepo(db);
const filesRepo = createFilesRepo(db);

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/projects'));

app.get('/projects', (req, res) => {
  const projects = projectsRepo.list().map((project) => {
    const files = filesRepo.listByProjectId(project.id);
    const latestUpdate = files.reduce(
      (latest, f) => (f.updated_at > latest ? f.updated_at : latest),
      project.updated_at
    );
    return {
      ...project,
      fileCount: files.length,
      updatedAt: latestUpdate,
      recentFiles: files.slice(0, 3).map((f) => f.path)
    };
  });
  res.render('projects', { projects });
});

app.post('/api/projects', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) {
    return res.status(400).json({ success: false, message: 'Project name is required' });
  }
  const project = projectsRepo.create({ name, description: '' });
  const file = filesRepo.create({
    projectId: project.id,
    path: 'Untitled.md',
    title: 'Untitled',
    content: `# ${name}\n`
  });
  res.status(201).json({ success: true, project, file });
});

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Vellum server running on http://localhost:${config.port}`);
  });
}

module.exports = app;
```

(The `/writing` and `/api/save-file/:fileId` routes are added in Task 9 — this is an intermediate state, not the final `server.js`.)

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/server.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/server.js src/server.test.js
git commit -m "feat: wire /projects and POST /api/projects to sqlite"
```

---

### Task 9: Wire `GET /writing` and `POST /api/save-file/:fileId`; remove the static HTML/models

**Files:**
- Modify: `src/server.js`
- Modify: `src/server.test.js`
- Delete: `src/views/writing.html`, `src/views/projects.html`, `src/models/memory-db.js`, `src/models/database.js`
- Modify: `src/public/js/main.js` (New Project flow now calls the real API)

**Interfaces:**
- Consumes: everything from Task 8, plus `filesRepo.getFirstForProject`, `filesRepo.getById`, `filesRepo.updateContent` (Task 4).

- [ ] **Step 1: Extend the test file with failing cases**

Add to `src/server.test.js`:

```js
test('GET /writing renders the project\'s first file by default', async () => {
  const server = await listen();
  const { port } = server.address();

  const createRes = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Writing Test Project' })
  });
  const { project } = await createRes.json();

  const res = await fetch(`http://127.0.0.1:${port}/writing?project=${project.id}`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /Untitled\.md/);
  server.close();
});

test('GET /writing 404s for an unknown project', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/writing?project=999999`);
  assert.equal(res.status, 404);
  server.close();
});

test('POST /api/save-file/:fileId persists content', async () => {
  const server = await listen();
  const { port } = server.address();

  const createRes = await fetch(`http://127.0.0.1:${port}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Save Test Project' })
  });
  const { project, file } = await createRes.json();

  const saveRes = await fetch(`http://127.0.0.1:${port}/api/save-file/${file.id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: 'updated body' })
  });
  assert.equal(saveRes.status, 200);
  assert.equal((await saveRes.json()).success, true);

  const writingRes = await fetch(`http://127.0.0.1:${port}/writing?project=${project.id}&file=${file.id}`);
  const body = await writingRes.text();
  assert.match(body, /updated body/);
  server.close();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/server.test.js`
Expected: FAIL — `/writing` still 404s, `/api/save-file/:fileId` doesn't exist

- [ ] **Step 3: Add the routes to `server.js`**

Insert before `if (require.main === module) {`:

```js
app.get('/writing', (req, res) => {
  const projectId = parseInt(req.query.project, 10);
  const project = projectsRepo.getById(projectId);
  if (!project) {
    return res.status(404).send('Project not found');
  }
  const file = req.query.file
    ? filesRepo.getById(parseInt(req.query.file, 10))
    : filesRepo.getFirstForProject(project.id);
  if (!file) {
    return res.status(404).send('No file to open for this project');
  }
  res.render('writing', { project, file });
});

app.post('/api/save-file/:fileId', (req, res) => {
  const fileId = parseInt(req.params.fileId, 10);
  const { content } = req.body;
  const success = filesRepo.updateContent(fileId, content);
  if (success) {
    res.json({ success: true, message: 'File saved successfully' });
  } else {
    res.status(404).json({ success: false, message: 'File not found' });
  }
});
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/server.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Delete the now-dead static files and in-memory models**

```bash
rm src/views/writing.html src/views/projects.html
rm src/models/memory-db.js src/models/database.js
```

Run: `grep -rn "memory-db\|models/database" src/ || echo "no remaining references"`
Expected: `no remaining references` (Task 5 already moved the seed script off `models/database`, and `server.js` no longer requires `memory-db`)

- [ ] **Step 6: Update the New Project flow in `main.js` to use the real endpoint**

In `src/public/js/main.js`, replace the `form.addEventListener('submit', ...)` handler inside `openNewProjectForm()`:

```js
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                const name = input.value.trim();
                if (!name) return;
                confirmBtn.disabled = true;
                fetch('/api/projects', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name })
                })
                .then(function(response) { return response.json(); })
                .then(function(data) {
                    if (data.success) {
                        window.location.href = `/writing?project=${data.project.id}&file=${data.file.id}`;
                    } else {
                        confirmBtn.disabled = false;
                        input.focus();
                    }
                })
                .catch(function() {
                    confirmBtn.disabled = false;
                });
            });
```

Then delete the now-unused `addProjectCard()` function entirely (search for `function addProjectCard` in `main.js` and remove it along with its call site) — the browser now navigates straight to the freshly created project's file instead of appending a DOM-only card, so the earlier "not saved between sessions" / disabled-Open caveats no longer apply.

- [ ] **Step 7: Manual smoke check of the new project flow**

```bash
node src/scripts/seed.js
PORT=3001 node src/server.js &
sleep 1
curl -s -X POST http://localhost:3001/api/projects -H 'Content-Type: application/json' -d '{"name":"Manual Check"}' | head -c 300
kill %1
```

Expected: JSON response with `"success":true` and a `project`/`file` object; no server error in the log.

- [ ] **Step 8: Commit**

```bash
git add -A src/server.js src/server.test.js src/public/js/main.js
git rm src/views/writing.html src/views/projects.html src/models/memory-db.js src/models/database.js
git commit -m "feat: wire /writing and save-file to sqlite; remove dead static views and in-memory models"
```

---

## Phase 3: Authentication

The product spec (`docs/SPEC.md`, "Security and Privacy") requires the workspace to be private and login-gated. This phase adds the minimum viable version: one shared password, a session cookie, no user accounts table.

### Task 10: Password hashing CLI

**Files:**
- Create: `src/scripts/hash-password.js`
- Test: `src/scripts/hash-password.test.js`
- Modify: `package.json` (add `bcryptjs`; add `"hash-password"` script)

**Interfaces:**
- Produces: `hashPassword(password: string) => string` (bcrypt hash, cost factor 12). CLI usage: `node src/scripts/hash-password.js <password>` prints the hash.

- [ ] **Step 1: Write the failing test**

```js
// src/scripts/hash-password.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { hashPassword } = require('./hash-password');

test('hashPassword() produces a hash bcrypt.compareSync accepts', () => {
  const hash = hashPassword('correct horse battery staple');
  assert.equal(bcrypt.compareSync('correct horse battery staple', hash), true);
  assert.equal(bcrypt.compareSync('wrong password', hash), false);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/scripts/hash-password.test.js`
Expected: FAIL — `Cannot find module './hash-password'`

- [ ] **Step 3: Install bcryptjs and write the implementation**

```bash
npm install bcryptjs
```

```js
#!/usr/bin/env node
// src/scripts/hash-password.js
const bcrypt = require('bcryptjs');

function hashPassword(password) {
  return bcrypt.hashSync(password, 12);
}

if (require.main === module) {
  const password = process.argv[2];
  if (!password) {
    console.error('Usage: node src/scripts/hash-password.js <password>');
    process.exit(1);
  }
  console.log(hashPassword(password));
}

module.exports = { hashPassword };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/scripts/hash-password.test.js`
Expected: PASS (1 test)

- [ ] **Step 5: Add the npm script**

Add to `package.json` `"scripts"`:

```json
"hash-password": "node src/scripts/hash-password.js"
```

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/scripts/hash-password.js src/scripts/hash-password.test.js
git commit -m "feat: add password hashing CLI for single-user auth"
```

---

### Task 11: Auth middleware

**Files:**
- Create: `src/auth/middleware.js`
- Test: `src/auth/middleware.test.js`

**Interfaces:**
- Consumes: `hashPassword` (Task 10, test-only).
- Produces: `requireAuth(req, res, next)` — Express middleware; redirects to `/login` unless `req.session.authenticated` is true. `verifyPassword(password, passwordHash) => boolean` — false if `passwordHash` is falsy (i.e. `AUTH_PASSWORD_HASH` was never configured, so login is impossible rather than silently open).

- [ ] **Step 1: Write the failing test**

```js
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test src/auth/middleware.test.js`
Expected: FAIL — `Cannot find module './middleware'`

- [ ] **Step 3: Write the implementation**

```js
// src/auth/middleware.js
const bcrypt = require('bcryptjs');

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.redirect('/login');
}

function verifyPassword(password, passwordHash) {
  if (!passwordHash) return false;
  return bcrypt.compareSync(password, passwordHash);
}

module.exports = { requireAuth, verifyPassword };
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `node --test src/auth/middleware.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/auth/middleware.js src/auth/middleware.test.js
git commit -m "feat: add session auth middleware"
```

---

### Task 12: Login view, session wiring, and gate every app route

**Files:**
- Create: `src/views/login.ejs`
- Modify: `src/server.js`
- Modify: `src/server.test.js`
- Modify: `src/public/css/style.css` (small addition for the login form)
- Modify: `package.json` (add `express-session`)

**Interfaces:**
- Consumes: `requireAuth`, `verifyPassword` (Task 11).

- [ ] **Step 1: Extend the test file with failing auth cases**

Add to the top of `src/server.test.js`, before `const app = require('./server');`:

```js
process.env.AUTH_PASSWORD_HASH = require('./scripts/hash-password').hashPassword('testpass');
```

Add these test cases:

```js
test('unauthenticated GET /projects redirects to /login', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/projects`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/login');
  server.close();
});

test('login with the correct password grants access to /projects', async () => {
  const server = await listen();
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const loginRes = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=testpass',
    redirect: 'manual'
  });
  assert.equal(loginRes.status, 302);
  const cookie = loginRes.headers.get('set-cookie');

  const projectsRes = await fetch(`${base}/projects`, { headers: { Cookie: cookie } });
  assert.equal(projectsRes.status, 200);
  server.close();
});

test('login with the wrong password is rejected', async () => {
  const server = await listen();
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=wrong'
  });
  assert.equal(res.status, 401);
  server.close();
});
```

Every other existing test in this file (the ones from Tasks 8–9) currently makes unauthenticated requests and will start failing once routes are gated in Step 3 below — that's expected. Update each of them to log in first and reuse the session cookie, following the same `fetch('/login', ...)` → grab `set-cookie` → pass `Cookie` header pattern shown above.

- [ ] **Step 2: Run the test and verify the new cases fail**

Run: `node --test src/server.test.js`
Expected: FAIL — `/login` doesn't exist yet (404), so `res.status` is `404` not `302`/`401`

- [ ] **Step 3: Install express-session and wire it into `server.js`**

```bash
npm install express-session
```

Add near the top of `server.js`, alongside the other requires:

```js
const session = require('express-session');
const { requireAuth, verifyPassword } = require('./auth/middleware');
```

Add after `app.use(express.static(...))`:

```js
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

app.get('/login', (req, res) => {
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  const { password } = req.body;
  if (verifyPassword(password, config.authPasswordHash)) {
    req.session.authenticated = true;
    return res.redirect('/projects');
  }
  res.status(401).render('login', { error: 'Wrong password' });
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});
```

Then add `requireAuth` as the second argument on every app route (leave `express.static`, `/login`, and `/logout` ungated):

```js
app.get('/projects', requireAuth, (req, res) => { /* ...unchanged body... */ });
app.post('/api/projects', requireAuth, (req, res) => { /* ...unchanged body... */ });
app.get('/writing', requireAuth, (req, res) => { /* ...unchanged body... */ });
app.post('/api/save-file/:fileId', requireAuth, (req, res) => { /* ...unchanged body... */ });
```

- [ ] **Step 4: Create the login view**

```ejs
<!-- src/views/login.ejs -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign in - Vellum</title>
    <link rel="stylesheet" href="/css/style.css">
    <link rel="icon" href="/img/vellum-mark.svg" type="image/svg+xml">
</head>
<body data-page="login">
    <div class="app-container">
        <main class="app-main login-main">
            <form class="login-form" method="POST" action="/login">
                <h1 class="app-title">vellum</h1>
                <input type="password" name="password" placeholder="Password" autocomplete="current-password" autofocus>
                <% if (error) { %>
                    <p class="login-error"><%= error %></p>
                <% } %>
                <button type="submit" class="btn btn-primary">Sign in</button>
            </form>
        </main>
    </div>
</body>
</html>
```

- [ ] **Step 5: Add minimal login styles**

Append to `src/public/css/style.css`:

```css
/* Login */
.login-main {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.login-form {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  width: 220px;
}

.login-form .app-title {
  margin-bottom: 0.5rem;
}

.login-form input {
  width: 100%;
  background: none;
  border: none;
  padding: 0.4rem 0;
  text-align: center;
  font-family: inherit;
  font-size: 13px;
  color: var(--ink);
}

.login-error {
  font-size: 11px;
  font-weight: bold;
}
```

- [ ] **Step 6: Run the test and verify it passes**

Run: `node --test src`
Expected: PASS (all tests across every file — this is the first full-suite run since routes became auth-gated, so it also confirms Step 1's cookie-forwarding updates to the older tests were done correctly)

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/server.js src/server.test.js src/views/login.ejs src/public/css/style.css
git commit -m "feat: add single-password session auth and gate app routes"
```

---

## Phase 4: Proxmox LXC Deployment

### Task 13: Deployment runbook

**Files:**
- Create: `docs/DEPLOYMENT.md`
- Modify: `README.md` (point the existing "Deployment" section at the new doc instead of the current three placeholder bullets)

- [ ] **Step 1: Write `docs/DEPLOYMENT.md`**

```markdown
# Deploying Vellum on Proxmox (LXC)

This runs Vellum as a systemd service inside an unprivileged Debian 12 LXC container, with SQLite data stored outside the app directory.

## 1. Create the container

From the Proxmox host shell (adjust `100` to a free VMID and `local-lvm`/bridge names to match your setup):

\`\`\`bash
pveam update
pveam download local debian-12-standard_12.7-1_amd64.tar.zst

pct create 100 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \\
  --hostname vellum \\
  --unprivileged 1 \\
  --cores 1 \\
  --memory 512 \\
  --swap 512 \\
  --rootfs local-lvm:8 \\
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \\
  --features nesting=0

pct start 100
pct enter 100
\`\`\`

512MB RAM / 1 vCPU / 8GB disk is comfortably enough for Node + SQLite at this scale; resize later with `pct set` if needed.

## 2. Base packages (inside the container)

\`\`\`bash
apt update && apt upgrade -y
apt install -y curl git build-essential python3 sqlite3

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

node -v   # expect v20.x
\`\`\`

`build-essential`/`python3` are there as a fallback in case `better-sqlite3` has no prebuilt binary for this exact Node/Debian combination — if the prebuilt binary works, npm skips the compile step automatically.

## 3. Private network access

Install Tailscale so the app is reachable privately without exposing a public port (matches the project's existing "Tailscale access" deployment note):

\`\`\`bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
\`\`\`

## 4. Create the service user and directories

\`\`\`bash
useradd --system --home /opt/vellum --shell /usr/sbin/nologin vellum
mkdir -p /opt/vellum /var/lib/vellum/data /etc/vellum
chown -R vellum:vellum /opt/vellum /var/lib/vellum
\`\`\`

## 5. Deploy the code

\`\`\`bash
su - vellum -s /bin/bash -c "git clone <your-repo-url> /opt/vellum"
cd /opt/vellum
su - vellum -s /bin/bash -c "cd /opt/vellum && npm ci --omit=dev"
\`\`\`

## 6. Configure

\`\`\`bash
cp /opt/vellum/.env.example /etc/vellum/vellum.env
\`\`\`

Edit `/etc/vellum/vellum.env`:

\`\`\`
PORT=3001
DB_PATH=/var/lib/vellum/data/vellum.db
SESSION_SECRET=<paste output of: openssl rand -hex 32>
AUTH_PASSWORD_HASH=<paste output of: node src/scripts/hash-password.js "your chosen password", run from /opt/vellum>
\`\`\`

Generate the two secrets from inside `/opt/vellum` (as the `vellum` user, so file ownership stays correct):

\`\`\`bash
su - vellum -s /bin/bash -c "cd /opt/vellum && openssl rand -hex 32"
su - vellum -s /bin/bash -c "cd /opt/vellum && node src/scripts/hash-password.js 'your chosen password'"
\`\`\`

Lock the env file down since it holds secrets:

\`\`\`bash
chown vellum:vellum /etc/vellum/vellum.env
chmod 600 /etc/vellum/vellum.env
\`\`\`

## 7. Migrate and seed

\`\`\`bash
su - vellum -s /bin/bash -c "cd /opt/vellum && set -a && source /etc/vellum/vellum.env && set +a && node src/scripts/seed.js"
\`\`\`

(`seed.js` runs `migrate()` itself before inserting rows — see `src/scripts/seed.js` — so this single command both creates the schema and seeds the two sample projects.)

## 8. Install and start the systemd service

\`\`\`bash
cp /opt/vellum/deploy/vellum.service /etc/systemd/system/vellum.service
systemctl daemon-reload
systemctl enable --now vellum
systemctl status vellum
\`\`\`

## 9. Verify

\`\`\`bash
curl -I http://127.0.0.1:3001/login          # expect: HTTP/1.1 200 OK
journalctl -u vellum -n 50 --no-pager        # expect: "Vellum server running on http://localhost:3001"
\`\`\`

From another machine on your Tailnet: open `http://<vellum-tailscale-ip>:3001/login`, sign in with the password you hashed in step 6, and confirm the two seeded projects ("Sample Project", "Documentation") load, open, and save edits.

## 10. Backups

See `deploy/backup.sh` for a nightly SQLite backup script, and set up a Proxmox `vzdump` backup job for the whole container (Datacenter → Backup) as the primary safety net — that captures the full container including `/var/lib/vellum/data`.

## 11. Upgrading

\`\`\`bash
su - vellum -s /bin/bash -c "cd /opt/vellum && git pull && npm ci --omit=dev"
systemctl restart vellum
\`\`\`

The database lives in `/var/lib/vellum/data`, outside `/opt/vellum`, so `git pull` never touches it.
```

- [ ] **Step 2: Point the README's Deployment section at this doc**

In `README.md`, replace the current "Deployment" section:

```markdown
## Deployment

For Proxmox container deployment:
1. Build the application
2. Configure Tailscale access
3. Set up reverse proxy if needed
4. Run with appropriate environment variables
```

with:

```markdown
## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full Proxmox LXC setup (container creation, Tailscale, systemd service, backups, upgrades).
```

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOYMENT.md README.md
git commit -m "docs: add Proxmox LXC deployment runbook"
```

---

### Task 14: systemd unit file

**Files:**
- Create: `deploy/vellum.service`

- [ ] **Step 1: Write the unit file**

```ini
[Unit]
Description=Vellum writing workspace
After=network.target

[Service]
Type=simple
User=vellum
Group=vellum
WorkingDirectory=/opt/vellum
EnvironmentFile=/etc/vellum/vellum.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/vellum

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 2: Validate the file parses**

Run: `systemd-analyze verify deploy/vellum.service || true`
Expected: no `ExecStart` / directive parse errors reported (the `User=vellum` / `WorkingDirectory=/opt/vellum` warnings about missing paths are expected on a dev machine that isn't the LXC — those paths only need to exist on the actual container from Task 13 Step 4).

- [ ] **Step 3: Commit**

```bash
git add deploy/vellum.service
git commit -m "feat: add systemd unit for the Vellum service"
```

---

### Task 15: Backup script

**Files:**
- Create: `deploy/backup.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${DB_PATH:-/var/lib/vellum/data/vellum.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vellum}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/vellum-$TIMESTAMP.db'"

# Keep the last 14 backups
ls -1t "$BACKUP_DIR"/vellum-*.db 2>/dev/null | tail -n +15 | xargs -r rm --
```

- [ ] **Step 2: Make it executable and lint it**

```bash
chmod +x deploy/backup.sh
bash -n deploy/backup.sh
```

Expected: `bash -n` (syntax check) prints nothing and exits 0.

- [ ] **Step 3: Add the cron note to the deployment doc**

Append to `docs/DEPLOYMENT.md`, under the existing "Backups" section:

```markdown
Install a nightly cron job on the LXC (as root):

\`\`\`bash
echo "0 3 * * * vellum DB_PATH=/var/lib/vellum/data/vellum.db BACKUP_DIR=/var/backups/vellum /opt/vellum/deploy/backup.sh" > /etc/cron.d/vellum-backup
\`\`\`
```

- [ ] **Step 4: Commit**

```bash
git add deploy/backup.sh docs/DEPLOYMENT.md
git commit -m "feat: add sqlite backup script and cron guidance"
```

---

### Task 16: Full local smoke test (pre-deployment gate)

This is the final check before following the runbook on real Proxmox hardware: run the entire stack locally exactly as systemd will, end to end.

**Files:** none (verification only)

- [ ] **Step 1: Run the full automated test suite**

Run: `npm test`
Expected: every test across `src/db`, `src/scripts`, `src/views`, `src/auth`, and `src/server.test.js` passes.

- [ ] **Step 2: Run the app against a throwaway local database**

```bash
export DB_PATH=/tmp/vellum-smoke.db
export SESSION_SECRET=smoke-test-secret
export AUTH_PASSWORD_HASH=$(node src/scripts/hash-password.js smoketest)
export PORT=3099

node src/scripts/seed.js
node src/server.js &
sleep 1
```

- [ ] **Step 3: Walk the full user flow with curl**

```bash
# Unauthenticated request redirects to /login
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3099/projects
# Expected: 302

# Log in and keep the session cookie
curl -s -c /tmp/vellum-cookies.txt -X POST http://localhost:3099/login \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'password=smoketest' -o /dev/null -w "%{http_code}\n"
# Expected: 302

# Authenticated project list shows the seeded projects
curl -s -b /tmp/vellum-cookies.txt http://localhost:3099/projects | grep -o "Sample Project"
# Expected: Sample Project

# Create a project through the real API
curl -s -b /tmp/vellum-cookies.txt -X POST http://localhost:3099/api/projects \
  -H 'Content-Type: application/json' -d '{"name":"Smoke Test Project"}'
# Expected: {"success":true,"project":{...},"file":{...}}
```

- [ ] **Step 4: Confirm the created project survives a process restart**

```bash
kill %1
sleep 1
node src/server.js &
sleep 1
curl -s -b /tmp/vellum-cookies.txt http://localhost:3099/projects | grep -o "Smoke Test Project"
```

Expected: `Smoke Test Project` — proves the SQLite file, not an in-memory structure, is the source of truth.

- [ ] **Step 5: Clean up**

```bash
kill %1
rm -f /tmp/vellum-smoke.db /tmp/vellum-cookies.txt
```

- [ ] **Step 6: This task has no commit** — it's a verification gate. If every check above passed, Phases 1–3 are ready to deploy following `docs/DEPLOYMENT.md` (Task 13).

---

## Follow-on Work (explicitly not in this plan)

Per the Global Constraints, this plan stops at durable projects/files storage, private auth, and deployment. The next slices, in the order `docs/IMPLEMENTATION_PLAN.md` already lays out, are:

- **M2** — persist chat messages (currently ephemeral/mock, resets on reload).
- **M3 / M3.5** — selection-aware agent edits and live agent presence.
- **M4 / M5** — snapshots, named versions, git materialization.
- **M6** — real multi-user live collaboration (the presence avatars and decorative cursor/line-tint built earlier are mock UI for exactly this milestone).

Each deserves its own brainstorming + plan pass rather than being bolted onto this one.
