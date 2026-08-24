# vellum

[![Vellum repository](https://img.shields.io/badge/repository-vellum-2F6F64?logo=github)](https://github.com/commrelayunit/vellum)
[![Vellum Bridge repository](https://img.shields.io/badge/OpenClaw-vellum--bridge-1F2937?logo=github)](https://github.com/commrelayunit/vellum-bridge)

Vellum is a private, self-hostable writing workspace for humans and agents.

## Docs

- [Current implementation status and remaining work](TODOS.md)
- [Docker deployment](docs/DOCKER.md)
- [Proxmox LXC deployment](docs/DEPLOYMENT.md)

## Connecting agents

The companion [Vellum Bridge](https://github.com/commrelayunit/vellum-bridge)
is the OpenClaw plugin that provides live document editing for Vellum sessions.

Vellum uses an OpenAI-compatible chat client. For an OpenClaw-backed agent that
can apply live document edits, configure the agent or model profile with the
Vellum Bridge base URL:

```
<OPENCLAW_BASE_URL>/vellum/v1
```

Use the OpenClaw model identifier exposed by that gateway (for the bundled
bridge, `openclaw/default`). The client continues to use the ordinary OpenAI
chat-completions API; it does not need a Vellum-specific header, tool loop, or
session mode.

On the OpenClaw side, install and enable the `vellum-bridge` plugin. The bridge
owns the live document connection and exposes `edit_document` only for requests
received through the `/vellum/v1/chat/completions` route. This keeps document
editing scoped to Vellum while preventing an unrelated OpenClaw session from
claiming a live document. Start a new Vellum chat after changing a model's base
URL so that its session is opened through the bridge.

### Contributing agent integrations

Agent integrations are deliberately open to contributions and pull requests.
Hermes, OpenClaw, and other agent providers should use the same documented
OpenAI-compatible contract, with provider-specific bridges kept small and
reviewable. Please open an issue or pull request for a new provider, a safer
editing flow, or an improvement to the integration documentation.

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

6. Build the editor client bundle (**required** — the collaborative editor is the one part of the frontend that is bundled rather than served as plain browser JS, and `src/public/js/editor-bundle.js` is generated, not committed. Skip this and the writing view loads with an empty editor pane and a 404 for `/js/editor-bundle.js` in the browser console):
   ```bash
   npm run build:client
   ```

7. Start the development server:
   ```bash
   npm start
   ```

8. Visit http://localhost:3001, sign in with the password you hashed in step 3, and access the application.

`npm run dev` builds the bundle for you before starting nodemon (via its `predev` script), so step 6 is only strictly needed for the plain `npm start` path — `start` deliberately has no such hook, because production installs run it after `npm prune --omit=dev`, where `esbuild` is no longer present.

If you're actively changing files under `src/client/`, run `npm run dev:client` in a second terminal alongside `npm run dev` — it's the same esbuild command in `--watch` mode, so the bundle rebuilds on every save. Nodemon itself only restarts the Node server; it does not rebuild the client bundle as you edit. Re-run `npm run build:client` after any `git pull` that touches `src/client/` too (`npm run update` already does this for you — see [Updating](#updating)).

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
| **Native (no container)** | `npm run build:client && npm start` after `cp .env.example .env` and filling in `AUTH_PASSWORD_HASH`/`SESSION_SECRET`/`ENCRYPTION_KEY` by hand (see [Development Setup](#development-setup) above) — fastest inner loop; `npm run dev` live-reloads server changes, with `npm run dev:client` alongside it for client ones. | Not recommended standalone — use Docker or LXC below so the process is supervised (Docker's restart policy or systemd) and comes back up after a crash or reboot on its own. |
| **Docker** | `docker compose up -d --build` with a throwaway `AUTH_PASSWORD` in `.env` or your shell. `SESSION_SECRET`/`ENCRYPTION_KEY` auto-generate — no manual secret handling. Binds to `127.0.0.1` only by default, so it's not reachable from anywhere else on your network. | Same command, but treat `AUTH_PASSWORD` as a real credential (see the `.env` `$`-escaping warning in [docs/DOCKER.md](docs/DOCKER.md)), back up the named volume regularly — it holds both the database and the generated secrets, so a database-only backup can't recover it (see [docs/DOCKER.md § Backups](docs/DOCKER.md#backups)) — and deliberately open it up if you need it reachable beyond localhost rather than relying on the default (see [docs/DOCKER.md § Exposing beyond localhost](docs/DOCKER.md#exposing-beyond-localhost)). |
| **Proxmox LXC** | `deploy/install-lxc.sh` — one command, sensible fixed defaults (VMID, storage pool, network bridge — all overridable via env vars, see the script's header). Good for trying Vellum out or a low-stakes personal instance. It still generates real secrets and gates login; it just skips customizing those defaults and doesn't set up the backup cron job for you. | Follow the full manual walkthrough in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) instead of the script — same end state, but you choose VMID/storage/network settings deliberately, verify each step as you go, and the walkthrough carries you through the Tailscale login and backup cron setup explicitly rather than leaving them as post-install reminders. |

## Agent Editing: Provider Compatibility

Agent document editing (above) works by sending a standard OpenAI-style `tools` array (one function, `edit_document`) with every chat request, and expecting the model's streamed reply to include a matching `tool_calls` entry in OpenAI's usual incremental format. Vellum sends this unconditionally to every active provider — it has no way to know in advance whether a given backend actually honors it.

**Works out of the box:** a plain OpenAI-compatible completions endpoint — vLLM, llama.cpp server, Ollama's OpenAI-compat endpoint, LM Studio, a hosted API — since these pass the `tools` array straight through to the model's native function-calling support.

**May silently fail:** a heavier *agent framework or bridge* sitting in front of a model (e.g. Telegram/webchat bot frameworks, orchestration layers with their own fixed toolset) rather than a bare completions server. These often don't forward caller-supplied `tools` definitions to the underlying model at all — they only expose whatever tools they themselves registered. The model still sees Vellum's system-prompt text saying it *can* call `edit_document`, so it may reply as though it made the change (sometimes describing edits in detail, or falling back to some unrelated local action) while the actual document in Vellum never updates.

**How to tell:** ask it to make an edit. If the chat reply describes an edit but the document doesn't change — no typing animation, no tool-status line in the chat panel, no diff — the provider isn't forwarding tool calls. Check that backend's own request/response logs: if the incoming request's `tools` field isn't present in what it hands to the model, or its own "tool discovery" doesn't list `edit_document`, that confirms it.

**How to fix it:** depends on what's actually in front of the model.

- *A bare completions server behind your bridge* — the fix is forward-only passthrough: have the bridge forward `tools`, the assistant's `tool_calls`, and the follow-up `role: "tool"` result messages straight through to `/v1/chat/completions`, without executing anything itself. This must hold at the *streaming* level, not just for a buffered JSON response — Vellum accumulates `delta.tool_calls[].index` across chunks, so the proxy must stay byte-transparent to the SSE stream rather than re-chunking it. Requires zero changes on Vellum's side; this is what already works with a plain OpenAI-compatible endpoint.
- *A full agent runtime behind your bridge* (its own thread lifecycle and fixed tool inventory, e.g. an OpenAI Codex-style app-server) — passthrough usually isn't enough, since the runtime doesn't take arbitrary caller-supplied tool definitions. This needs real translation: register `edit_document` as a temporary dynamic tool for that thread, and when the model calls it, **reply with a normal streamed `tool_calls` delta on the *same still-open* `/v1/chat/completions` connection Vellum is reading from** — not a separate callback into some new Vellum API. Vellum's tool execution (`agentSession.applyEdit()`) is scoped to that one open chat request: it drives the streamed character-by-character insert, the live cursor broadcast, and the tool-status SSE frames all against that specific connection, and there is no standalone "apply this edit" endpoint decoupled from it. A bridge that tries to call back out-of-band has nothing correct to call.
- If the bridge only supports a fixed, hardcoded toolset with no passthrough or dynamic-tool mechanism at all, it isn't currently compatible with this feature — plain chat (no editing) still works through it.

## Deployment

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Proxmox LXC setup (container creation, Tailscale, systemd service, backups, upgrades), or run `deploy/install-lxc.sh` to automate steps 1–8 of that walkthrough (Tailscale login and the backup cron job are still separate manual steps after it finishes).
- [docs/DOCKER.md](docs/DOCKER.md) — run Vellum in a single Docker container.

## Updating

Every deployment path is safe to update in place — schema changes apply automatically and incrementally on startup (see `src/db/migrations/`), and never wipe existing projects, files, provider credentials, or settings.

- **Native**: `npm run update` (`git pull && npm ci && npm run build:client && npm prune --omit=dev && npm run migrate`), then restart the server.
- **Docker**: `git pull && docker compose up -d --build` — migrations run automatically when the container starts. See [docs/DOCKER.md](docs/DOCKER.md).
- **Proxmox LXC**: see [docs/DEPLOYMENT.md § Upgrading](docs/DEPLOYMENT.md#11-upgrading).

## License

MIT
