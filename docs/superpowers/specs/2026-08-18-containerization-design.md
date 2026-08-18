# Containerization — Design

## Purpose

Vellum currently deploys via a manual, multi-step Proxmox LXC walkthrough (`docs/DEPLOYMENT.md`): create the container, install Node, clone the repo, hand-generate three secrets (`SESSION_SECRET`, `AUTH_PASSWORD_HASH`, `ENCRYPTION_KEY`), install a systemd unit, and start it. This design adds two single-command deployment paths on top of that existing foundation — a Docker image for general self-hosting, and a one-shot provisioning script for Proxmox — so the app can be started with one command in either environment, with zero manual secret-generation steps.

## Scope

- A Docker image, `docker-compose.yml`, and an entrypoint script that bootstraps all required secrets on first boot and starts the app.
- A Proxmox LXC provisioning script (`deploy/install-lxc.sh`) that automates the existing `docs/DEPLOYMENT.md` steps into one command, using the same bootstrap philosophy as the Docker path.
- New documentation (`docs/DOCKER.md`) and a "Quick Start" pointer added to the top of the existing `docs/DEPLOYMENT.md`.

**Explicitly out of scope:**
- Any change to application code (`src/**`). Nothing here touches `server.js`, `config.js`, or any existing route/repo/view.
- Rewriting or restructuring the existing `docs/DEPLOYMENT.md` manual walkthrough — it stays as the detailed reference path, unchanged, for operators who want to understand or customize each step.
- Publishing/hosting a prebuilt image to a registry, or a prebuilt downloadable Proxmox LXC template — both are separate infrastructure/pipeline projects, not covered here.
- Auto-seeding sample data on the new one-shot paths (see "First-boot behavior" below) — a deliberate change from how the existing manual LXC walkthrough seeds by default.

## Why no application code changes

Everything described below — turning a plaintext password into a hash, generating and persisting `SESSION_SECRET`/`ENCRYPTION_KEY` — happens entirely in shell scripts that run *before* `node src/server.js` starts. `server.js`/`config.js` continue to read exactly the same three environment variables they read today (`AUTH_PASSWORD_HASH`, `SESSION_SECRET`, `ENCRYPTION_KEY`) and have no awareness that anything upstream generated or transformed them. This keeps the already-reviewed, tested application code completely untouched and means this plan needs no new `node:test` coverage — the deliverables are shell scripts, a Dockerfile, and docs, verified by actually running them, not by unit tests.

## Bootstrap logic (shared by both paths)

Both `deploy/docker-entrypoint.sh` (Docker) and `deploy/install-lxc.sh` (Proxmox) implement the same three-step bootstrap before starting the app:

1. **Password:** if `AUTH_PASSWORD_HASH` is unset but `AUTH_PASSWORD` is set, run the existing `node src/scripts/hash-password.js "$AUTH_PASSWORD"` and export the result as `AUTH_PASSWORD_HASH` for this run. This happens fresh on every boot (bcrypt hashing is fast enough that re-hashing once per container start is free), so nothing needs to be persisted for this one — `AUTH_PASSWORD` itself, supplied by the operator in `docker-compose.yml` or the LXC env file, is the durable source of truth across restarts.
2. **Secrets:** if a secrets file inside the persistent data directory (alongside the SQLite DB — `$DATA_DIR/.secrets.env`) doesn't exist, generate `SESSION_SECRET` and `ENCRYPTION_KEY` (`openssl rand -base64 32` for each, matching the existing manual-generation convention in `docs/DEPLOYMENT.md`) and write them to that file. On every boot, source the file and export both values. Because this file lives in the same persistent volume/directory as the database, it survives container recreation, and — critically — `ENCRYPTION_KEY` never silently changes out from under already-encrypted provider API keys.
3. **Migration:** unchanged — `server.js` already runs `migrate(db)` unconditionally and idempotently on every boot. No script-level action needed.

Neither script runs the seed script. A fresh container/LXC starts with an empty projects list; the existing "+ New project" UI is how an operator creates their first project. The existing manual `docs/DEPLOYMENT.md` walkthrough is unaffected by this decision — it keeps its own seed step exactly as documented today, since that's a different, already-reviewed path that operators follow deliberately and can already skip that step themselves if they don't want sample data.

## File layout

