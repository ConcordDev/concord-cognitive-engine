#!/usr/bin/env bash
# /Users/dutch/.local/bin/concord-deploy-backup-prune.sh
#
# Prune old deploy DB snapshots in /Users/dutch/concord/backups/.
#
# Each Concord deploy creates a timestamped snapshot there, e.g.:
#   /Users/dutch/concord/backups/YYYYMMDD-HHMM-deploy-<name>/
#   /Users/dutch/concord/backups/YYYYMMDD-deploy/
# Each contains a full copy of the live DB (9 GB+) plus plist + git refs.
# Without pruning, this dir grows ~9 GB per deploy.
#
# Policy: keep the KEEP_N (default 2) most recent *-deploy* dirs. Delete older
# matching deploy snapshots only. Never touch non-deploy dirs.
#
# macOS /bin/bash is 3.2. This script must stay 3.2-safe under `set -u`
# (empty arrays + "${arr[@]}" used to unbound-variable-spam after the dir
# was emptied by disk-space-reclaim.sh on 2026-10-14).
#
# Install:
#   cp scripts/concord-deploy-backup-prune.sh /Users/dutch/.local/bin/
#   cp launchd/com.concord.deploy-backup-prune.plist ~/Library/LaunchAgents/
#   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.concord.deploy-backup-prune.plist
#
# DRY_RUN=1 skips deletes (for tests). BACKUP_DIR / KEEP_N overridable for tests.

set -u

BACKUP_DIR="${BACKUP_DIR:-/Users/dutch/concord/backups}"
KEEP_N="${KEEP_N:-2}"
DRY_RUN="${DRY_RUN:-0}"
LOG_PREFIX="[concord-deploy-backup-prune]"
# Default log path; override in tests so we do not spam the real log.
PRUNE_LOG="${PRUNE_LOG:-/Users/dutch/.zuko/logs/deploy-backup-prune.log}"

log() {
  # Best-effort file log (dir may be missing in tests)
  if [ -n "${PRUNE_LOG}" ]; then
    mkdir -p "$(dirname "$PRUNE_LOG")" 2>/dev/null || true
    echo "$(date '+%Y-%m-%dT%H:%M:%S%z') $LOG_PREFIX $*" >> "$PRUNE_LOG" 2>/dev/null || true
  fi
  echo "$LOG_PREFIX $*"
}


# Deploy snapshot names only:
#   YYYYMMDD-HHMM-deploy-<name>  (classic)
#   YYYYMMDD-deploy              (short, e.g. 20261015-deploy)
# Reject other *-deploy* names (e.g. pre-sweep-deploy-*.next).
is_deploy_snap_name() {
  case "$1" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-deploy) return 0 ;;
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]-deploy) return 0 ;;
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9]-deploy-*) return 0 ;;
    *) return 1 ;;
  esac
}

# Refuse nonsensical retention (never delete everything by accident).
case "$KEEP_N" in
  ''|*[!0-9]*)
    log "FAIL: KEEP_N must be a non-negative integer (got: $KEEP_N)"
    exit 1
    ;;
esac
if [ "$KEEP_N" -lt 1 ]; then
  log "FAIL: KEEP_N must be >= 1 (got: $KEEP_N); refusing to run"
  exit 1
fi

