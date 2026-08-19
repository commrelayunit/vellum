#!/usr/bin/env bash
# deploy/install-lxc.sh
# One-shot Proxmox LXC provisioning for Vellum.
#
# Download the script to the Proxmox host first, then run it locally as a
# normal script (piping it straight into `bash -c` via `wget -qLO- ... | bash`
# does NOT work here: the password prompt below needs a real TTY, which a
# piped `bash -c` invocation doesn't have):
#   wget -O install-lxc.sh https://<your-repo-url>/raw/main/deploy/install-lxc.sh
#   REPO_URL=<your-repo-url> bash install-lxc.sh
# You'll be prompted interactively for the login password.
#
# Scripting/non-interactive use only: the password can instead be passed as
# a positional argument, e.g. REPO_URL=<your-repo-url> bash install-lxc.sh
# [AUTH_PASSWORD] — but this leaves the plaintext password in the Proxmox
# host's shell history and process list (visible via `ps`), so prefer the
# interactive prompt above whenever a human is at the keyboard.
#
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

# Host-side temp files holding secrets, and a best-effort cleanup of the
# in-container plaintext password file, on any exit (success, error, or
# interrupt) — not just the happy path.
PW_FILE=""
ENV_FILE=""
cleanup() {
  rm -f "$PW_FILE" "$ENV_FILE"
  pct exec "$VMID" -- rm -f /tmp/vellum-pw >/dev/null 2>&1 || true
}
trap cleanup EXIT

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
  apt install -y curl git build-essential python3 sqlite3
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
pct push "$VMID" "$PW_FILE" /tmp/vellum-pw --perms 0600
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
pct push "$VMID" "$ENV_FILE" /etc/vellum/vellum.env --perms 0600
rm -f "$ENV_FILE"
pct exec "$VMID" -- chown vellum:vellum /etc/vellum/vellum.env
pct exec "$VMID" -- chmod 600 /etc/vellum/vellum.env

echo "==> Installing and starting the systemd service"
pct exec "$VMID" -- cp /opt/vellum/deploy/vellum.service /etc/systemd/system/vellum.service
pct exec "$VMID" -- systemctl daemon-reload
pct exec "$VMID" -- systemctl enable --now vellum

if ! pct exec "$VMID" -- systemctl is-active --quiet vellum; then
  echo "==> WARNING: the vellum service did not come up cleanly." >&2
  echo "    Check logs with: pct exec $VMID -- journalctl -u vellum -n 50 --no-pager" >&2
  exit 1
fi

echo "==> Done. Verify with: pct exec $VMID -- curl -I http://127.0.0.1:3001/login"
echo "    Then authenticate Tailscale: pct exec $VMID -- tailscale up"