```
Dockerfile                    # new, repo root
.dockerignore                 # new, repo root
docker-compose.yml            # new, repo root
deploy/
  docker-entrypoint.sh        # new
  install-lxc.sh              # new
  vellum.service               # existing, unchanged — install-lxc.sh installs it
  backup.sh                    # existing, unchanged
docs/
  DOCKER.md                    # new
  DEPLOYMENT.md                # existing — only a short "Quick Start" pointer added at the top
```

## Docker

- **Base image:** `node:22-bookworm-slim`. Node 22 matches the LXC path's already-established choice (from the SQLite/deployment plan's final review, which found `better-sqlite3@12.11.1` has no Node-20 prebuilt binary but does have one for Node 22). `bookworm-slim` is glibc-based (Debian), not musl/Alpine — avoiding any risk that `better-sqlite3`'s prebuilt binary doesn't have a musl variant, which would force a source compile.
- **Build:** single-stage (`npm ci --omit=dev`, copy source, no compile/bundle step exists in this app, so multi-stage buys nothing here).
- **User:** runs as a non-root user inside the container, matching the LXC path's `vellum` system-user convention.
- **Volume:** one named volume mounted at `/app/data`, holding both the SQLite DB (`DB_PATH=/app/data/vellum.db`) and the generated secrets file (`/app/data/.secrets.env`).
- **Entrypoint:** `deploy/docker-entrypoint.sh` runs the shared bootstrap logic, then `exec node src/server.js`.
- **docker-compose.yml:** one service, the named volume, a port mapping (`3001:3001` by default, `PORT` overridable), `AUTH_PASSWORD` as the one required operator-supplied variable, `NODE_ENV=production` set by default.

## Proxmox LXC

`deploy/install-lxc.sh`, run once on the Proxmox host (`bash -c "$(wget -qLO- .../install-lxc.sh)"`, matching the standard Proxmox-community helper-script convention), automates:

1. `pct create` (unprivileged Debian 12, per `docs/DEPLOYMENT.md` §1)
2. Base packages + NodeSource Node 22.x (§2, updated from 20.x per the same prebuilt-binary finding referenced above)
3. Tailscale (§3)
4. Service user + directories (§4)
5. Clone + `npm ci --omit=dev` (§5)
6. The shared bootstrap logic (password hash, secrets generation) instead of §6/§7's manual secret-generation steps — prompts for `AUTH_PASSWORD` interactively if not passed as an argument/env var
7. Install `deploy/vellum.service` + start (§8)

`docs/DEPLOYMENT.md` itself is not rewritten — it gains a short "Quick Start" section at the top pointing to this script as the fast path, with the existing full walkthrough kept below as the reference/manual/customization path.

## Documentation

- **`docs/DOCKER.md`** (new): mirrors `docs/DEPLOYMENT.md`'s structure for the Docker path — prerequisites, `docker-compose.yml` walkthrough, first-run behavior, backups (volume-level, referencing the same `ENCRYPTION_KEY`-must-be-backed-up-with-the-data lesson already documented in `docs/DEPLOYMENT.md`'s Backups section), upgrading (`docker compose pull && up -d`).
- **`docs/DEPLOYMENT.md`**: one new "Quick Start" section at the top linking to `deploy/install-lxc.sh`; no other changes.
- **`README.md`**: the existing "Deployment" section (currently a single line pointing at `docs/DEPLOYMENT.md`) gains a second line pointing at `docs/DOCKER.md`.

## Verification

This sandbox has a running Docker daemon but no Proxmox host, so verification is asymmetric:

- **Docker path:** fully verifiable here. Build the image, `docker compose up`, and run a real smoke test — hit `/login` unauthenticated (expect redirect), confirm `AUTH_PASSWORD` bootstraps a working login on first boot, create a project via the real API, restart the container, confirm the project persisted on the same volume and that `SESSION_SECRET`/`ENCRYPTION_KEY` were reused (not regenerated — check the secrets file's contents/mtime are unchanged across the restart) rather than rotated.
- **LXC path:** `deploy/install-lxc.sh` can only be checked statically here (`bash -n` for syntax, careful manual review against the existing, already-verified `docs/DEPLOYMENT.md` steps it automates) — there's no Proxmox host in this sandbox to actually run it against. This is called out explicitly as a follow-up manual verification step for whoever has Proxmox access.
