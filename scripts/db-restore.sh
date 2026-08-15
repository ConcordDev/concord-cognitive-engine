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

# --- Resolve the live DB path (respect the real DB_PATH the server uses) ---
# Same resolution order as db-backup.sh: DB_PATH env wins. The deployed box
# runs DB_PATH=/opt/concord-db/concord.db, which is NOT $DATA_DIR/concord.db —
# a restore that hardcoded the latter would silently write the snapshot to
# the wrong path while the real (empty) DB stayed untouched.
if [ -n "${DB_PATH:-}" ]; then
  DB_PATH="${DB_PATH}"
elif [ -f "$DATA_DIR/concord.db" ]; then
  DB_PATH="$DATA_DIR/concord.db"                    # the REAL server default (server.js)
elif [ -f "$DATA_DIR/db/concord.db" ]; then
  DB_PATH="$DATA_DIR/db/concord.db"                  # legacy fallback only — see db-backup.sh
else
  DB_PATH="$DATA_DIR/concord.db"
fi
STATE_PATH="${STATE_PATH:-$DATA_DIR/concord_state.json}"
BACKUP_DIR="${CONCORD_BACKUP_DIR:-$DATA_DIR/backups}"

# --- Resolve which backup to restore ---
BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  # No arg: auto-pick the latest volume backup (prefer the current tar.gz
  # format, fall back to the legacy .db.gz / .db shapes backup.sh wrote).
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/concord-backup-*.tar.gz 2>/dev/null | head -1 || true)
  [ -z "$BACKUP_FILE" ] && BACKUP_FILE=$(ls -t "$BACKUP_DIR"/concord-*.db.gz 2>/dev/null | head -1 || true)
  [ -z "$BACKUP_FILE" ] && BACKUP_FILE=$(ls -t "$BACKUP_DIR"/concord-*.db 2>/dev/null | head -1 || true)
  if [ -n "$BACKUP_FILE" ]; then
    echo "[db-restore] No backup arg given — auto-selected latest: $BACKUP_FILE"
  else
    echo "Usage: $0 [<backup-file>]   (default: latest in $BACKUP_DIR)"
    echo ""
    echo "[db-restore] No backups found in $BACKUP_DIR:"
    ls -lh "$BACKUP_DIR" 2>/dev/null || echo "  (empty)"
    exit 1
  fi
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "[db-restore] ERROR: Backup file not found: $BACKUP_FILE"
  exit 1
fi

echo "[db-restore] Restoring from: $BACKUP_FILE"

# --- Stop PM2 processes if PM2 is available and running ---
# Only when restoring over a LIVE database. CONCORD_RESTORE_SKIP_PM2=1 (or a
# fresh target DB, i.e. the bootstrap-restore case) skips this entirely — a
# bootstrap restore happens before any backend is up, so there's nothing to
# stop, and stopping PM2 on a dev box from an unrelated restore test is a
# footgun (this script's pm2 stop all once halted a developer's local stack).
PM2_STOPPED=false
if [ "${CONCORD_RESTORE_SKIP_PM2:-0}" != "1" ] && [ -f "$DB_PATH" ] && command -v pm2 &>/dev/null; then
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
RESTORED_DB="$STAGING_DIR/concord.db"
case "$BACKUP_FILE" in
  *.tar.gz)
    tar -xzf "$BACKUP_FILE" -C "$STAGING_DIR"
    ;;
  *.db.gz)
    gunzip -c "$BACKUP_FILE" > "$RESTORED_DB"
    ;;
  *.db)
    cp "$BACKUP_FILE" "$RESTORED_DB"
    ;;
  *)
    echo "[db-restore] ERROR: Unrecognized backup format: $BACKUP_FILE"
    echo "[db-restore]   Expected a *.tar.gz from db-backup.sh or a *.db.gz / *.db from backup.sh"
    exit 1
    ;;
esac

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
mkdir -p "$(dirname "$DB_PATH")"
mkdir -p "$(dirname "$STATE_PATH")" 2>/dev/null || true
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
