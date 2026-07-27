#!/bin/bash
# Disk Cleanup — run after every deploy and on cron
#
# Bare-metal fix (2026-07-27 audit): this script was 100% docker-shaped
# (every step guarded behind `docker volume inspect`/`docker system prune`,
# which silently no-op on a bare-metal/pm2 box — the real deploy path per
# CLAUDE.md's "Heap & cap tuning" section: `pm2 start ecosystem.config.cjs
# --env runpod`). It was also never actually installed anywhere — only
# mentioned in docs (docs/DEPLOYMENT-READINESS.md, docs/SHIP-REFERENCE.md).
# Fixed both: added real bare-metal steps below (logs/*.log rotation for
# the files startup.sh's own cron jobs append to forever, npm cache,
# general /tmp), and startup.sh now installs this on the same 6-hourly cron
# pattern as its health-check/db-backup jobs.
#
# Docker steps are still here (harmless no-ops when docker isn't present —
# `docker: command not found` is caught by `|| true`) for docker-compose
# deployments, which remain a valid path per CLAUDE.md's "Full stack
# (Docker)" section.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "[disk-cleanup] Starting cleanup at $(date)"

# Docker cleanup: remove dangling images, stopped containers, unused networks
# NEVER use --volumes here — it destroys unnamed volumes regardless of filter.
# Named volumes (concord-data, ollama-*-data, etc.) are safe, but --volumes
# with prune is too dangerous for production state.
if command -v docker &>/dev/null; then
  docker system prune -f --filter "until=48h" 2>/dev/null || true
  docker builder prune -f --filter "until=48h" 2>/dev/null || true
fi

# Journal vacuum (root-only; no-ops harmlessly otherwise)
journalctl --vacuum-size=100M 2>/dev/null || true

# Log rotation cleanup — docker-container log dir, if present.
CONCORD_LOG_DIR="${CONCORD_LOG_DIR:-/var/log/concord}"
if [ -d "$CONCORD_LOG_DIR" ]; then
  find "$CONCORD_LOG_DIR" -name "*.gz" -delete 2>/dev/null || true
  find "$CONCORD_LOG_DIR" -name "*.1" -delete 2>/dev/null || true
fi

# Bare-metal log rotation — startup.sh's own cron jobs
# (health-check.sh, db-backup.sh, this script) all append to
# $SCRIPT_DIR/logs/*.log forever via `>> logs/foo.log 2>&1`; nothing else
# ever truncates them. Keep the tail of any file over 20MB.
BARE_METAL_LOG_DIR="$SCRIPT_DIR/logs"
if [ -d "$BARE_METAL_LOG_DIR" ]; then
  for f in "$BARE_METAL_LOG_DIR"/*.log; do
    [ -e "$f" ] || continue
    size=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null || echo 0)
    if [ "$size" -gt 20971520 ]; then
      tail -c 5242880 "$f" > "$f.tmp" 2>/dev/null && mv "$f.tmp" "$f" \
        && echo "[disk-cleanup] Truncated $f (was $(( size / 1048576 ))MB)"
    fi
  done
fi

# npm/node cache — safe on both docker and bare metal.
rm -rf "${HOME:-/root}/.npm/_cacache" 2>/dev/null || true
rm -rf /tmp/npm-* 2>/dev/null || true

# General stale temp files (>1 day old).
find /tmp -maxdepth 1 -mtime +1 -type f -delete 2>/dev/null || true

# Qdrant snapshot bomb prevention — prune if snapshots exceed 25GB
QDRANT_DIR=$(docker volume inspect concord_qdrant_data -f '{{.Mountpoint}}' 2>/dev/null || echo "")
if [ -n "$QDRANT_DIR" ] && [ -d "$QDRANT_DIR/snapshots" ]; then
  SNAP_SIZE=$(du -sb "$QDRANT_DIR/snapshots" 2>/dev/null | cut -f1)
  if [ "${SNAP_SIZE:-0}" -gt 25000000000 ]; then
    rm -rf "$QDRANT_DIR/snapshots"/*
    echo "[disk-cleanup] Pruned Qdrant snapshots (was $(( SNAP_SIZE / 1000000000 ))GB)"
  fi
fi

# Prometheus data check — warn if over 10GB
PROM_DIR=$(docker volume inspect concord_prometheus_data -f '{{.Mountpoint}}' 2>/dev/null || echo "")
if [ -n "$PROM_DIR" ] && [ -d "$PROM_DIR" ]; then
  PROM_SIZE=$(du -sb "$PROM_DIR" 2>/dev/null | cut -f1)
  if [ "${PROM_SIZE:-0}" -gt 10000000000 ]; then
    echo "[disk-cleanup] WARNING: Prometheus data is $(( PROM_SIZE / 1000000000 ))GB — consider reducing retention"
  fi
fi

# Ollama model cache cleanup (docker) — remove orphan partial-download blobs
for vol in concord_ollama-conscious-data concord_ollama-subconscious-data concord_ollama-utility-data concord_ollama-repair-data; do
  OLLAMA_DIR=$(docker volume inspect "$vol" -f '{{.Mountpoint}}' 2>/dev/null || echo "")
  if [ -n "$OLLAMA_DIR" ] && [ -d "$OLLAMA_DIR/models/blobs" ]; then
    # Clean orphan temp files older than 2 days
    find "$OLLAMA_DIR/models/blobs" -name "sha256-*-partial-*" -mtime +2 -delete 2>/dev/null || true
  fi
done

# Ollama model cache cleanup (bare metal) — same narrow orphan-blob cleanup,
# for the 5-brain-on-one-box RunPod/pm2 deploy where Ollama isn't in a
# docker volume at all. Respects OLLAMA_MODELS if the operator set it
# (matches Ollama's own env var), else its real default.
BARE_METAL_OLLAMA_DIR="${OLLAMA_MODELS:-${HOME:-/root}/.ollama/models}"
if [ -d "$BARE_METAL_OLLAMA_DIR/blobs" ]; then
  find "$BARE_METAL_OLLAMA_DIR/blobs" -name "sha256-*-partial-*" -mtime +2 -delete 2>/dev/null || true
fi

echo "[disk-cleanup] Disk after cleanup:"
df -h / 2>/dev/null || df -h
echo "[disk-cleanup] Done at $(date)"