# --- Safety: don't run if offsite backup is broken -------------------------
# Empty OFFSITE_LOG disables the check (tests).
OFFSITE_LOG="${OFFSITE_LOG-/Users/dutch/.zuko/logs/offsite-backup.log}"
if [ -n "$OFFSITE_LOG" ] && [ -f "$OFFSITE_LOG" ]; then
  # Count FAIL lines in the last 8 hours. Prefer GNU/BSD date -v; fall back open.
  since="$(date -v-8H '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -d '8 hours ago' '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo '')"
  recent_fails=0
  if [ -n "$since" ]; then
    recent_fails=$(awk -v since="$since" '
      /FAIL: / {
        # log lines look like: 2026-10-14 20:53:35 EDT [offsite ...] FAIL: ...
        ts = $1 " " $2
        if (ts >= since) c++
      }
      END { print c+0 }
    ' "$OFFSITE_LOG" 2>/dev/null || echo 0)
  fi
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

# --- Collect deploy snapshot dirs only ------------------------------------
# Match names containing "-deploy" (e.g. 20261012-1404-deploy-pr1200,
# 20261015-deploy). Do NOT use nullglob + empty "${arr[@]}" under bash 3.2
# set -u (that was the unbound-variable spam).
# Bash 3.2: a non-matching glob stays literal; [ -d ] then fails and we skip.
deploy_snaps=""
deploy_count=0
for d in "$BACKUP_DIR"/*; do
  # Literal unmatched glob, or non-directory
  [ -d "$d" ] || continue
  name=$(basename "$d")
  if ! is_deploy_snap_name "$name"; then
    continue
  fi
  # Newline-separated list (paths have no newlines)
  if [ -z "$deploy_snaps" ]; then
    deploy_snaps="$d"
  else
    deploy_snaps="$deploy_snaps
$d"
  fi
  deploy_count=$((deploy_count + 1))
done

# HARD SAFETY: never delete when count <= KEEP_N
if [ "$deploy_count" -le "$KEEP_N" ]; then
  log "OK: $deploy_count deploy snapshots present (<= $KEEP_N, nothing to prune)"
  exit 0
fi

# Sort descending (newest first). Timestamp prefixes sort correctly when
# zero-padded / ISO-like.
sorted=$(printf '%s\n' "$deploy_snaps" | sort -r)

# Skip the first KEEP_N; delete the rest. Re-check count before each rm.
to_delete_count=$((deploy_count - KEEP_N))
log "PRUNE: $deploy_count snapshots present, keeping $KEEP_N, deleting $to_delete_count"

deleted=0
idx=0
# Use a temp file so the loop is not a pipeline subshell (bash 3.2).
tmp_sorted=$(mktemp "${TMPDIR:-/tmp}/concord-prune-sorted.XXXXXX") || {
  log "FAIL: mktemp"
  exit 1
}
printf '%s\n' "$sorted" > "$tmp_sorted"

while IFS= read -r d || [ -n "$d" ]; do
  [ -n "$d" ] || continue
  idx=$((idx + 1))
  if [ "$idx" -le "$KEEP_N" ]; then
    continue
  fi

  # Re-validate target immediately before delete
  name=$(basename "$d")
  if ! is_deploy_snap_name "$name"; then
    log "  SKIP non-deploy path: $name"
    continue
  fi
  if [ ! -d "$d" ]; then
    log "  SKIP missing: $name"
    continue
  fi
  # Path must remain under BACKUP_DIR
  case "$d" in
    "$BACKUP_DIR"/*)
      ;;
    *)
      log "  SKIP outside BACKUP_DIR: $d"
      continue
      ;;
  esac

  # Recount live deploy dirs; abort if at/under KEEP_N (race / prior delete)
  live=0
  for live_d in "$BACKUP_DIR"/*; do
    [ -d "$live_d" ] || continue
    live_name=$(basename "$live_d")
    if is_deploy_snap_name "$live_name"; then
      live=$((live + 1))
    fi
  done
  if [ "$live" -le "$KEEP_N" ]; then
    log "  STOP: live count $live <= KEEP_N $KEEP_N; refusing further deletes"
    break
  fi

  if [ "$DRY_RUN" = "1" ]; then
    log "  DRY_RUN would delete: $name"
    deleted=$((deleted + 1))
  else
    if rm -rf "$d" 2>/dev/null; then
      log "  deleted: $name"
      deleted=$((deleted + 1))
    else
      log "  FAILED to delete: $name"
    fi
  fi
done < "$tmp_sorted"

rm -f "$tmp_sorted"

log "DONE: deleted $deleted of $to_delete_count candidates (DRY_RUN=$DRY_RUN)"
