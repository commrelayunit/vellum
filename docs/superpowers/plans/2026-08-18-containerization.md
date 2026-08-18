# Containerization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Vellum runnable with one command in two environments — a Docker container for general self-hosting, and a one-shot provisioning script for Proxmox — with zero manual secret-generation steps in either path.

**Architecture:** No application code changes. A shared bootstrap pattern (hash a plaintext password into `AUTH_PASSWORD_HASH`; generate `SESSION_SECRET`/`ENCRYPTION_KEY` once and persist them next to the database) is implemented twice, once as a Docker entrypoint script and once inside the Proxmox provisioning script, both calling the existing `src/scripts/hash-password.js` and reading/writing nothing but environment variables and files — `server.js`/`config.js` are untouched and never know the difference.

**Tech Stack:** Docker (`node:22-bookworm-slim` base image, matching the Node version already established for the LXC path), Docker Compose, bash (both new scripts), Node's built-in `crypto` module for secret generation (no `openssl` CLI dependency — verified not present in the base image).

**Spec:** `docs/superpowers/specs/2026-08-18-containerization-design.md`

## Global Constraints

- No changes to any file under `src/` — `server.js`/`config.js` continue to read only `AUTH_PASSWORD_HASH`, `SESSION_SECRET`, `ENCRYPTION_KEY`, exactly as today.
- No new npm dependency.
- Base image must be glibc-based (not Alpine/musl) — `better-sqlite3`'s prebuilt binary is glibc-linked; this was verified directly against `node:22-bookworm-slim` (see Task 1).
- Fresh containers/LXC installs from the new one-shot paths start with an empty project list — no auto-seeding. The existing manual `docs/DEPLOYMENT.md` walkthrough is unaffected by this and keeps its own seed step as-is.
- `docs/DEPLOYMENT.md`'s existing manual walkthrough is not rewritten — only a short "Quick Start" pointer is added at the top.
- `ENCRYPTION_KEY` must never be regenerated once created — doing so would permanently orphan any already-encrypted provider API keys (this exact failure mode was found and fixed defensively in the AI-provider-settings plan; this plan avoids triggering it in the first place by persisting the secret to the same volume as the database).

---

### Task 1: Docker image

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `deploy/docker-entrypoint.sh`

