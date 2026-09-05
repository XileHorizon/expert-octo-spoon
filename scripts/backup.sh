#!/usr/bin/env bash
# Nightly MySQL metadata backup. Original artwork is handed off by email and is not retained.
set -euo pipefail
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
exec node --env-file-if-exists=.env.local scripts/backup.mjs
