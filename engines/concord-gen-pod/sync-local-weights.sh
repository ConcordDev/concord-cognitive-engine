#!/bin/bash
# 2026-10-19 (pod-restore-1019 leak fix): copy gen-server weights from /workspace (geesefs, ~85 MB/s cold)
# to the container disk so a gen-server restart loads in ~1 min instead of 4.5-16 min.
# Idempotent; the .concord_complete marker is copied LAST, and concord_gen_server.py only uses the
# local copy when that marker exists (CONCORD_GEN_LOCAL_MODELS, default /root/gen/models-local).
# Needs ~36 GB free on /. Run by /workspace/pod-autostart.sh after a pod reset. Log: /workspace/logs/sync-local-weights.log
SRC=/workspace/models; DST=${CONCORD_GEN_LOCAL_MODELS:-/root/gen/models-local}
exec >>/workspace/logs/sync-local-weights.log 2>&1
exec 9>/tmp/sync-local-weights.lock; flock -n 9 || { echo "$(date -u +%FT%TZ) already running"; exit 0; }
for R in black-forest-labs/FLUX.1-schnell microsoft/TRELLIS-image-large; do
  [ -f "$DST/$R/.concord_complete" ] && { echo "$(date -u +%FT%TZ) $R already local"; continue; }
  need=$(du -sm --exclude=schnell_grid.jpeg "$SRC/$R" | cut -f1); free=$(df -m --output=avail / | tail -1)
  [ "$free" -gt $((need + 8000)) ] || { echo "$(date -u +%FT%TZ) $R skipped: need ${need}MB + 8GB, free ${free}MB"; continue; }
  echo "$(date -u +%FT%TZ) copying $R (${need} MB)"; t=$(date +%s); mkdir -p "$DST/$R"
  rsync -r --size-only --no-perms --no-owner --no-group --exclude=.concord_complete --exclude=schnell_grid.jpeg "$SRC/$R/" "$DST/$R/" \
    && cp "$SRC/$R/.concord_complete" "$DST/$R/.concord_complete" && echo "$(date -u +%FT%TZ) $R done in $(( $(date +%s) - t ))s" \
    || echo "$(date -u +%FT%TZ) $R copy FAILED"
done
