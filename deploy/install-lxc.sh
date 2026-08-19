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
