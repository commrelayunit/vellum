# vellum

Vellum is a private, self-hostable writing workspace for humans and agents.

The goal is a simple shared writing surface: project files, live Markdown editing, file- and selection-scoped chat, visible agent presence, proposed edits, and git-like history without the noise of a general productivity dashboard.

## Product Direction

- document-first interface
- quiet paper/ink visual language
- live collaborator presence without theatrical typing
- range-aware agent review and rewrite actions
- named checkpoints, diffs, and restore
- Markdown first; later export/sync paths for repositories and document systems

## Docs

- [Product spec](docs/SPEC.md)
- [Implementation plan](docs/IMPLEMENTATION_PLAN.md)
- [Current implementation status](TODOS.md)

## Brand

Initial brand assets live in `assets/brand/`.

- `vellum-mark.svg` / `vellum-mark.png`: folded sheet + cursor mark
- `vellum-lockup.svg` / `vellum-lockup.png`: lowercase italic serif wordmark

The primary mark should stay free of notification dots, badges, mascot marks, or AI-gradient decoration. Agent presence belongs in the product interface state.

## MVP - Simplified Interface (M1)

This implementation includes:
- Project/file CRUD
- Markdown editor with minimal UI
- Save/load from database
- Preview toggle
- Download file
- Collapsible chat panel
- Monospace font styling

## Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the example env file and fill in the required values:
   ```bash
   cp .env.example .env
   ```

3. Generate a password hash for login and set it as `AUTH_PASSWORD_HASH` in `.env`:
   ```bash
   npm run hash-password -- "your chosen password"
   ```

4. Generate an encryption key for AI provider API keys and set it as `ENCRYPTION_KEY` in `.env` (it ships empty in `.env.example` — without it, saving a provider on the Settings page will fail):
   ```bash
   openssl rand -base64 32
   ```

5. Create and seed the SQLite database:
   ```bash
   npm run seed
   ```

6. Start the development server:
   ```bash
   npm start
   ```

7. Visit http://localhost:3001, sign in with the password you hashed in step 3, and access the application.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No (defaults to `3001`) | Port the server listens on. |
| `DB_PATH` | No (defaults to `./data/vellum.db`) | Path to the SQLite database file. Created automatically on first run. |
| `SESSION_SECRET` | Yes, in production | Random secret used to sign session cookies. Generate with `openssl rand -hex 32`. |
| `AUTH_PASSWORD_HASH` | Yes | Bcrypt hash of your login password — never the plaintext. Generate with `npm run hash-password -- "your chosen password"`. Login is impossible until this is set. |
| `ENCRYPTION_KEY` | Yes, to use AI provider settings | Encrypts/decrypts AI provider API keys stored in the database. Generate with `openssl rand -base64 32`. Never change this once providers have been saved — their keys become permanently unreadable. |
| `NODE_ENV` | No (leave unset for local dev) | Set to `production` in deployments so Express disables dev-mode error pages (which would otherwise leak stack traces) and enables view caching. Set via the systemd unit's `Environment=` or the container's environment, not `.env`, in production. |

