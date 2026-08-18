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
