#!/usr/bin/env bash
# /Users/dutch/.local/bin/concord-deploy-backup-prune.sh
#
# Prune old deploy DB snapshots in /Users/dutch/concord/backups/.
#
# Each Concord deploy creates a timestamped snapshot there:
#   /Users/dutch/concord/backups/YYYYMMDD-HHMM-deploy-<name>/
# Each contains a full copy of the live DB (9 GB+) plus plist + git refs.
# Without pruning, this dir grows ~9 GB per deploy. With ~16 deploys/day
# that's ~144 GB within two days.
#
# Policy: keep the 2 most recent deploy backups. Delete the rest.
# This is a one-way delete; the deploy snapshot is the only place we
# have the data at that specific point in time, so do NOT run this if
# the offsite backup is broken (see /Users/dutch/.local/bin/
# concord-offsite-backup.sh — last successful run logged in
# /Users/dutch/.zuko/logs/offsite-backup.log).
#
# 2 vs 3 was a user decision 2026-10-13 (telegram "have a prune process
# setup in concord to only keep the most recent 2 db backups"). The
# 2-backup retention gives ~hours of rollback window in a normal
# deploy cadence; extend to 3-5 if the offsite backup is broken or
# cadence slows to a few deploys/day.
#
# Install:
#   - This file lives at /Users/dutch/.local/bin/concord-deploy-backup-prune.sh
#   - Wired into launchd via:
#     cp /Users/dutch/concord-cognitive-engine/launchd/com.concord.deploy-backup-prune.plist \
#        /Users/dutch/Library/LaunchAgents/
#     launchctl load /Users/dutch/Library/LaunchAgents/com.concord.deploy-backup-prune.plist
#   - Runs every 30 min (StartInterval: 1800)
#
# Why a separate cron job (not part of the deploy script):
#   - The deploy script runs on a remote agent. Pruning is local Mac work.
#   - A missed run (deploy agent offline, laptop asleep) self-heals on
#     the next 30-min tick.
#   - 30-min cadence is fine-grained enough that a botched deploy
#     doesn't pile up before the prune catches it.

set -u

BACKUP_DIR="/Users/dutch/concord/backups"
KEEP_N=2
LOG_PREFIX="[concord-deploy-backup-prune]"

log() {
  # Log to both stdout and a local file (so we can see runs even when
  # launchd is silent)
  echo "$(date '+%Y-%m-%dT%H:%M:%S%z') $LOG_PREFIX $*" >> /Users/dutch/.zuko/logs/deploy-backup-prune.log
  echo "$LOG_PREFIX $*"
}

# --- Safety: don't run if offsite backup is broken -------------------------
# If offsite backup is failing, the local deploy snapshots are the only
# recent copy of the data. Skipping the prune keeps rollback options open.
# If we kept ALL backups when offsite is broken, we eventually run out of
# disk; the 30-min cadence keeps the failure visible (you'll see "skipped"
# in the log, then act) without making the disk full. Threshold: 2
# consecutive offsite failures in the last 8 hours = broken.
OFFSITE_LOG="/Users/dutch/.zuko/logs/offsite-backup.log"
if [ -f "$OFFSITE_LOG" ]; then
  recent_fails=$(awk '/^[^[]/{next} {ts=$1" "$2; if (ts > since) print}' since="$(date -v-8H '+%Y-%m-%d %H:%M:%S')" "$OFFSITE_LOG" 2>/dev/null | grep -c "FAIL: " || true)
  if [ "${recent_fails:-0}" -ge 2 ]; then
    log "SKIP: offsite backup has $recent_fails failures in last 8h; preserving local deploy snapshots"
    exit 0
  fi
fi

# --- Sanity: backup dir must exist ----------------------------------------
if [ ! -d "$BACKUP_DIR" ]; then
  log "SKIP: $BACKUP_DIR does not exist"
  exit 0
fi

# --- Build the deletion list ------------------------------------------------
# Snapshot dirs are named YYYYMMDD-HHMM-deploy-<name>; sort by the
# timestamp prefix descending and keep the top KEEP_N.
shopt -s nullglob
all_snaps=( "$BACKUP_DIR"/*/ )
shopt -u nullglob

# Filter to only deploy snapshots (timestamp-deploy-* pattern)
deploy_snaps=()
for d in "${all_snaps[@]}"; do
  [ -d "$d" ] || continue
  name=$(basename "$d")
  if [[ "$name" =~ ^[0-9]{8}-[0-9]{4}-deploy- ]]; then
    deploy_snaps+=( "$d" )
  fi
done

if [ "${#deploy_snaps[@]}" -le "$KEEP_N" ]; then
  log "OK: ${#deploy_snaps[@]} deploy snapshots present (<= $KEEP_N, nothing to prune)"
  exit 0
fi

# Sort descending (newest first). The timestamp prefix sorts correctly
# because the names are zero-padded.
IFS=$'\n' sorted=($(printf '%s\n' "${deploy_snaps[@]}" | sort -r))
unset IFS

# Skip the first KEEP_N (those are the ones we keep); delete the rest.
to_delete=( "${sorted[@]:$KEEP_N}" )

log "PRUNE: ${#deploy_snaps[@]} snapshots present, keeping $KEEP_N, deleting ${#to_delete[@]}"

deleted=0
for d in "${to_delete[@]}"; do
  if rm -rf "$d" 2>/dev/null; then
    log "  deleted: $(basename "$d")"
    deleted=$((deleted + 1))
  else
    log "  FAILED to delete: $(basename "$d")"
  fi
done

log "DONE: deleted $deleted of ${#to_delete[@]} candidates"
