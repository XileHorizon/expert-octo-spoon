#!/usr/bin/env bash
# Nightly metadata backup. Original artwork is handed off by email and is not retained.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$APP_DIR"
if [ -f .env.local ]; then set -a; . ./.env.local; set +a; fi
BACKUP_DIR="${BACKUP_DIR:-/var/backups/ship-print-esell}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"
STAMP="$(date +%F)"
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL is not set." >&2; exit 1; }
mkdir -p "$BACKUP_DIR"; chmod 700 "$BACKUP_DIR"
echo "[$(date -Is)] starting metadata backup"
DB_FILE="$BACKUP_DIR/db-$STAMP.sql.gz"
pg_dump "$DATABASE_URL" | gzip > "$DB_FILE.part"; mv "$DB_FILE.part" "$DB_FILE"; chmod 600 "$DB_FILE"
find "$BACKUP_DIR" -name 'db-*.sql.gz' -mtime "+$RETAIN_DAYS" -delete
[ "$(stat -c%s "$DB_FILE")" -ge 1024 ] || { echo "Backup is suspiciously small." >&2; exit 1; }
echo "[$(date -Is)] backup complete: $DB_FILE"
