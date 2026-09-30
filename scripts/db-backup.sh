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
#   DB_PATH env  →  $DATA_DIR/concord.db  →  $DATA_DIR/db/concord.db (legacy)
#
# The $DATA_DIR/db/ layout IS real for docker-compose (docker-compose.yml
# sets DB_PATH=/data/db/concord.db explicitly for both services) — so
# Docker always hits the first branch (DB_PATH env) regardless of ordering
# below. Bare metal (server.js) has NEVER had a db/ subdir: its own
# resolution is DB_PATH env, else path.join(DATA_DIR, "concord.db") — no
# db/ layer, ever. Checking the direct path BEFORE the legacy one (audit
# 2026-07-27, was reversed) matters specifically for bare metal with
# DB_PATH unset: the old order meant any stray file ever left at the
# decoy $DATA_DIR/db/ path (e.g. a box that once ran the docker-compose
# branch before switching to bare metal) got silently backed up INSTEAD
# of the real live DB — passing its own integrity check and reporting
# success on the wrong file.
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

# --- Single-instance lock (2026-09-08) -------------------------------------
# A `sqlite3 .backup` of a multi-GB DB can take longer than the backup cron's
# interval (5 min on the pod). Without a lock, a second run starts before the
# first finishes and they stack — each holding a read lock and each needing
# ~DB-size of free disk for its staging copy. On a near-full disk this wedges
# the box (observed 2026-09-08: two stacked .backup procs, 14 and 20 min old,
# disk at 0 bytes free, backend boots stalled to 2+ minutes). Fail fast and
# quiet if another run holds the lock.
_LOCK_FILE="${TMPDIR:-/tmp}/concord-db-backup.lock"
exec 9>"$_LOCK_FILE" || { echo "[db-backup] cannot open lock $_LOCK_FILE"; exit 0; }
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || { echo "[db-backup] another backup is running — skipping this run"; exit 0; }
  _LOCK_DIR=""
else
  # macOS has no flock(1) — fall back to an atomic mkdir lock with a stale sweep.
  _LOCK_DIR="${TMPDIR:-/tmp}/concord-db-backup.lock.d"
  if ! mkdir "$_LOCK_DIR" 2>/dev/null; then
    if [ -n "$(find "$_LOCK_DIR" -maxdepth 0 -mmin +90 2>/dev/null)" ]; then
      rmdir "$_LOCK_DIR" 2>/dev/null && mkdir "$_LOCK_DIR" 2>/dev/null || { echo "[db-backup] lock held — skipping"; exit 0; }
    else
      echo "[db-backup] another backup is running — skipping this run"; exit 0
    fi
  fi
fi
_cleanup() { [ -n "${STAGING_DIR:-}" ] && rm -rf "$STAGING_DIR"; [ -n "${_LOCK_DIR:-}" ] && rmdir "$_LOCK_DIR" 2>/dev/null; return 0; }
trap _cleanup EXIT

DATA_DIR="${DATA_DIR:-$PROJECT_ROOT/data}"

# --- Resolve the live DB path (respect the real DB_PATH the server uses) ---
if [ -n "${DB_PATH:-}" ]; then
  SRC_DB="$DB_PATH"
elif [ -f "$DATA_DIR/concord.db" ]; then
  SRC_DB="$DATA_DIR/concord.db"                    # the REAL server default (server.js)
elif [ -f "$DATA_DIR/db/concord.db" ]; then
  SRC_DB="$DATA_DIR/db/concord.db"                  # legacy fallback only — see comment above
  echo "WARNING: backing up legacy path $SRC_DB — the server has never written here by default. Set DB_PATH explicitly to remove this ambiguity." >&2
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

STAGING_DIR=$(mktemp -d)   # cleaned by the _cleanup EXIT trap set above

# --- Disk-space guard: `.backup` writes a full staging copy of the DB. ---
# Refuse if free space on the staging volume is < 1.2× the DB size — a
# half-written .backup on a full disk is worse than a skipped run.
_db_bytes=$(wc -c < "$SRC_DB" 2>/dev/null || echo 0)
_free_bytes=$(df -k "$(dirname "$STAGING_DIR")" 2>/dev/null | awk 'NR==2{print $4*1024}')
if [ -n "$_free_bytes" ] && [ "$_db_bytes" -gt 0 ] && [ "$_free_bytes" -lt "$(( _db_bytes * 12 / 10 ))" ]; then
  echo "[db-backup] SKIP: free space $((_free_bytes/1048576))MB < 1.2× DB $((_db_bytes/1048576))MB — not safe to stage a copy"
  exit 0
fi

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
# NOTE: previously silently skipped (no message at all) whenever the
# sqlite3 CLI wasn't installed. Verified live on a box without it: this
# whole block was a no-op and nothing said so. Fall back to the
# better-sqlite3 the server already depends on — same fallback pattern
# already used above for the snapshot step itself — instead of leaving a
# backup shipped with zero verification and no indication of that fact.
INTEGRITY=""
INTEGRITY_CHECKED=false
if command -v sqlite3 &>/dev/null; then
  INTEGRITY=$(sqlite3 "$STAGING_DIR/concord.db" "PRAGMA integrity_check;" 2>&1 | head -1)
  INTEGRITY_CHECKED=true
elif command -v node &>/dev/null; then
  INTEGRITY=$(node -e "
    const Database = require('$PROJECT_ROOT/server/node_modules/better-sqlite3');
    const db = new Database('$STAGING_DIR/concord.db', { readonly: true });
    const rows = db.pragma('integrity_check');
    db.close();
    process.stdout.write(rows.length === 1 && rows[0].integrity_check === 'ok' ? 'ok' : JSON.stringify(rows));
  " 2>&1)
  INTEGRITY_CHECKED=true
fi

if [ "$INTEGRITY_CHECKED" = true ]; then
  if [ "$INTEGRITY" != "ok" ]; then
    echo "[db-backup] INTEGRITY CHECK FAILED: $INTEGRITY"
    exit 1
  fi
  echo "[db-backup] integrity: ok"
else
  echo "[db-backup] WARN: neither sqlite3 nor node available — SKIPPING integrity check on this backup."
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
