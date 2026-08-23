# Deploying Vellum on Proxmox (LXC)

This runs Vellum as a systemd service inside an unprivileged Debian 12 LXC container, with SQLite data stored outside the app directory.

## Quick Start

For a one-command version of steps 1–8 below, run `deploy/install-lxc.sh` from your Proxmox host shell (see the script's header comment for usage). The one-shot install deliberately skips step 7's sample-data seeding — you'll start with an empty project list and create your first project via the "+ New project" button — and it doesn't set up step 3's Tailscale authentication or step 10's backup cron for you; the script reminds you to run `tailscale up` when it finishes, and you should still follow step 10 by hand afterwards. The full manual walkthrough follows, for anyone who wants to understand or customize each step.

## 1. Create the container

From the Proxmox host shell (adjust `100` to a free VMID and `local-lvm`/bridge names to match your setup):

```bash
pveam update
pveam download local debian-12-standard_12.7-1_amd64.tar.zst

pct create 100 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname vellum \
  --unprivileged 1 \
  --cores 1 \
  --memory 512 \
  --swap 512 \
  --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --features nesting=0

pct start 100
pct enter 100
```

512MB RAM / 1 vCPU / 8GB disk is comfortably enough for Node + SQLite at this scale; resize later with `pct set` if needed.

## 2. Base packages (inside the container)

```bash
apt update && apt upgrade -y
apt install -y curl git build-essential python3 sqlite3

curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs

node -v   # expect v22.x
```

Node 22.x LTS is required here (not just "Node >= 20"): `better-sqlite3@12.11.1` only ships prebuilt binaries for Node ABI 127/137/141/147 (Node 22/24/25/26), not for Node 20's ABI 115. Installing Node 20 would force `npm ci` to fall back to a full `node-gyp` source compile on this 512MB container, which is exactly what the prebuilt-binary constraint is meant to avoid.

`build-essential`/`python3` are there as a fallback in case `better-sqlite3` has no prebuilt binary for this exact Node/Debian combination — if the prebuilt binary works, npm skips the compile step automatically.

## 3. Private network access

Install Tailscale so the app is reachable privately without exposing a public port (matches the project's existing "Tailscale access" deployment note):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

## 4. Create the service user and directories

```bash
useradd --system --home /opt/vellum --shell /usr/sbin/nologin vellum
mkdir -p /opt/vellum /var/lib/vellum/data /etc/vellum
chown -R vellum:vellum /opt/vellum /var/lib/vellum
```

## 5. Deploy the code

```bash
su - vellum -s /bin/bash -c "git clone <your-repo-url> /opt/vellum"
cd /opt/vellum
su - vellum -s /bin/bash -c "cd /opt/vellum && npm ci && npm run build:client && npm prune --omit=dev"
```

## 6. Configure

```bash
cp /opt/vellum/.env.example /etc/vellum/vellum.env
```

Edit `/etc/vellum/vellum.env`:

```
PORT=3001
DB_PATH=/var/lib/vellum/data/vellum.db
SESSION_SECRET=<paste output of: openssl rand -hex 32>
AUTH_PASSWORD_HASH=<paste output of: node src/scripts/hash-password.js "your chosen password", run from /opt/vellum>
ENCRYPTION_KEY=<paste output of: openssl rand -base64 32>
```

`NODE_ENV=production` is already set by the systemd unit (`deploy/vellum.service`) and does not need to be added here — it disables Express's dev-mode error pages (which would otherwise leak stack traces in HTTP responses) and enables view caching.

Generate the three secrets from inside `/opt/vellum` (as the `vellum` user, so file ownership stays correct):

```bash
su - vellum -s /bin/bash -c "cd /opt/vellum && openssl rand -hex 32"
su - vellum -s /bin/bash -c "cd /opt/vellum && node src/scripts/hash-password.js 'your chosen password'"
su - vellum -s /bin/bash -c "cd /opt/vellum && openssl rand -base64 32"
```

Lock the env file down since it holds secrets:

```bash
chown vellum:vellum /etc/vellum/vellum.env
chmod 600 /etc/vellum/vellum.env
```

## 7. Migrate and seed

```bash
su - vellum -s /bin/bash -c "cd /opt/vellum && set -a && source /etc/vellum/vellum.env && set +a && node src/scripts/seed.js"
```

(`seed.js` runs `migrate()` itself before inserting rows — see `src/scripts/seed.js` — so this single command both creates the schema and seeds the two sample projects.)

## 8. Install and start the systemd service

```bash
cp /opt/vellum/deploy/vellum.service /etc/systemd/system/vellum.service
systemctl daemon-reload
systemctl enable --now vellum
systemctl status vellum
```

## 9. Verify

```bash
curl -I http://127.0.0.1:3001/login          # expect: HTTP/1.1 200 OK
journalctl -u vellum -n 50 --no-pager        # expect: "Vellum server running on http://localhost:3001"
```

From another machine on your Tailnet: open `http://<vellum-tailscale-ip>:3001/login`, sign in with the password you hashed in step 6, and confirm the two seeded projects ("Sample Project", "Documentation") load, open, and save edits.

(If you used `deploy/install-lxc.sh` instead of these manual steps, there's no seeded data to check — step 7's seeding is intentionally skipped by the one-shot install, so an empty project list here is expected, not a bug. Create your first project via the "+ New project" button instead.)

## 10. Backups

See `deploy/backup.sh` for a nightly SQLite backup script, and set up a Proxmox `vzdump` backup job for the whole container (Datacenter → Backup) as the primary safety net — that captures the full container including `/var/lib/vellum/data`.

Create the backup directory first — `/var/backups` is root-owned `0755` by default on Debian, so the `vellum` user cannot create a subdirectory there on its own, and `backup.sh` (which runs with `set -e`) will fail silently under cron otherwise:

```bash
mkdir -p /var/backups/vellum && chown vellum:vellum /var/backups/vellum
```

Install a nightly cron job on the LXC (as root):

```bash
echo "0 3 * * * vellum DB_PATH=/var/lib/vellum/data/vellum.db BACKUP_DIR=/var/backups/vellum /opt/vellum/deploy/backup.sh" > /etc/cron.d/vellum-backup
```

**The nightly `backup.sh` script backs up the SQLite database only — that is not enough to recover AI provider credentials.** Provider API keys are stored encrypted with `ENCRYPTION_KEY` (from `/etc/vellum/vellum.env`); restoring a DB-only backup onto a host with a different or missing `ENCRYPTION_KEY` leaves every stored provider row un-decryptable (the settings page will list them but can't reveal or reuse the keys). Back up `/etc/vellum/vellum.env` alongside the database — the Proxmox `vzdump` container-level backup already covers this since it captures the whole container, so make sure that job is actually enabled if you're relying on it as your recovery path for this feature's data.

## 11. Upgrading

```bash
su - vellum -s /bin/bash -c "cd /opt/vellum && git pull && npm ci && npm run build:client && npm prune --omit=dev"
systemctl restart vellum
```

The database lives in `/var/lib/vellum/data`, outside `/opt/vellum`, so `git pull` never touches it.

**Existing installs upgrading past the AI provider settings feature must add `ENCRYPTION_KEY` to `/etc/vellum/vellum.env` before the Settings page will work.** Without it, the page still appears in the menu but every save fails (see the `## 6. Configure` section above for the generation command: `openssl rand -base64 32`), and the only in-app signal is a warning in `journalctl -u vellum` that's easy to miss.

Schema changes apply automatically and incrementally on every restart — existing projects, files, provider credentials, and settings are never wiped.
