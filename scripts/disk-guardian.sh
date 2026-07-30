#!/bin/bash
# Concord Disk Guardian — emergency threshold-triggered cleanup
# Prevents disk from ever reaching 100%
#
# NOTE (2026-07-27 audit): scripts/disk-cleanup.sh is the script startup.sh
# actually installs on a routine 6-hourly cron (see its own header + the
# "Disk cleanup cron" block in startup.sh) and is documented in
# docs/DEPLOYMENT-READINESS.md / docs/SHIP-REFERENCE.md. This script is a
# separate, heavier-handed EMERGENCY tool (threshold-triggered, more
# aggressive Docker image/volume removal) meant for manual/on-call use when
# a box is already critically full — it is intentionally not auto-cron'd
# by startup.sh, since routine automatic pruning of dangling images/volumes
# is a judgment call an operator should make deliberately. Fixed here: the
# hardcoded `/data/artifacts` path (wrong on bare metal — the real path per
# server/lib/artifact-store.js is $ARTIFACT_DIR, or $DATA_DIR/artifacts,
# with a /workspace/concord-data override) and the root-only /var/log
# write target.
#
# Install (manual, on-call use — NOT auto-installed):
#   chmod +x scripts/disk-guardian.sh
#   crontab -e  # add: 0 */6 * * * /path/to/concord-cognitive-engine/scripts/disk-guardian.sh

THRESHOLD=80  # trigger cleanup at 80% usage
LOG="${CONCORD_DISK_GUARDIAN_LOG:-/var/log/disk-guardian.log}"
# Fall back to a location we can actually write to if /var/log isn't
# writable (e.g. running as a non-root user on bare metal).
if ! ( : >> "$LOG" ) 2>/dev/null; then
  LOG="$(cd "$(dirname "$0")/.." && pwd)/logs/disk-guardian.log"
  mkdir -p "$(dirname "$LOG")"
fi

# Real artifact root — mirrors server/lib/artifact-store.js's own
# resolution order (ARTIFACT_DIR env override, then the network-volume
# path if present, then DATA_DIR/artifacts).
if [ -n "${ARTIFACT_DIR:-}" ]; then
  ARTIFACT_ROOT="$ARTIFACT_DIR"
elif [ -d "/workspace/concord-data" ]; then
  ARTIFACT_ROOT="/workspace/concord-data/artifacts"
else
  ARTIFACT_ROOT="${DATA_DIR:-/data}/artifacts"
fi

usage=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
echo "$(date): Disk usage at ${usage}%" >> "$LOG"

if [ "$usage" -lt "$THRESHOLD" ]; then
  echo "$(date): Below threshold, no action needed" >> "$LOG"
  exit 0
fi

echo "$(date): CLEANING — usage ${usage}% exceeds ${THRESHOLD}%" >> "$LOG"

# 1. Docker cleanup (biggest offender)
docker system prune -f >> "$LOG" 2>&1
docker builder prune -af >> "$LOG" 2>&1

# 2. Qdrant snapshot cleanup — keep only latest snapshot per collection
for dir in /var/lib/docker/volumes/*qdrant*/_data/snapshots/*/; do
  if [ -d "$dir" ]; then
    ls -t "$dir"*.snapshot 2>/dev/null | tail -n +2 | xargs rm -f 2>/dev/null
    echo "$(date): Cleaned old snapshots in $dir" >> "$LOG"
  fi
done
# Also check common Qdrant paths
find /root -path "*/snapshots/*.snapshot" -mtime +1 -delete 2>/dev/null
find /opt -path "*/snapshots/*.snapshot" -mtime +1 -delete 2>/dev/null

# 3. Log rotation
journalctl --vacuum-size=100M >> "$LOG" 2>&1
find /var/log -name "*.gz" -delete 2>/dev/null
find /var/log -name "*.1" -delete 2>/dev/null
find /var/log -name "*.old" -delete 2>/dev/null

# 4. npm/node cache
rm -rf /root/.npm/_cacache 2>/dev/null
rm -rf /home/*/.npm/_cacache 2>/dev/null
rm -rf /tmp/npm-* 2>/dev/null

# 5. General temp cleanup
find /tmp -mtime +1 -delete 2>/dev/null

# 6. Concord artifact cleanup — emergency fallback only. The application's
# own reference-counted weekly orphan GC (server/lib/artifact-gc.js,
# server/lib/photo-gc.js) is the correct, safe way to reclaim this space —
# it never touches a file a live DTU still references. This step only
# fires when disk is ALREADY over threshold and only removes files whose
# containing dtuId directory has had zero writes in 7+ days, which is a
# much coarser (and much more dangerous, hence emergency-only) heuristic
# than reference-counting.
find "$ARTIFACT_ROOT" -mtime +7 -type f 2>/dev/null | head -100 | xargs rm -f 2>/dev/null

# Check result
new_usage=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
freed=$((usage - new_usage))
echo "$(date): DONE — freed ${freed}%, now at ${new_usage}%" >> "$LOG"

# If still above 90% after cleanup, emergency measures
if [ "$new_usage" -gt 90 ]; then
  echo "$(date): EMERGENCY — still at ${new_usage}%, removing ALL old Docker images" >> "$LOG"
  docker rmi $(docker images -q --filter "dangling=true") 2>/dev/null
  docker volume rm $(docker volume ls -qf dangling=true) 2>/dev/null

  # Remove all Qdrant snapshots (not just old ones)
  find / -name "*.snapshot" -path "*/qdrant*" -delete 2>/dev/null

  new_usage=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
  echo "$(date): After emergency cleanup: ${new_usage}%" >> "$LOG"
fi

# Keep log from growing forever
tail -500 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