Docker and the Proxmox LXC install script accept a plaintext `AUTH_PASSWORD` instead of a pre-hashed value, and generate `SESSION_SECRET`/`ENCRYPTION_KEY` automatically on first boot — see [docs/DOCKER.md](docs/DOCKER.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Choosing a Setup

| | Development / trying it out | Production |
|---|---|---|
| **Native (no container)** | `npm start` after `cp .env.example .env` and filling in `AUTH_PASSWORD_HASH`/`SESSION_SECRET`/`ENCRYPTION_KEY` by hand (see [Development Setup](#development-setup) above) — fastest inner loop; `npm run dev` live-reloads on changes. | Not recommended standalone — use Docker or LXC below so the process is supervised (Docker's restart policy or systemd) and comes back up after a crash or reboot on its own. |
| **Docker** | `docker compose up -d --build` with a throwaway `AUTH_PASSWORD` in `.env` or your shell. `SESSION_SECRET`/`ENCRYPTION_KEY` auto-generate — no manual secret handling. Binds to `127.0.0.1` only by default, so it's not reachable from anywhere else on your network. | Same command, but treat `AUTH_PASSWORD` as a real credential (see the `.env` `$`-escaping warning in [docs/DOCKER.md](docs/DOCKER.md)), back up the named volume regularly — it holds both the database and the generated secrets, so a database-only backup can't recover it (see [docs/DOCKER.md § Backups](docs/DOCKER.md#backups)) — and deliberately open it up if you need it reachable beyond localhost rather than relying on the default (see [docs/DOCKER.md § Exposing beyond localhost](docs/DOCKER.md#exposing-beyond-localhost)). |
| **Proxmox LXC** | `deploy/install-lxc.sh` — one command, sensible fixed defaults (VMID, storage pool, network bridge — all overridable via env vars, see the script's header). Good for trying Vellum out or a low-stakes personal instance. It still generates real secrets and gates login; it just skips customizing those defaults and doesn't set up the backup cron job for you. | Follow the full manual walkthrough in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) instead of the script — same end state, but you choose VMID/storage/network settings deliberately, verify each step as you go, and the walkthrough carries you through the Tailscale login and backup cron setup explicitly rather than leaving them as post-install reminders. |

## Architecture

- Express.js backend with EJS templating, server-rendered views, and a mostly vanilla JS frontend — the real-time collaborative editor's client code is the one exception, bundled via `esbuild` (`npm run build:client`)
- SQLite database for persistence (via `better-sqlite3`), with session-based single-password auth gating every route
- Schema managed by a numbered migrations runner (`src/db/migrations/`) that applies pending migrations incrementally on every startup — see [Updating](#updating)
- Markdown editor with live preview, save/load, and `.md` export
- A user profile (display name and avatar), editable from the Settings page, used to identify you in the writing view
- AI provider settings: store and manage encrypted API keys for any OpenAI-compatible backend (agents, cloud subscriptions, self-hosted models). Each provider can be toggled active-in-workspace to appear as a presence avatar in the writing view and to be selectable in the chat panel.
- Writing view shows real presence — your profile and any active-in-workspace providers as avatars, plus live highlighting of the line your cursor is on (tracks logical lines; very long wrapped lines may highlight imprecisely) — alongside a collapsible chat panel that sends real streamed completions from your selected active provider (a dropdown when more than one is active) and persists each file's conversation history. Each chat request makes an outbound network call to that third-party provider and includes the full current file content as context — worth knowing given this README's self-hosted/Tailscale-only privacy framing elsewhere.
- Real-time collaborative editing: the writing view uses a CodeMirror-based editor synced live over WebSocket (Yjs CRDT), so multiple writers can edit the same file at once with automatic, conflict-free merging and visible live cursors.
- Ships as a single Docker container or a one-command Proxmox LXC install, in addition to running directly with `npm start`

## Deployment

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Proxmox LXC setup (container creation, Tailscale, systemd service, backups, upgrades), or run `deploy/install-lxc.sh` to automate steps 1–8 of that walkthrough (Tailscale login and the backup cron job are still separate manual steps after it finishes).
- [docs/DOCKER.md](docs/DOCKER.md) — run Vellum in a single Docker container.

## Updating

Every deployment path is safe to update in place — schema changes apply automatically and incrementally on startup (see `src/db/migrations/`), and never wipe existing projects, files, provider credentials, or settings.

- **Native**: `npm run update` (`git pull && npm ci && npm run build:client && npm prune --omit=dev && npm run migrate`), then restart the server.
- **Docker**: `git pull && docker compose up -d --build` — migrations run automatically when the container starts. See [docs/DOCKER.md](docs/DOCKER.md).
- **Proxmox LXC**: see [docs/DEPLOYMENT.md § Upgrading](docs/DEPLOYMENT.md#11-upgrading).

## Status

Local Private Workspace (M1) is complete and hardened beyond its original scope: real SQLite persistence via a numbered migrations runner (not in-memory, not a hand-run static schema), session-based password authentication, a user profile, and encrypted AI provider credential storage — with providers individually toggleable as active-in-workspace — all deployable as a single Docker container or Proxmox LXC. See [TODOS.md](TODOS.md) for the full milestone-by-milestone breakdown.

Chat bound to a project/file (M2) is now real: the chat panel streams completions from your selected active provider and persists conversation history per file. Real multi-user live collaboration (M6) is now real too: the writing view's editor is synced live over a session-gated WebSocket via a Yjs CRDT, so multiple writers can have the same file open at once, edit concurrently with automatic conflict-free merging, and see each other's live cursors. Not yet built: agent-proposed edits (M3), full agent live-presence states such as reading/reviewing/proposing (M3.5), history/named versions (M4), git materialization (M5), and a browser-control escape hatch (M7). The writing view's presence stack (your profile plus any providers marked active-in-workspace) and its cursor-line highlighting reflect real data and your real cursor position today (tracking logical lines; very long wrapped lines may highlight imprecisely) — they're no longer the hardcoded mock collaborators of earlier milestones.

## License

MIT