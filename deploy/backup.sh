#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${DB_PATH:-/var/lib/vellum/data/vellum.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/vellum}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/vellum-$TIMESTAMP.db'"

# Keep the last 14 backups
ls -1t "$BACKUP_DIR"/vellum-*.db 2>/dev/null | tail -n +15 | xargs -r rm --