**Interfaces:**
- Produces: a buildable image (`docker build .`) whose `ENTRYPOINT` is `deploy/docker-entrypoint.sh`, which bootstraps `AUTH_PASSWORD_HASH` (from `AUTH_PASSWORD` if the hash isn't already set) and `SESSION_SECRET`/`ENCRYPTION_KEY` (generated once, persisted to `$(dirname "$DB_PATH")/.secrets.env`, reused on every subsequent boot), then `exec node src/server.js`.
- Consumes: `src/scripts/hash-password.js`'s existing `hashPassword` CLI entry point (unchanged, called as a subprocess — not imported).

Two facts below were verified directly against a running Docker daemon before writing this task, not assumed:
- `better-sqlite3@12.11.1`'s prebuilt binary installs and loads correctly on `node:22-bookworm-slim` with `npm ci --omit=dev` — no `node-gyp` source compile is triggered, so no `build-essential`/`python3` are needed in the image (unlike the LXC path, which keeps them as a fallback per `docs/DEPLOYMENT.md` — the difference is that the Docker base image and Debian version are pinned exactly, since we control the image build, versus the LXC path installing packages fresh onto a template that could shift).
- `openssl` (the CLI binary) is **not** present in `node:22-bookworm-slim`. The entrypoint script uses `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` instead of `openssl rand -base64 32` for secret generation — verified to produce a valid base64 32-byte string.

- [ ] **Step 1: Write `.dockerignore`**

```
.git
.worktrees
node_modules
data
.env
*.log
npm-debug.log
docs/superpowers
```

- [ ] **Step 2: Write `deploy/docker-entrypoint.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="$(dirname "$DB_PATH")"
SECRETS_FILE="$DATA_DIR/.secrets.env"

mkdir -p "$DATA_DIR"

if [ ! -f "$SECRETS_FILE" ]; then
  {
    echo "SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
    echo "ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
  } > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
fi

set -a
# shellcheck disable=SC1090
source "$SECRETS_FILE"
set +a

if [ -z "${AUTH_PASSWORD_HASH:-}" ] && [ -n "${AUTH_PASSWORD:-}" ]; then
  export AUTH_PASSWORD_HASH="$(node src/scripts/hash-password.js "$AUTH_PASSWORD")"
fi

exec node src/server.js
```

Make it executable:

```bash
chmod +x deploy/docker-entrypoint.sh
```

- [ ] **Step 3: Write the `Dockerfile`**

```dockerfile
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

RUN useradd --system --create-home --shell /usr/sbin/nologin vellum \
    && mkdir -p /app/data \
    && chown -R vellum:vellum /app \
    && chmod +x deploy/docker-entrypoint.sh

USER vellum

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/app/data/vellum.db

EXPOSE 3001

ENTRYPOINT ["./deploy/docker-entrypoint.sh"]
```

- [ ] **Step 4: Build the image and verify no source compile was triggered**

Run: `docker build -t vellum:test .`

Expected: build succeeds; the `RUN npm ci --omit=dev` layer's output shows `added N packages` with no `node-gyp`/`gcc`/`make` compiler invocations in the log (a source-compile fallback would print those).

- [ ] **Step 5: Verify `better-sqlite3` actually loads inside the built image**

Run: `docker run --rm vellum:test node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); db.exec('CREATE TABLE t (x INTEGER)'); db.prepare('INSERT INTO t VALUES (42)').run(); console.log(JSON.stringify(db.prepare('SELECT * FROM t').get()));"`

Expected: prints `{"x":42}`.

- [ ] **Step 6: Verify the entrypoint bootstraps correctly against a throwaway container (no compose yet)**

```bash
docker run --rm -e AUTH_PASSWORD=smoketest -p 13001:3001 --name vellum-task1-check -d vellum:test
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:13001/login
docker logs vellum-task1-check
docker stop vellum-task1-check
```

Expected: curl prints `200`; the logs show `Vellum server running on http://localhost:3001` with no errors about missing `ENCRYPTION_KEY`/`SESSION_SECRET`/`AUTH_PASSWORD_HASH` (this container has no volume yet, so the secrets file is generated and discarded with the container — that's expected and fine for this isolated check; Task 2 verifies persistence across restarts with a real volume).

- [ ] **Step 7: Clean up the test image**

```bash
docker rmi vellum:test
```

- [ ] **Step 8: Commit**

```bash
git add Dockerfile .dockerignore deploy/docker-entrypoint.sh
git commit -m "feat: add Docker image with self-bootstrapping secrets"
```

---

### Task 2: docker-compose.yml and full persistence smoke test

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: the image built in Task 1.
- Produces: a `vellum` service with a named volume (`vellum-data`) mounted at `/app/data`, requiring `AUTH_PASSWORD` to be set (fails fast with a clear message if it isn't).

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  vellum:
    build: .
    ports:
      - "${PORT:-3001}:3001"
    environment:
      AUTH_PASSWORD: "${AUTH_PASSWORD:?Set AUTH_PASSWORD in your environment or a .env file}"
    volumes:
      - vellum-data:/app/data
    restart: unless-stopped

volumes:
  vellum-data:
```

- [ ] **Step 2: Bring the stack up and verify first-boot bootstrap**

```bash
AUTH_PASSWORD=composetest docker compose up -d --build
sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/login
```

Expected: `200`.

- [ ] **Step 3: Verify the secrets file was created inside the volume**

```bash
docker compose exec vellum cat /app/data/.secrets.env
```

Expected: two lines, `SESSION_SECRET=...` and `ENCRYPTION_KEY=...`, each a non-empty base64 string.

- [ ] **Step 4: Verify unauthenticated access still redirects**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/projects
```

Expected: `302` (matches the app's existing `requireAuth` behavior — this is unchanged application code, just confirming the container doesn't somehow bypass it).

- [ ] **Step 5: Log in and create a project through the real API**

```bash
curl -s -c /tmp/vellum-docker-cookies.txt -X POST http://localhost:3001/login \
  -H 'Content-Type: application/x-www-form-urlencoded' -d 'password=composetest' \
  -o /dev/null -w "%{http_code}\n"
curl -s -b /tmp/vellum-docker-cookies.txt -X POST http://localhost:3001/api/projects \
  -H 'Content-Type: application/json' -d '{"name":"Docker Smoke Test"}' \
  -w "\n%{http_code}\n"
```

Expected: login `302`; create response `201` with `{"success":true,"project":{"name":"Docker Smoke Test",...},...}`.

- [ ] **Step 6: Record the secrets file's contents, then restart the container**

```bash
docker compose exec vellum cat /app/data/.secrets.env > /tmp/vellum-secrets-before.txt
docker compose restart vellum
sleep 1
docker compose exec vellum cat /app/data/.secrets.env > /tmp/vellum-secrets-after.txt
diff /tmp/vellum-secrets-before.txt /tmp/vellum-secrets-after.txt
```

Expected: `diff` prints nothing (files identical) — proves the secrets are reused, not regenerated, across a restart. This is the property that matters most: regenerating `ENCRYPTION_KEY` on every boot would orphan every previously-saved provider API key.

- [ ] **Step 7: Verify the project persisted across the restart**

```bash
curl -s -c /tmp/vellum-docker-cookies.txt -X POST http://localhost:3001/login \
  -H 'Content-Type: application/x-www-form-urlencoded' -d 'password=composetest' \
  -o /dev/null -w "%{http_code}\n"
curl -s -b /tmp/vellum-docker-cookies.txt http://localhost:3001/projects | grep -o "Docker Smoke Test"
```

Expected: login `302`; grep finds `Docker Smoke Test` — the SQLite volume survived the restart, and the login still works with the same password (proving `AUTH_PASSWORD` re-hashing on every boot is stable/idempotent from the operator's point of view).

- [ ] **Step 8: Clean up**

```bash
docker compose down -v
rm -f /tmp/vellum-docker-cookies.txt /tmp/vellum-secrets-before.txt /tmp/vellum-secrets-after.txt
```

Expected: `docker compose down -v` removes the container and the named volume (this is a throwaway smoke-test volume, safe to discard — a real deployment would never run `-v` on an upgrade).

- [ ] **Step 9: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add docker-compose.yml with persistent volume for data and secrets"
```

---

### Task 3: Proxmox LXC one-shot provisioning script

**Files:**
- Create: `deploy/install-lxc.sh`

**Interfaces:**
- Consumes: `deploy/vellum.service` (existing, unchanged — this script installs it), the same `src/scripts/hash-password.js` CLI entry point Task 1's entrypoint uses.
- Produces: no new interface — this is a standalone operator-facing script, not consumed by any other file in this plan.

This script cannot be executed against a real Proxmox host from this environment (no Proxmox host available here). Verification for this task is therefore: `bash -n` syntax validation (catches parse errors) plus careful manual read-through against `docs/DEPLOYMENT.md`'s already-verified manual steps, which this script automates one-for-one except for the bootstrap-secrets portion (steps 6/7 in the manual doc), which this script replaces with the shared bootstrap pattern from Task 1, and the seed step (step 7 in the manual doc), which this script deliberately skips per the Global Constraints.

A note on password handling: this script avoids reconstructing the operator's raw password inside nested shell strings (which would break on passwords containing `$` or `'` characters, and is exactly the kind of bug already found once this session in ad-hoc manual verification of the AI-provider-settings work — bash expands `$`-sequences inside double-quoted strings and heredocs unless they're single-quoted or otherwise protected). Instead it writes the password to a temporary file, copies that file into the container with `pct push` (a byte-for-byte copy, no shell interpretation), and has the *in-container* shell read it back with `$(cat ...)` inside a single-quoted `su -c` argument — meaning only one shell ever interprets the password's actual bytes, and it does so safely regardless of what characters the password contains.

- [ ] **Step 1: Write `deploy/install-lxc.sh`**

```bash
#!/usr/bin/env bash
# deploy/install-lxc.sh
# One-shot Proxmox LXC provisioning for Vellum. Run from the Proxmox host shell:
#   REPO_URL=<your-repo-url> bash install-lxc.sh [AUTH_PASSWORD]
# If AUTH_PASSWORD isn't passed as an argument, you'll be prompted for it.
# See docs/DEPLOYMENT.md for the full manual walkthrough this script automates,
# and for details on each step if you want to customize anything (VMID,
# storage, network bridge, etc. can all be overridden via env vars below).
set -euo pipefail

VMID="${VMID:-100}"
CT_HOSTNAME="${CT_HOSTNAME:-vellum}"
STORAGE="${STORAGE:-local-lvm}"
BRIDGE="${BRIDGE:-vmbr0}"
TEMPLATE="${TEMPLATE:-debian-12-standard_12.7-1_amd64.tar.zst}"
REPO_URL="${REPO_URL:?Set REPO_URL to your Vellum git repository URL}"

AUTH_PASSWORD="${1:-}"
if [ -z "$AUTH_PASSWORD" ]; then
  read -r -s -p "Choose a login password for Vellum: " AUTH_PASSWORD
  echo
fi
if [ -z "$AUTH_PASSWORD" ]; then
  echo "A password is required." >&2
  exit 1
fi

echo "==> Downloading LXC template"
pveam update
pveam download local "$TEMPLATE"

echo "==> Creating container $VMID ($CT_HOSTNAME)"
pct create "$VMID" "local:vztmpl/$TEMPLATE" \
  --hostname "$CT_HOSTNAME" \
  --unprivileged 1 \
  --cores 1 \
  --memory 512 \
  --swap 512 \
  --rootfs "$STORAGE:8" \
  --net0 "name=eth0,bridge=$BRIDGE,ip=dhcp" \
  --features nesting=0

pct start "$VMID"
sleep 5

echo "==> Installing base packages and Node 22"
pct exec "$VMID" -- bash -c '
  apt update && apt upgrade -y
  apt install -y curl git sqlite3
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt install -y nodejs
'

echo "==> Installing Tailscale (run \"pct exec $VMID -- tailscale up\" afterwards to authenticate)"
pct exec "$VMID" -- bash -c 'curl -fsSL https://tailscale.com/install.sh | sh'

echo "==> Creating service user and directories"
pct exec "$VMID" -- bash -c '
  useradd --system --home /opt/vellum --shell /usr/sbin/nologin vellum
  mkdir -p /opt/vellum /var/lib/vellum/data /etc/vellum
  chown -R vellum:vellum /opt/vellum /var/lib/vellum
'

echo "==> Deploying code from $REPO_URL"
pct exec "$VMID" -- su - vellum -s /bin/bash -c "git clone $REPO_URL /opt/vellum && cd /opt/vellum && npm ci --omit=dev"

echo "==> Bootstrapping secrets"
SESSION_SECRET="$(pct exec "$VMID" -- node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"
ENCRYPTION_KEY="$(pct exec "$VMID" -- node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")"

PW_FILE="$(mktemp)"
printf '%s' "$AUTH_PASSWORD" > "$PW_FILE"
pct push "$VMID" "$PW_FILE" /tmp/vellum-pw
rm -f "$PW_FILE"
AUTH_PASSWORD_HASH="$(pct exec "$VMID" -- su - vellum -s /bin/bash -c 'cd /opt/vellum && node src/scripts/hash-password.js "$(cat /tmp/vellum-pw)"')"
pct exec "$VMID" -- rm -f /tmp/vellum-pw

ENV_FILE="$(mktemp)"
cat > "$ENV_FILE" <<EOF
PORT=3001
DB_PATH=/var/lib/vellum/data/vellum.db
SESSION_SECRET=$SESSION_SECRET
AUTH_PASSWORD_HASH=$AUTH_PASSWORD_HASH
ENCRYPTION_KEY=$ENCRYPTION_KEY
EOF
pct push "$VMID" "$ENV_FILE" /etc/vellum/vellum.env
rm -f "$ENV_FILE"
pct exec "$VMID" -- chown vellum:vellum /etc/vellum/vellum.env
pct exec "$VMID" -- chmod 600 /etc/vellum/vellum.env

echo "==> Installing and starting the systemd service"
pct exec "$VMID" -- cp /opt/vellum/deploy/vellum.service /etc/systemd/system/vellum.service
pct exec "$VMID" -- systemctl daemon-reload
pct exec "$VMID" -- systemctl enable --now vellum

echo "==> Done. Verify with: pct exec $VMID -- curl -I http://127.0.0.1:3001/login"
echo "    Then authenticate Tailscale: pct exec $VMID -- tailscale up"
```

Make it executable:

```bash
chmod +x deploy/install-lxc.sh
```

- [ ] **Step 2: Syntax-check the script**

Run: `bash -n deploy/install-lxc.sh`

Expected: no output, exit code 0.

- [ ] **Step 3: Manual cross-check against `docs/DEPLOYMENT.md`**

Read `docs/DEPLOYMENT.md` sections 1–8 side by side with this script and confirm every `pct create`/`apt install`/directory/chown/systemctl command has a corresponding line here, with the same flags and paths (`--unprivileged 1`, `--memory 512`, `/opt/vellum`, `/var/lib/vellum/data`, `/etc/vellum`, Node 22.x via NodeSource `setup_22.x`, the same `vellum.service` file). Confirm the two deliberate differences are intentional and correctly implemented: (a) the manual doc's step 6/7 secret-generation-and-paste-by-hand is replaced by this script's automated `SESSION_SECRET`/`ENCRYPTION_KEY`/`AUTH_PASSWORD_HASH` generation, and (b) `seed.js` is never called here (the manual doc's step 7 runs it; this script doesn't, per the Global Constraints).

- [ ] **Step 4: Commit**

```bash
git add deploy/install-lxc.sh
git commit -m "feat: add one-shot Proxmox LXC provisioning script"
```

---

### Task 4: Documentation

**Files:**
- Create: `docs/DOCKER.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `README.md`

**Interfaces:**
- No code interfaces — this task documents the artifacts from Tasks 1–3.

- [ ] **Step 1: Write `docs/DOCKER.md`**

```markdown
# Running Vellum with Docker

This runs Vellum in a single container, with SQLite data and secrets persisted in a named Docker volume.

## Prerequisites

- Docker and Docker Compose installed.

## 1. Configure

Set your login password as an environment variable, either in your shell or in a `.env` file next to `docker-compose.yml` (Docker Compose loads that file automatically for variable substitution — separate from the app's own `dotenv`-based `.env` handling, which only applies when running outside Docker):

```
AUTH_PASSWORD=your-chosen-password
```

That's the only value you need to provide. `SESSION_SECRET` and `ENCRYPTION_KEY` are generated automatically on first start and saved into the same persistent volume as the database, so they survive container restarts and upgrades without any action from you.

## 2. Start

```bash
docker compose up -d
```

On first start the container hashes `AUTH_PASSWORD`, generates the two secrets, creates the database, and starts the app — no other setup needed.

## 3. Verify

```bash
curl -I http://localhost:3001/login   # expect: HTTP/1.1 200 OK
docker compose logs vellum            # expect: "Vellum server running on http://localhost:3001"
```

Visit `http://localhost:3001` and sign in with your `AUTH_PASSWORD`.

## Changing the port

```bash
PORT=8080 docker compose up -d
```

## Backups

The named volume holds both the SQLite database and the generated secrets file (`.secrets.env`) — back up the whole volume together, not just the database, for the same reason described in [docs/DEPLOYMENT.md](DEPLOYMENT.md#10-backups): the database alone can't be decrypted without the matching `ENCRYPTION_KEY`. Find your volume's actual name with `docker volume ls` (Compose prefixes it with your project directory name, e.g. `vellum_vellum-data`), then:

```bash
docker run --rm -v <volume-name>:/data -v "$(pwd)":/backup debian:bookworm-slim \
  tar czf /backup/vellum-data-backup.tar.gz -C /data .
```

## Upgrading

```bash
git pull
docker compose up -d --build
```

The named volume is untouched by a rebuild, so your data and secrets persist across upgrades.
```

- [ ] **Step 2: Add a Quick Start section to `docs/DEPLOYMENT.md`**

Insert immediately after the existing title/intro line (`This runs Vellum as a systemd service inside an unprivileged Debian 12 LXC container, with SQLite data stored outside the app directory.`) and before `## 1. Create the container`:

```markdown

## Quick Start

For a one-command version of everything below, run `deploy/install-lxc.sh` from your Proxmox host shell (see the script's header comment for usage). The full manual walkthrough follows, for anyone who wants to understand or customize each step.
```

- [ ] **Step 3: Update the README's Deployment section**

In `README.md`, replace:

```markdown
## Deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full Proxmox LXC setup (container creation, Tailscale, systemd service, backups, upgrades).
```

with:

```markdown
## Deployment

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Proxmox LXC setup (container creation, Tailscale, systemd service, backups, upgrades), or run `deploy/install-lxc.sh` for a one-command version of the same steps.
- [docs/DOCKER.md](docs/DOCKER.md) — run Vellum in a single Docker container.
```

- [ ] **Step 4: Commit**

```bash
git add docs/DOCKER.md docs/DEPLOYMENT.md README.md
git commit -m "docs: document Docker and one-shot LXC deployment paths"
```
