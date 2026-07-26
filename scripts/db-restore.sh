#!/usr/bin/env bash
# Concord Cognitive Engine — Local Database Restore
#
# Restores a backup created by db-backup.sh. Creates a safety backup
# of the current database before overwriting.
#
# Usage:
#   ./scripts/db-restore.sh ./data/backups/concord-backup-20260331_120000.tar.gz

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR="${DATA_DIR:-$PROJECT_ROOT/data}"
DB_PATH="$DATA_DIR/concord.db"
STATE_PATH="$DATA_DIR/concord_state.json"

# --- Validate arguments ---
if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup-file.tar.gz>"
  echo ""
  echo "Available backups:"
  ls -lh "$DATA_DIR/backups"/concord-backup-*.tar.gz 2>/dev/null || echo "  (none found in $DATA_DIR/backups/)"
  exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[db-restore] ERROR: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "[db-restore] Restoring from: $BACKUP_FILE"

# --- Stop PM2 processes if PM2 is available and running ---
PM2_STOPPED=false
if command -v pm2 &>/dev/null; then
  RUNNING=$(pm2 jlist 2>/dev/null | grep -c '"status":"online"' || true)
  if [ "$RUNNING" -gt 0 ]; then
    echo "[db-restore] Stopping PM2 processes..."
    pm2 stop all 2>/dev/null || true
    PM2_STOPPED=true
  fi
fi

# --- Extract backup to a temporary directory for validation ---
STAGING_DIR=$(mktemp -d)
trap 'rm -rf "$STAGING_DIR"' EXIT

echo "[db-restore] Extracting backup..."
tar -xzf "$BACKUP_FILE" -C "$STAGING_DIR"

# --- Validate the extracted database ---
RESTORED_DB="$STAGING_DIR/concord.db"
if [ ! -f "$RESTORED_DB" ]; then
  echo "[db-restore] ERROR: Backup archive does not contain concord.db"
  exit 1
fi

# Integrity check — never restore a corrupt snapshot over a good DB.
# NOTE: this used to be silently skipped whenever the sqlite3 CLI binary
# wasn't installed (no warning, no failure — just no check ever ran).
# Verified live on a box without sqlite3: db-backup.sh's own "integrity: ok"
# line never printed and nothing said why. Fall back to the better-sqlite3
# the server already depends on (same fallback pattern db-backup.sh uses
# for the snapshot step itself) instead of leaving that gap silent.
echo "[db-restore] Verifying backup integrity..."
INTEGRITY=""
INTEGRITY_CHECKED=false
if command -v sqlite3 &>/dev/null; then
  INTEGRITY=$(sqlite3 "$RESTORED_DB" "PRAGMA integrity_check;" 2>&1)
  INTEGRITY_CHECKED=true
elif command -v node &>/dev/null; then
  INTEGRITY=$(node -e "
    const Database = require('$PROJECT_ROOT/server/node_modules/better-sqlite3');
    const db = new Database('$RESTORED_DB', { readonly: true });
    const rows = db.pragma('integrity_check');
    db.close();
    process.stdout.write(rows.length === 1 && rows[0].integrity_check === 'ok' ? 'ok' : JSON.stringify(rows));
  " 2>&1)
  INTEGRITY_CHECKED=true
fi

if [ "$INTEGRITY_CHECKED" = true ]; then
  if [ "$INTEGRITY" != "ok" ]; then
    echo "[db-restore] INTEGRITY CHECK FAILED: $INTEGRITY"
    echo "[db-restore] Aborting restore. Current database is unchanged."
    exit 1
  fi
  echo "[db-restore] Integrity check: OK"
else
  echo "[db-restore] WARN: neither sqlite3 nor node available — SKIPPING integrity check."
  echo "[db-restore] WARN: restoring an unverified snapshot. Install sqlite3 or node to close this gap."
fi

# --- Safety backup of the current database ---
mkdir -p "$DATA_DIR"
if [ -f "$DB_PATH" ]; then
  SAFETY_BACKUP="$DB_PATH.pre-restore-$(date +%Y%m%d_%H%M%S)"
  echo "[db-restore] Safety backup of current DB: $SAFETY_BACKUP"
  cp "$DB_PATH" "$SAFETY_BACKUP"
fi

# --- Restore database ---
echo "[db-restore] Replacing database..."
cp "$RESTORED_DB" "$DB_PATH"
# Remove stale WAL/SHM files from the old database
rm -f "$DB_PATH-wal" "$DB_PATH-shm"

# --- Restore state file if it was in the backup ---
if [ -f "$STAGING_DIR/concord_state.json" ]; then
  if [ -f "$STATE_PATH" ]; then
    cp "$STATE_PATH" "$STATE_PATH.pre-restore-$(date +%Y%m%d_%H%M%S)"
  fi
  cp "$STAGING_DIR/concord_state.json" "$STATE_PATH"
  echo "[db-restore] Restored concord_state.json"
fi

# --- Restart PM2 processes if we stopped them ---
if [ "$PM2_STOPPED" = true ]; then
  echo "[db-restore] Restarting PM2 processes..."
  pm2 start all 2>/dev/null || true
fi

DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
echo "[db-restore] SUCCESS: Database restored ($DB_SIZE)"
echo "[db-restore] Done."
