#!/bin/bash
# NO_DUTCH_BACKUP_THROTTLE 2026-09-05 — avoid sqlite3 .backup temp-copy storms on low disk.
# If a backup newer than 20h exists under BACKUP_DIR/today, skip. Prefer server runBackup stream.
_THROTTLE_MARKER_DIR="${BACKUP_DIR:-./data/backups}"
_TODAY=$(date +%F)
if [ -d "$_THROTTLE_MARKER_DIR/$_TODAY" ]; then
  _newest=$(find "$_THROTTLE_MARKER_DIR/$_TODAY" -type f -name 'concord.db*' -mtime -1 2>/dev/null | head -1)
  if [ -n "$_newest" ]; then
    echo "[backup.sh] skip: recent backup exists ($_newest) — disk-safe throttle"
    exit 0
  fi
fi

# Concord Backup Script
# Creates a snapshot of:
#   - SQLite database (online backup + gzip compression + integrity verification)
#   - Artifacts directory
# Stores in /data/backups/ with a date-stamped filename.
# Retains rolling window of 7 backups.

set -euo pipefail

# Single-instance lock (2026-09-08) — a slow `.backup` of a multi-GB DB must not
# be re-triggered while running (stacked runs = stacked read locks + stacked
# disk-doubling staging copies → box wedge on a near-full disk). See the fuller
# note in scripts/db-backup.sh.
_BKLOCK="${TMPDIR:-/tmp}/concord-backup-sh.lock.d"
if ! mkdir "$_BKLOCK" 2>/dev/null; then
  if [ -n "$(find "$_BKLOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then
    rmdir "$_BKLOCK" 2>/dev/null && mkdir "$_BKLOCK" 2>/dev/null || { echo "[backup.sh] lock held — skipping"; exit 0; }
  else
    echo "[backup.sh] another backup is running — skipping this run"; exit 0
  fi
fi
trap 'rmdir "$_BKLOCK" 2>/dev/null || true' EXIT

DATA_DIR="${DATA_DIR:-/data}"
DB_PATH="${DB_PATH:-$DATA_DIR/db/concord.db}"
ARTIFACTS_DIR="$DATA_DIR/artifacts"
BACKUP_DIR="${CONCORD_BACKUP_DIR:-$DATA_DIR/backups}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
RETAIN_COUNT=7

mkdir -p "$BACKUP_DIR"

echo "[Backup] Starting backup at $TIMESTAMP"

# 1. SQLite online backup with compression and integrity check
if [ -f "$DB_PATH" ]; then
  BACKUP_DB="$BACKUP_DIR/concord-$TIMESTAMP.db"
  echo "[Backup] Copying database..."
  # Use sqlite3 .backup for online-safe copy, fall back to cp
  if command -v sqlite3 &>/dev/null; then
    # Prefer cp when free disk < 3Gi to avoid .backup doubling usage
    _free_k=$(df -k "$(dirname "$DB_PATH")" 2>/dev/null | awk 'NR==2{print $4}')
    if [ -n "$_free_k" ] && [ "$_free_k" -lt 3000000 ]; then
      echo "[backup.sh] low disk — using cp instead of sqlite3 .backup"
      cp "$DB_PATH" "$BACKUP_DB"
    else
    sqlite3 "$DB_PATH" ".backup '$BACKUP_DB'"
    fi
  else
    cp "$DB_PATH" "$BACKUP_DB"
  fi

  # Verify backup integrity before compressing
  if command -v sqlite3 &>/dev/null; then
    echo "[Backup] Verifying integrity..."
    INTEGRITY=$(sqlite3 "$BACKUP_DB" "PRAGMA integrity_check;" 2>&1)
    if [ "$INTEGRITY" != "ok" ]; then
      echo "[Backup] INTEGRITY CHECK FAILED for $TIMESTAMP: $INTEGRITY"
      rm -f "$BACKUP_DB"
      exit 1
    fi
    echo "[Backup] Integrity check: OK"
  fi

  # Compress the backup
  echo "[Backup] Compressing..."
  gzip "$BACKUP_DB"
  COMPRESSED_SIZE=$(du -h "$BACKUP_DB.gz" | cut -f1)
  echo "[Backup] Database backed up to $BACKUP_DB.gz ($COMPRESSED_SIZE)"
else
  echo "[Backup] No database found at $DB_PATH — skipping DB backup"
fi

# 2. Artifacts tar snapshot
if [ -d "$ARTIFACTS_DIR" ] && [ "$(ls -A "$ARTIFACTS_DIR" 2>/dev/null)" ]; then
  BACKUP_TAR="$BACKUP_DIR/artifacts-$TIMESTAMP.tar.gz"
  echo "[Backup] Archiving artifacts..."
  tar -czf "$BACKUP_TAR" -C "$DATA_DIR" artifacts
  echo "[Backup] Artifacts backed up to $BACKUP_TAR"
else
  echo "[Backup] No artifacts directory found — skipping"
fi

# 3. Prune old backups (keep RETAIN_COUNT most recent of each type)
echo "[Backup] Pruning old backups (keeping $RETAIN_COUNT most recent)..."
cd "$BACKUP_DIR"

# Prune compressed DB backups. `|| true` swallows the exit-2 that ls
# returns when the glob doesn't match (no .db.gz files yet) — `set -e`
# + `pipefail` would otherwise abort here on first-run / fresh-deploy.
ls -t concord-*.db.gz 2>/dev/null | tail -n +$((RETAIN_COUNT + 1)) | xargs -r rm -f || true

# Prune uncompressed DB backups (legacy)
ls -t concord-*.db 2>/dev/null | tail -n +$((RETAIN_COUNT + 1)) | xargs -r rm -f || true

# Prune artifact archives
ls -t artifacts-*.tar.gz 2>/dev/null | tail -n +$((RETAIN_COUNT + 1)) | xargs -r rm -f || true

echo "[Backup] $TIMESTAMP — OK ($COMPRESSED_SIZE)"
echo "[Backup] Done. Backups in $BACKUP_DIR:"
ls -lh "$BACKUP_DIR" 2>/dev/null || echo "  (empty)"
