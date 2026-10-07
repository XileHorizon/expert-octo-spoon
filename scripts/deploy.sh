#!/usr/bin/env bash
# One-command deploy. Safe to re-run for updates.
#
#   ./scripts/deploy.sh
#
# Installs dependencies, applies the schema, builds, and (re)starts the app
# under PM2 so it survives crashes and reboots.

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mError: %s\033[0m\n\n' "$*" >&2; exit 1; }

[ -f .env.local ] || die "No .env.local found. Copy .env.example to .env.local and fill it in first."

set -a; . ./.env.local; set +a
[ -n "${MYSQL_URL:-}" ] || [ -n "${DB_HOST:-}" ] || die "Database credentials are not set in .env.local"
[ -n "${APP_URL:-}" ] || die "APP_URL is not set in .env.local (password reset links need it)"

command -v node >/dev/null || die "Node.js is not installed."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -eq 24 ] || die "Node.js 24 is required (found $(node -v))."

say "1/6  Checking the database connection"
node --env-file-if-exists=.env.local --input-type=module -e 'import mysql from "mysql2/promise"; import { databaseConnectionOptions } from "./scripts/database-config.mjs"; const options=databaseConnectionOptions(); if(!options) throw new Error("missing database credentials"); const c=await mysql.createConnection(options); await c.query("select 1"); await c.end();' || die "Cannot connect using the configured MySQL credentials. Check the cPanel database, user grants, hostname, and port."
echo "     connected"

say "2/6  Installing dependencies"
npm ci

say "3/6  Applying the database schema"
npm run db:init
echo "     schema and required catalog mapping up to date"

say "4/6  Checking email configuration"
if [ -z "${RESEND_API_KEY:-}" ] && [ -z "${SMTP_HOST:-}" ] && [ -z "${GMAIL_OAUTH_TOKENS_PATH:-}" ]; then
  die "Configure RESEND_API_KEY, SMTP_HOST, or GMAIL_OAUTH_TOKENS_PATH for email delivery."
fi
[ -n "${QUOTE_NOTIFICATION_FROM:-${EMAIL_FROM:-}}" ] || die "QUOTE_NOTIFICATION_FROM or fallback EMAIL_FROM is required."
[ -n "${CUSTOMER_CONFIRMATION_FROM:-${EMAIL_FROM:-}}" ] || die "CUSTOMER_CONFIRMATION_FROM or fallback EMAIL_FROM is required."
[ -n "${QUOTE_NOTIFICATION_TO:-}" ] || die "QUOTE_NOTIFICATION_TO is required."
echo "     email handoff configured"

say "5/6  Building"
npm run build

say "6/6  Starting under PM2"
if ! command -v pm2 >/dev/null; then
  echo "     installing pm2"
  npm install -g pm2 || die "Could not install pm2. Install it manually: npm install -g pm2"
fi

mkdir -p logs
if pm2 describe ship-print-esell >/dev/null 2>&1; then
  pm2 reload ecosystem.config.js --update-env
  echo "     reloaded"
else
  pm2 start ecosystem.config.js
  echo "     started"
fi
pm2 save

say "Checking health"
sleep 4
PORT_VALUE="${PORT:-3000}"
if curl -fsS "http://127.0.0.1:${PORT_VALUE}/api/health" >/tmp/spe-health.json 2>/dev/null; then
  cat /tmp/spe-health.json; echo
else
  echo "     Health check did not pass yet. Inspect with: pm2 logs ship-print-esell"
fi

cat <<EOF

Deployment complete.

  Owner account:   npm run create-owner -- owner@example.com
  Start on boot:   pm2 startup     (run the command it prints, once)
  Logs:            pm2 logs ship-print-esell
  Status:          pm2 status

EOF
