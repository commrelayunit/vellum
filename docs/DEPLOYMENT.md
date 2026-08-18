# Deploying Vellum on Proxmox (LXC)

This runs Vellum as a systemd service inside an unprivileged Debian 12 LXC container, with SQLite data stored outside the app directory.

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

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

node -v   # expect v20.x
```

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
su - vellum -s /bin/bash -c "cd /opt/vellum && npm ci --omit=dev"
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
```

Generate the two secrets from inside `/opt/vellum` (as the `vellum` user, so file ownership stays correct):

```bash
su - vellum -s /bin/bash -c "cd /opt/vellum && openssl rand -hex 32"
su - vellum -s /bin/bash -c "cd /opt/vellum && node src/scripts/hash-password.js 'your chosen password'"
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

## 10. Backups

See `deploy/backup.sh` for a nightly SQLite backup script, and set up a Proxmox `vzdump` backup job for the whole container (Datacenter → Backup) as the primary safety net — that captures the full container including `/var/lib/vellum/data`.

Install a nightly cron job on the LXC (as root):

```bash
echo "0 3 * * * vellum DB_PATH=/var/lib/vellum/data/vellum.db BACKUP_DIR=/var/backups/vellum /opt/vellum/deploy/backup.sh" > /etc/cron.d/vellum-backup
```

## 11. Upgrading

```bash
su - vellum -s /bin/bash -c "cd /opt/vellum && git pull && npm ci --omit=dev"
systemctl restart vellum
```

The database lives in `/var/lib/vellum/data`, outside `/opt/vellum`, so `git pull` never touches it.
