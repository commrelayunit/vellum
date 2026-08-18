# AI Provider Settings — Design

## Purpose

Vellum's chat panel (in the writing view) is currently decorative — it sends canned/mock messages and calls no real AI backend. This design adds a settings page where the operator can store credentials for one or more AI backends, so that a future piece of work can wire the chat panel to actually call them.

This design covers **storage and management of provider credentials only**. Making the chat panel actually call a configured provider is explicitly out of scope and left as follow-on work.

## Background: why this isn't provider-specific

The request that motivated this originally asked about integrating "OpenClaw agents" specifically. Investigation (see below) found that OpenClaw exposes a local **Gateway** component with an **OpenAI-compatible HTTP API** (`/v1/chat/completions`, `/v1/models`, `/v1/embeddings`) on a configurable local port (default `18789`), authenticated via a shared-secret token — the same shape as calling OpenAI's API directly, just pointed at a different base URL.

This generalizes: OpenClaw, Hermes, and similar self-hosted agent runtimes; cloud model subscriptions (Anthropic, OpenAI, z.ai, etc. — many of which offer OpenAI-compatible endpoints); and self-hosted model servers (Ollama, LM Studio, vLLM) can all be represented identically: a **label**, a **base URL**, and an **API key**. Nothing in this design needs to know or care which category a given provider belongs to — that distinction exists only in how the user names their entries, not in the schema or code.

## Scope note: "per user"

Vellum has no user-accounts concept — it's single-shared-password "Personal mode" auth (one password gates the whole instance). Provider settings are therefore **instance-wide**, not per-account: there is one shared list of providers, visible and editable by whoever is logged in. This matches how the rest of the app already works and avoids introducing a multi-user accounts system as a side effect of this feature.

## Data Model

New table, added via a migration in `src/db/schema.js` (same file/pattern as the existing `projects`/`files` tables):

```sql
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
```

- `label` — free text, user-chosen (e.g. "OpenClaw – home", "Claude direct", "z.ai"). No enum/category field — see Background above. Also serves as the display name; no separate name field.
- `base_url` — the OpenAI-compatible endpoint root (e.g. `http://localhost:18789/v1`, `https://api.anthropic.com/v1`).
- `api_key_encrypted` — never stored in plaintext (see Encryption below).
- `default_model` — optional; a model name to default to for this provider (e.g. `claude-sonnet-4-5`). Nullable — purely informational until chat wiring exists.
- `avatar_url` — optional custom image URL for the provider's display picture. Nullable — see Avatar Display below for what renders when it's absent.

## Avatar Display

Each provider gets a small circular picture in the settings list (and, later, wherever chat wiring surfaces providers as participants — matching the existing collaborator-presence avatar style). Resolved at render time, in this order, with nothing beyond `avatar_url` stored in the DB:

