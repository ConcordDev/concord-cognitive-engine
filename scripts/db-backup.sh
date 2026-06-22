#!/usr/bin/env bash
# Concord Cognitive Engine — Database Backup (WAL-safe, volume-aware)
#
# Creates a timestamped, gzip-compressed, integrity-checked snapshot of the
# live SQLite DB (+ state file) and writes it to a PERSISTENT location.
#
# Persistence model (read this):
#   - The live DB and these backups must live on a PERSISTENT network volume
#     (RunPod mounts one at /workspace by default), NOT the ephemeral container
#     disk. A pod reclaim wipes the container disk — backups there die with it.
#   - Backups on the same volume protect against corruption / bad migration /
#     accidental delete (the live file can't recover those). The only thing
#     they DON'T cover is the volume itself failing — set CONCORD_BACKUP_REMOTE
#     for an off-box copy (S3/R2 via rclone or aws) to close that last gap.
#
# Resolution order for the source DB:
#   DB_PATH env  →  $DATA_DIR/db/concord.db  →  $DATA_DIR/concord.db
# Resolution order for the backup dir:
#   $1 arg  →  CONCORD_BACKUP_DIR env  →  $DATA_DIR/backups
#
# Usage:
#   ./scripts/db-backup.sh                  # auto-resolve from env
#   ./scripts/db-backup.sh /workspace/concord/backups
#   CONCORD_BACKUP_REMOTE="r2:concord-backups" ./scripts/db-backup.sh   # +off-box

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DATA_DIR="${DATA_DIR:-$PROJECT_ROOT/data}"

# --- Resolve the live DB path (respect the real DB_PATH the server uses) ---
if [ -n "${DB_PATH:-}" ]; then
  SRC_DB="$DB_PATH"
elif [ -f "$DATA_DIR/db/concord.db" ]; then
  SRC_DB="$DATA_DIR/db/concord.db"
else
  SRC_DB="$DATA_DIR/concord.db"
fi
STATE_PATH="${STATE_PATH:-$DATA_DIR/concord_state.json}"

# --- Resolve the backup dir (default to a persistent location) ---
BACKUP_DIR="${1:-${CONCORD_BACKUP_DIR:-$DATA_DIR/backups}}"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
# 6-hourly cron × 28 = 7 days of history on the volume.
RETAIN_COUNT="${CONCORD_BACKUP_RETAIN:-28}"

mkdir -p "$BACKUP_DIR"

if [ ! -f "$SRC_DB" ]; then
  echo "[db-backup] ERROR: Database not found at $SRC_DB"
  echo "[db-backup]   Set DB_PATH or DATA_DIR to point at the live DB."
  exit 1
fi

echo "[db-backup] $TIMESTAMP  src=$SRC_DB  dest=$BACKUP_DIR"

STAGING_DIR=$(mktemp -d)
trap 'rm -rf "$STAGING_DIR"' EXIT

# --- WAL-safe consistent snapshot (NEVER a raw cp of a live WAL DB) ---
if command -v sqlite3 &>/dev/null; then
  # .backup uses the online backup API — consistent even with active writers.
  sqlite3 "$SRC_DB" ".backup '$STAGING_DIR/concord.db'"
else
  # No sqlite3 CLI: VACUUM INTO via the better-sqlite3 the server already has.
  # This is also a consistent snapshot (unlike cp). Falls back to cp only if
  # node is unavailable too.
  if command -v node &>/dev/null; then
    node -e "
      const Database = require('$PROJECT_ROOT/server/node_modules/better-sqlite3');
      const db = new Database('$SRC_DB', { readonly: true });
      db.exec(\"VACUUM INTO '$STAGING_DIR/concord.db'\");
      db.close();
    " || cp "$SRC_DB" "$STAGING_DIR/concord.db"
  else
    cp "$SRC_DB" "$STAGING_DIR/concord.db"
  fi
fi

# --- Integrity check — never ship a corrupt backup ---
if command -v sqlite3 &>/dev/null; then
  INTEGRITY=$(sqlite3 "$STAGING_DIR/concord.db" "PRAGMA integrity_check;" 2>&1 | head -1)
  if [ "$INTEGRITY" != "ok" ]; then
    echo "[db-backup] INTEGRITY CHECK FAILED: $INTEGRITY"
    exit 1
  fi
  echo "[db-backup] integrity: ok"
fi

[ -f "$STATE_PATH" ] && cp "$STATE_PATH" "$STAGING_DIR/concord_state.json"

# --- Compress ---
BACKUP_NAME="concord-backup-${TIMESTAMP}.tar.gz"
BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"
tar -czf "$BACKUP_PATH" -C "$STAGING_DIR" .
BACKUP_SIZE=$(du -h "$BACKUP_PATH" | cut -f1)
echo "[db-backup] wrote $BACKUP_PATH ($BACKUP_SIZE)"

# --- Optional off-box copy (closes the "volume itself dies" gap) ---
# Set CONCORD_BACKUP_REMOTE to an rclone remote (e.g. "r2:concord-backups")
# or an s3:// URL for aws-cli. Best-effort: a remote failure never fails the
# local backup (which already succeeded).
if [ -n "${CONCORD_BACKUP_REMOTE:-}" ]; then
  if [[ "$CONCORD_BACKUP_REMOTE" == s3://* ]] && command -v aws &>/dev/null; then
    aws s3 cp "$BACKUP_PATH" "$CONCORD_BACKUP_REMOTE/$BACKUP_NAME" \
      && echo "[db-backup] off-box: s3 ok" || echo "[db-backup] WARN off-box s3 push failed"
  elif command -v rclone &>/dev/null; then
    rclone copy "$BACKUP_PATH" "$CONCORD_BACKUP_REMOTE" \
      && echo "[db-backup] off-box: rclone ok" || echo "[db-backup] WARN off-box rclone push failed"
  else
    echo "[db-backup] WARN CONCORD_BACKUP_REMOTE set but neither aws nor rclone installed"
  fi
fi

# --- Rotate (keep last $RETAIN_COUNT locally) ---
REMOVED=0
while IFS= read -r old; do rm -f "$old"; REMOVED=$((REMOVED + 1)); done \
  < <(ls -t "$BACKUP_DIR"/concord-backup-*.tar.gz 2>/dev/null | tail -n +$((RETAIN_COUNT + 1)))
[ "$REMOVED" -gt 0 ] && echo "[db-backup] pruned $REMOVED old (keep $RETAIN_COUNT)"

echo "[db-backup] done."
