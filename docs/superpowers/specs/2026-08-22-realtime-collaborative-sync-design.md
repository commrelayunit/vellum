# Real-Time Collaborative Sync Infrastructure — Design

## Purpose

Vellum's editor is currently a single-writer textarea: one browser tab loads a file's content once, edits it locally, and periodically POSTs the whole content back. There is no mechanism for two writers to edit the same file at once, and no way to see another writer's live cursor position — both are prerequisites for the actual goal driving this project: giving an AI agent a way to write directly into a Vellum document with its activity visible in real time, the same way a human collaborator's would be.

This project builds that prerequisite: a real-time, conflict-free collaborative sync layer for document content, using a CRDT (Yjs) so simultaneous edits from multiple writers merge automatically and correctly, with live cursor/selection broadcast reusing the presence-color conventions already established in the app. It does **not** give an agent write access — that is Sub-project 2, built as a client of the sync layer this project defines.

## Scope

**In scope:**
- A WebSocket-based sync channel, co-located in the existing Express process, using Yjs CRDTs so concurrent edits from multiple connected writers merge without conflicts or lost data.
- Swapping the plain `<textarea>` editor for CodeMirror 6, re-themed to be visually indistinguishable from the current editor, gaining Yjs's official CodeMirror binding (`y-codemirror.next`) in the process.
- Live cursor/selection broadcast (Yjs's "awareness" protocol) for every connected writer, rendered using the app's existing presence colors.
- Schema changes to persist the CRDT document as the source of truth, with a plain-text mirror kept for everything that doesn't need to understand Yjs (chat context, export, search).
- Session-authenticated WebSocket connections, gated the same way HTTP routes are today.

**Explicitly out of scope:**
- The agent write API/CLI itself (Sub-project 2) — this project only builds the sync layer it will connect to.
- Real user accounts / distinguishing multiple simultaneous human identities. There is still only one shared profile ("You"); two browser tabs of the same person will show as two same-colored, same-labeled cursors. Solving that is what real accounts would be for, not this project.
- Sub-projects B (select-range-to-chat-reference) and C (Overleaf-style margin comments) — unrelated, separately scoped, still not built.
- Removing or replacing the existing `POST /api/save-file/:fileId` route. It remains as a fallback/non-realtime path; the WebSocket sync channel is the primary path once connected.

## Architecture

A WebSocket endpoint, `/ws/files/:fileId`, runs alongside the existing HTTP server via the `ws` npm package. The HTTP-to-WebSocket upgrade is gated by the same session cookie `requireAuth` already checks for every other route — an unauthenticated upgrade request is rejected before the WebSocket handshake completes.

The server keeps one in-memory `Y.Doc` per currently-open file, created on the first WebSocket connection for that file and released once the last connected client for that file disconnects. On creation, the doc is seeded from `content_yjs` if present, or from the existing plain-text `content` column on a file's first sync-layer use (a one-time, lazy, per-file migration — not a big-bang conversion of every row). On last-disconnect, the doc's current encoded state is persisted back to `content_yjs`, and its derived plain text to `content`, before the doc is released from memory.

Sync messages between clients and server follow the standard Yjs wire protocol via `y-protocols/sync` (document updates) and `y-protocols/awareness` (ephemeral cursor/selection/presence state) — this is a well-established, widely-used pattern; the server relays sync and awareness messages between all clients connected to the same file's `Y.Doc`, and Yjs's CRDT algorithm handles merging concurrent edits with no custom conflict-resolution code required.

## Build tooling

This app has never had a frontend build step — `main.js` is served as-is via `express.static`. The new client-side dependencies (`yjs`, `y-codemirror.next`, `@codemirror/*`) are npm packages meant to be bundled; browsers can't resolve their bare `import` specifiers on their own, and this project deliberately avoids CDN dependencies. `esbuild` is added as a devDependency: a new `npm run build:client` script bundles a new client-side entry point (`src/client/editor-sync.js`) into a static output file (`src/public/js/editor-bundle.js`), which `writing.ejs` loads alongside the existing plain `main.js`. This build step is wired into the Docker image build, the LXC install script, and `npm run dev`'s workflow (via esbuild's watch mode), so every existing deployment path keeps working with one added step.

## Editor swap

`src/views/writing.ejs`'s `<textarea id="markdown-editor">` is replaced with a CodeMirror 6 mount point. CodeMirror is configured with:
- A `basicSetup`-style minimal extension set (no language mode, no syntax highlighting, no gutter, no line numbers) — kept deliberately plain to match the current editor's appearance.
- A theme (`EditorView.theme()`) matching the existing `.editor-textarea` CSS exactly: `font-family: 'Courier New', monospace`, `font-size: 14px`, `line-height: 1.5`, `--ink`/`--paper` colors, no border/box-shadow chrome beyond what's already there.
- CodeMirror's native active-line highlighting, restyled to match the current `.cursor-line-tint`'s `color-mix(in srgb, var(--presence-you) 14%, transparent)` look — this replaces the hand-rolled `.cursor-line-tint` div and its JS entirely, and correctly handles soft-wrapped lines (the old implementation's known limitation, since it only ever counted logical `\n`-delimited lines).
- The `yCollab` extension from `y-codemirror.next`, bound to the file's `Y.Doc` shared text type and awareness instance — this single extension handles both content sync and remote-cursor rendering.

`src/public/js/main.js`'s chat-panel code (`editorForChat`, reading `#markdown-editor`'s `data-file-id`) and the now-removed cursor-line-tracking code both need updating for the new mount point's structure.

## Data model & migration

```sql
-- new migration: add content_yjs alongside the existing content column
ALTER TABLE files ADD COLUMN content_yjs BLOB;
```

`content` (`TEXT`) is kept as a plain-text mirror, updated whenever the server persists the `Y.Doc` (on last-disconnect, and by the existing periodic-save path below) — so every other feature that reads a file's content (chat completion's context, file export, the projects-list preview) keeps working unmodified, reading `content` exactly as today. `content_yjs` is the CRDT source of truth once a file has been opened through the sync layer at least once; until then, `content_yjs` is `NULL` and `content` alone is authoritative, exactly as today.

## Save behavior

The existing `POST /api/save-file/:fileId` route (whole-content overwrite, called by the client on some interval/blur today) is unchanged and remains available as a fallback. Once a file is connected via the WebSocket sync channel, the server's own persistence is the primary durability mechanism: it snapshots the live `Y.Doc` to `content`/`content_yjs` on last-disconnect, and additionally every 30 seconds while at least one client stays connected (so a long-lived session survives a server restart without waiting for everyone to disconnect first) — the live `Y.Doc` in memory is always the most current state; these snapshots are how that state survives the process going away.

## Live cursor UI

Each connected writer's Yjs awareness state carries `{ cursor, selection, name, color }`. `color` is computed client-side using the exact same logic already driving presence-avatar colors (`AVATAR_COLORS[hashString(label) % N]`, with the local user forced to index 0 / `--presence-you`, matching the fix already shipped for the profile avatar) — so a writer's live cursor color always matches their presence-stack avatar color. `y-codemirror.next`'s built-in remote-cursor decorations render this as a thin colored caret with a small floating label, restyled to match Vellum's existing visual language rather than the library's default appearance.

## Testing

- A real integration test opens two WebSocket client connections (via the `ws` package as a test client) to the same file's sync endpoint, sends an edit from one, and asserts the other receives the merged update reflecting the change — exercising the actual Yjs merge behavior, not a mock.
- A persistence test: connect, send an edit, disconnect, then verify the file's `content`/`content_yjs` columns in the database reflect the change.
- An auth test: a WebSocket upgrade request without a valid session cookie is rejected before the handshake completes.
- No automated test for CodeMirror's visual rendering, theming, or remote-cursor decoration styling — matches the established no-frontend-test-runner precedent elsewhere in this codebase (cursor-line tracking, avatar resolution, the chat panel's streaming JS). Verified manually in a real browser with two simultaneous sessions.
