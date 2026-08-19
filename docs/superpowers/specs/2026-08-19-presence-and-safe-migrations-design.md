# Real Presence, User Profile & Safe Schema Migrations — Design

## Purpose

The writing view currently shows two fictional collaborators (Ada Chen, Milo Reyes) and a decorative fixed-position "live cursor" — neither is real; there's no multi-user backend. This design replaces that with: a real, editable user profile always shown in the presence stack with your actual cursor position highlighted, and AI providers appearing in the presence stack only when manually marked "active in this workspace" (a real, working stand-in for the automatic detection a future chat-integration project would drive).

Building this safely requires fixing a real gap first: `migrate(db)` currently only does `CREATE TABLE IF NOT EXISTS`, which silently no-ops for schema changes to tables that already exist. Every prior task in this project added brand-new tables, so this never mattered until now — `ai_providers` already exists in deployed databases, and this design needs to add a column to it. Without real migration infrastructure, that column addition would work on `:memory:` test databases (created fresh every time) but silently fail to appear on any real, already-running instance.

## Scope

- A numbered-migrations runner replacing the current static `CREATE TABLE IF NOT EXISTS` approach, general-purpose for all future schema changes, not special-cased for this one.
- A `user_profile` table and repository (label + avatar, single row, matching the app's existing instance-wide model).
- An `active_in_workspace` column on `ai_providers`, toggleable from Settings.
- Real presence rendering in the writing view (your profile + active providers), replacing the mock `PRESENCE_USERS` array entirely.
- Real self-cursor-line highlighting, replacing the decorative fixed-position demo.
- An `npm run update` command and README documentation making the "will this wipe my data" question answerable with a flat no, for every deployment path.

**Explicitly out of scope:**
- Actually wiring the chat panel to call a provider, or any automatic detection of "connected" — `active_in_workspace` is a manual toggle only. A future chat-integration project can flip the same field programmatically without any schema change.
- The "terminal UI feel" / whole-app lowercase pass — a separate, later design/implementation pass, deliberately not bundled with this one since it touches every view rather than the pieces this design adds.
- Real-time multi-user collaboration (other humans' live cursors, WebSocket sync) — still milestone M6, still unbuilt. This design's "presence" is single-user-plus-manually-toggled-providers, not live multiplayer.

## Safe schema migrations

New directory, `src/db/migrations/`, one file per change:

```js
// src/db/migrations/0001_baseline.js
module.exports = {
  id: '0001_baseline',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS projects ( ... );
      CREATE TABLE IF NOT EXISTS files ( ... );
      CREATE TABLE IF NOT EXISTS ai_providers ( ... );
    `);
  }
};
```

`0001_baseline.js` is the exact current contents of `SCHEMA` from `src/db/schema.js` — on a database that already has these tables (every existing deployment), it's a genuine no-op, same as today. On a brand-new database, it creates everything from scratch, same as today. This migration's only job is being a safe bridge from the old approach to the new one; it never needs to change again.

`0002_user_profile.js` and `0003_provider_active_in_workspace.js` (this design's real schema changes) use real DDL — `CREATE TABLE` for the new table, `ALTER TABLE ai_providers ADD COLUMN` for the new column — which correctly applies to existing databases, unlike the old `CREATE TABLE IF NOT EXISTS` approach.

A new tracking table records what's been applied:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`src/db/schema.js`'s `migrate(db)` becomes a runner: ensure `schema_migrations` exists, read `src/db/migrations/` in filename order, skip any whose `id` is already recorded, run the rest — each inside its own transaction — and record each as applied immediately after it succeeds. Still called unconditionally on every server boot, exactly as today; the difference is it's now safe to call against a database with real data in it, because each migration runs at most once, ever, and nothing is ever dropped or recreated.

**Interface:** `migrate(db) => void` — signature unchanged from today, so nothing calling it (`server.js`, `seed.js`, every `*.test.js`) needs to change.

## Data model

```sql
CREATE TABLE IF NOT EXISTS user_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  label TEXT NOT NULL DEFAULT 'You',
  avatar_url TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Single-row table (`CHECK (id = 1)` enforces it), matching the same instance-wide philosophy as `ai_providers` — no multi-user accounts exist, so "your profile" means the instance's one profile. `0002_user_profile.js`'s migration seeds the default row (`INSERT OR IGNORE INTO user_profile (id, label) VALUES (1, 'You')`) so `getProfile()` always returns a real row, no null-handling needed anywhere that reads it.

```sql
ALTER TABLE ai_providers ADD COLUMN active_in_workspace INTEGER NOT NULL DEFAULT 0;
```

`0` is "not active" — existing providers stay inactive (absent from presence) until manually toggled on, which is the correct default: a provider being *stored* doesn't mean it should be *presented as present*.

## Repository

`src/db/user-profile.js`, matching the shape of `src/db/providers.js`:

```js
createUserProfileRepo(db) => {
  get() => {label, avatarUrl, updatedAt},
  update({label, avatarUrl}) => same shape
}
```

`src/db/providers.js`'s `create`/`update` gain one more optional field, `activeInWorkspace` (boolean, default `false` on create), threaded through to the new column the same way `defaultModel`/`avatarUrl` already are. `toViewModel` gains `activeInWorkspace` in its returned shape.

## Routes