1. **Custom URL set** — render `avatar_url` directly as the image source.
2. **No custom URL, label matches a known brand** — a small built-in lookup table (in `src/public/js/main.js` or a dedicated `provider-avatars.js`) maps case-insensitive substrings of `label` (e.g. `"openai"`, `"claude"`/`"anthropic"`) to a [Simple Icons](https://simpleicons.org/) CDN URL (e.g. `https://cdn.simpleicons.org/openai`). Simple Icons are free, single-color brand-mark SVGs built specifically for third-party use, and their monochrome style matches Vellum's existing ink-on-paper design language — no logo assets are downloaded or bundled into the repo, only hotlinked by URL, avoiding any concern about redistributing brand assets in git.
3. **No match** (covers OpenClaw, Hermes, z.ai, self-hosted Ollama, or anything else not in the small known-brand table) — fall back to an initials + color circle, the same visual pattern as the existing collaborator-presence avatars (`.presence-avatar`). Initials are derived from `label`; the color is deterministically derived from a hash of `label` mapped into a small fixed palette, so it stays stable across reloads without needing its own stored column.

This logic is pure presentation — it doesn't affect storage, the repo interface, or the routes below, beyond the addition of the single `avatar_url` column.

## Encryption

A new module, `src/crypto/secrets.js`, following the same plain-function style as `src/db/*`:

```js
encrypt(plaintext: string) => string   // AES-256-GCM, IV + ciphertext + authTag encoded together
decrypt(ciphertext: string) => string
```

Keyed by a new `ENCRYPTION_KEY` environment variable (32-byte key, base64-encoded), loaded through `src/config.js` alongside the existing `sessionSecret`/`authPasswordHash` — same pattern, same file. Generated once at deploy time, documented in `.env.example` and `docs/DEPLOYMENT.md` (mirroring how `SESSION_SECRET` and `AUTH_PASSWORD_HASH` are already documented).

The database file alone is never sufficient to recover a provider's API key — the `.env` file (or systemd `EnvironmentFile`) is also required, matching the threat model already established for `SESSION_SECRET`.

## Key display: masked, replace-only

The API key is never sent back to the browser in plaintext after creation:

- `list()` / `getById()` in the repo decrypt only long enough to compute a masked display value (e.g. `•••• a1b2`, last 4 characters) — the plaintext key itself is discarded immediately after.
- The edit form's key field starts blank. Submitting it blank leaves the stored key unchanged; typing a new value replaces it.
- This means opening the settings page or an edit form never re-transmits a previously-saved secret over the wire, even to an authenticated session.

## Repository

`src/db/providers.js`, matching the shape of `src/db/projects.js`/`src/db/files.js`:

```js
createProvidersRepo(db) => {
  list(),                                    // returns [{id, label, baseUrl, maskedKey, defaultModel, avatarUrl, ...}]
  getById(id),                               // same shape, single row
  create({label, baseUrl, apiKey, defaultModel, avatarUrl}),
  update(id, {label, baseUrl, apiKey, defaultModel, avatarUrl}),  // apiKey optional — omit/blank to leave unchanged
  remove(id)
}
```

`create`/`update` call `encrypt()` before writing `api_key_encrypted`. `list`/`getById` call `decrypt()` internally only to derive the masked value, never expose the plaintext through the returned object.

## Routes

All new routes live in `src/server.js`, gated by `requireAuth` (same middleware, same convention as every existing route):

- `GET /settings` — renders the provider list.
- `POST /api/providers` — create. Validates `label` and `baseUrl` as non-empty strings, `apiKey` required non-empty string. `avatarUrl` is optional and unvalidated beyond being a string (no fetch/existence check — same "storage, not live integration" stance as `baseUrl`). 400 on invalid input (matching the validation pattern already used by `POST /api/projects` and `POST /api/save-file/:fileId`).
- `POST /api/providers/:id` — update. Same validation, except `apiKey` is optional (blank/omitted = unchanged).
- `POST /api/providers/:id/delete` — delete. Matches the app's existing form-friendly POST convention (no DELETE verb elsewhere in the app, no fetch-based SPA routing to justify adding one here).

## UI

- `src/views/settings.ejs` — new view, built from `partials/header`/`partials/footer` like every other page. Provider list styled like `projects.ejs`'s card list: monochrome, icon-only actions (edit/delete), no borders/fills, consistent with the rest of the app. Each row shows the resolved avatar (see Avatar Display above) next to the label. An inline "+ Add provider" form follows the same pattern as the existing new-project flow in `main.js`, with an optional avatar-URL field.
- Navigation: a "Settings" item added to the existing ⋮ dropdown menu in `partials/header.ejs`, visible on every page alongside "New project" / "Back to projects".
- `src/public/css/style.css`: reuse `.project-card`-style classes where the shape matches; add only what's genuinely new (masked-key display, inline edit-form state).
- `src/public/js/main.js`: add settings-page form handlers (add/edit/delete) following the existing fetch-based patterns already in the file (e.g. the new-project flow added in the SQLite persistence work).

## Testing

- `src/crypto/secrets.test.js` — encrypt/decrypt round-trips to the original plaintext; ciphertext is verifiably different from plaintext; decrypting with a wrong key fails rather than silently returning garbage.
- `src/db/providers.test.js` — repo CRUD against an in-memory DB (matching every other `src/db/*.test.js`), including: `list()`/`getById()` never return a decrypted key, only a masked one; `update()` with a blank `apiKey` leaves the stored encrypted value unchanged; `remove()` actually removes the row; `avatarUrl` round-trips through create/update like any other field.
- Avatar fallback logic (known-brand lookup → initials/color) is presentation-only JS with no server-side test coverage needed here — same rationale as not testing CSS.
- `server.test.js` additions — authenticated create/list/update/delete round trip; an unauthenticated-redirect check for `GET /settings` matching the existing gating tests for other routes.

## Explicitly out of scope

- Making the chat panel actually call a configured provider (separate follow-on project).
- Any category/type field distinguishing agents from cloud subscriptions from self-hosted models — see Background.
- Live validation of a provider's `base_url` (e.g. pinging `/v1/models` to confirm it's reachable) — this is credential storage, not a working integration yet.
- Multi-user accounts — see Scope note above.
- Image upload / file storage for avatars — `avatar_url` is a link to an externally-hosted image, not an uploaded file. No new storage location, no multipart handling.
