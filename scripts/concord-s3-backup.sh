#!/bin/bash
# concord-s3-backup.sh - nightly consistent SQLite snapshot of live Concord DB -> gzip -> S3.
set -u -o pipefail
umask 077
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export AWS_PROFILE=concord-backup AWS_DEFAULT_REGION=us-east-1
DB="$HOME/concord vs code/concord-cognitive-engine/server/data/concord.db"
BUCKET="concord-os-backups-593969031064"
LOG="$HOME/.zuko/s3-backup.log"
TS=$(date +%Y%m%d-%H%M%S)
log(){ echo "$(date '+%Y-%m-%d %H:%M:%S %Z') [s3-backup $$] $*" >> "$LOG"; }
TMPD=$(mktemp -d "${TMPDIR:-/tmp}/concord-s3.XXXXXX") || { log "FAIL mktemp"; exit 1; }
trap 'rm -rf "$TMPD"' EXIT
[ -f "$DB" ] || { log "FAIL live DB not found"; exit 1; }
log "start"
dbsz=$(( $(stat -f %z "$DB") + $(stat -f %z "$DB-wal" 2>/dev/null || echo 0) ))
# Snapshot + 5 GiB so the Mac keeps room for swap (INC-132). The gzip is
# streamed straight to S3 (never written locally), so it needs no disk.
need=$(( dbsz + 5*1073741824 ))
free=$(df -k "$TMPD" | awk 'NR==2{print $4*1024}')
# stream_up <key>: stdin -> S3, then verify the remote size equals the bytes
# we sent. dd counts the bytes deterministically (no racy process substitution).
stream_up() {
  local key="$1"
  dd bs=1048576 2> "$TMPD/dd.log" | aws s3 cp - "s3://$BUCKET/$key" --only-show-errors >> "$LOG" 2>&1 || { log "FAIL upload"; return 1; }
  local sent; sent=$(awk '/bytes transferred/{print $1}' "$TMPD/dd.log")
  local SZ; SZ=$(aws s3api head-object --bucket "$BUCKET" --key "$key" --query ContentLength --output text 2>>"$LOG")
  [ -n "$sent" ] && [ "$SZ" = "$sent" ] || { log "FAIL size mismatch remote=$SZ sent=$sent"; return 1; }
  # Runs as the last stage of a pipeline (a subshell), so report via a file.
  echo "$SZ" > "$TMPD/uploaded_bytes"
}
if [ "$free" -lt "$need" ]; then
  # Low disk: upload the newest deploy clone under 4 h old (APFS clone of db+wal+shm,
  # taken with the backend stopped), streamed as a tar.gz. Needs no local disk.
  now=$(date +%s); best=""; best_m=0
  for d in "$HOME"/concord/backups/*/db; do
    [ -f "$d/concord.db" ] || continue
    m=$(stat -f %m "$d/concord.db"); [ -f "$d/concord.db-wal" ] && { mw=$(stat -f %m "$d/concord.db-wal"); [ "$mw" -gt "$m" ] && m=$mw; }
    [ $((now-m)) -lt 14400 ] && [ "$m" -gt "$best_m" ] && { best="$d"; best_m=$m; }
  done
  [ -n "$best" ] || { log "SKIP free $((free/1048576)) MiB < needed $((need/1048576)) MiB and no deploy clone under 4 h old"; exit 0; }
  [ "$(head -c 15 "$best/concord.db")" = "SQLite format 3" ] || { log "FAIL clone header $best"; exit 1; }
  log "low disk ($((free/1048576)) MiB): streaming deploy clone $best (age $(( (now-best_m)/60 )) min)"
  KEY="daily/concord-$TS.tar.gz"
  ( cd "$best" && COPYFILE_DISABLE=1 tar --no-mac-metadata --no-xattrs -cf - concord.db $( [ -f concord.db-wal ] && echo concord.db-wal ) $( [ -f concord.db-shm ] && echo concord.db-shm ) ) | gzip -1 | stream_up "$KEY" || { log "FAIL clone stream"; exit 1; }
  log "S3_OK s3://$BUCKET/$KEY bytes=$(cat "$TMPD/uploaded_bytes") (deploy clone)"
  exit 0
fi
SNAP="$TMPD/concord-$TS.db"
# VACUUM INTO copies inside one read transaction; .backup restarts on every live write and looped for 70+ min on 2026-10-17.
sqlite3 -readonly "$DB" ".timeout 120000" "VACUUM INTO '$SNAP';" || { log "FAIL sqlite snapshot"; exit 1; }
ok=$(sqlite3 "$SNAP" "PRAGMA quick_check;" 2>&1 | head -1)
[ "$ok" = "ok" ] || { log "FAIL quick_check: $ok"; exit 1; }
log "snapshot ok $(stat -f %z "$SNAP") B"
KEY="daily/concord-$TS.db.gz"
gzip -6 -c "$SNAP" | stream_up "$KEY" || exit 1
log "S3_OK s3://$BUCKET/$KEY bytes=$(cat "$TMPD/uploaded_bytes")"