- `POST /api/profile` (new, `requireAuth`) — validates `label` as a non-empty string (matching the provider routes' validation pattern), `avatarUrl` optional. Updates the singleton row, returns `{success, profile}`.
- `GET /settings` — also fetches `userProfileRepo.get()`, passes it to the view as `profile`.
- `GET /writing` — also fetches `userProfileRepo.get()` and `providersRepo.list().filter(p => p.activeInWorkspace)`, passes both to the view as `profile` and `activeProviders`.
- `POST /api/providers/:id` — accepts one more optional body field, `activeInWorkspace` (boolean), alongside the existing fields.

## Settings UI

A new "Your Profile" card at the top of `settings.ejs`, above the providers list — same inline-edit-in-place pattern already built for providers (label + avatar URL fields, an avatar circle using the same `data-avatar-target` resolution). One difference: the avatar element gets `data-skip-brand-lookup="true"`, and `resolveProviderAvatar` in `main.js` checks for that attribute and skips straight from "custom URL" to "initials + color" — the Simple Icons brand-matching tier exists to recognize companies like OpenAI or Anthropic, which doesn't apply to a person's own profile picture.

Each provider card gains a small icon toggle (filled/outline circle, matching the app's icon-only button convention) for "active in this workspace," calling `POST /api/providers/:id` with just `{activeInWorkspace: !current}` — reusing the existing update route rather than adding a new one.

## Writing view: real presence

`writing.ejs`'s `#presence-stack` is server-rendered from real data instead of being populated client-side from a hardcoded array: one avatar div for `profile` (always first), then one per entry in `activeProviders` — same `data-avatar-target`/`data-label`/`data-avatar-url` markup the settings page already established, so the existing `resolveProviderAvatar` client-side code handles all of them without new client logic beyond the brand-lookup-skip flag above.

The decorative name-flag badge (`.cursor-flag`/`#cursor-demo`) is removed entirely — it was chrome around the mock, and a real highlighted line plus your own avatar in the stack is sufficient "you are here" signal without inventing a floating name tag.

## Real self-cursor-line highlighting

`.cursor-line-tint`'s position becomes computed, not hardcoded. New logic in `main.js`, scoped to the writing view:

1. On `selectionchange`, `click`, and `keyup`/`input` on `#markdown-editor`, read `textarea.selectionStart` and count newlines in `textarea.value.slice(0, selectionStart)` to get the current line index.
2. Convert line index to a pixel offset: `lineIndex * lineHeightPx - textarea.scrollTop`, where `lineHeightPx` matches the editor's actual CSS (`font-size: 14px; line-height: 1.5` → 21px, which is exactly the value the old hardcoded demo already used — the mock's positioning math was already correct, just static).
3. Set `.cursor-line-tint`'s `top` to that offset; color stays `color-mix(in srgb, var(--presence-you) 14%, transparent)`, matching the existing CSS technique exactly, just now applied to the real current line instead of a fixed one.

No networking, no server round-trip — this only ever reflects the local session's own cursor.

## Update command & documentation

- New `src/scripts/migrate.js`: a thin CLI (`createConnection` + `migrate(db)`, exit) — runnable standalone without starting the server, for use in deploy/update flows.
- `package.json` gains two scripts: `"migrate": "node src/scripts/migrate.js"` and `"update": "git pull && npm ci && npm run migrate"`.
- New README section, "## Updating," documenting `npm run update` for native installs, with one explicit sentence: schema updates never wipe existing data, projects, files, provider credentials, or settings, on any deployment path.
- `docs/DOCKER.md`'s existing "## Upgrading" section (`git pull && docker compose up -d --build`) and `docs/DEPLOYMENT.md`'s existing "## 11. Upgrading" section (`git pull && npm ci --omit=dev && systemctl restart vellum`) both already run `migrate(db)` automatically at boot — no command changes needed for either, just one added sentence in each confirming this is now safe by construction, cross-referencing the new migrations runner.

## Testing

- `src/db/schema.test.js` (rewritten): the runner applies all migrations to a fresh `:memory:` DB and produces the expected final schema; running `migrate(db)` a second time is a no-op (nothing re-applied, `schema_migrations` unchanged). Most important test in this whole design: apply only `0001_baseline` to a fresh DB, insert a real `ai_providers` row (via `createProvidersRepo`, so it's genuinely encrypted), *then* run the full `migrate(db)` (applying `0002`/`0003`), and assert the previously-inserted row's data — label, encrypted key, everything — is completely unchanged, and the new `active_in_workspace` column now exists with its default value. This directly tests the "never wipes existing data" guarantee rather than just asserting it in prose.
- `src/db/user-profile.test.js` (new): `get()` always returns a row post-migration; `update()` persists and round-trips both fields.
- `src/db/providers.test.js` (extended): `create()`/`update()` correctly default/persist `activeInWorkspace`.
- `src/server.test.js` (extended): `POST /api/profile` create/validation; `GET /writing` includes real profile/active-provider data in the rendered HTML; `POST /api/providers/:id` persists `activeInWorkspace`.
- `src/views/views.test.js` (extended): `writing.ejs` renders the presence stack correctly from a `profile` + `activeProviders` fixture, and renders correctly with zero active providers (profile-only).
- The self-cursor-line-tracking JS has no automated coverage, matching every other piece of interactive `main.js` behavior in this codebase (no frontend test runner exists) — verification is manual, in a real browser, the same limitation noted for the AI-provider-settings work.
