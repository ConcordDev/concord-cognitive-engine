#!/bin/bash
# scripts/pin-processes.sh — CPU affinity pinning for Concord on RunPod/bare-metal
#
# Pins each pm2-managed process to dedicated CPU cores so Ollama, the backend,
# and the frontend never compete for the same cores.
#
# Usage (run after pm2 start):
#   bash scripts/pin-processes.sh
#
# Requires: taskset (part of util-linux, pre-installed on most Linux distros)

set -euo pipefail

log() { echo "[pin] $*"; }

# ── Detect core count ─────────────────────────────────────────────────────────
TOTAL=$(nproc)
log "Detected $TOTAL CPU cores"

if [ "$TOTAL" -lt 4 ]; then
  log "WARNING: Only $TOTAL cores — skipping pinning (need at least 4)"
  exit 0
fi

if ! command -v taskset &>/dev/null; then
  log "WARNING: taskset not found — skipping CPU pinning"
  log "  Install: apt-get install util-linux"
  exit 0
fi

# ── Core allocation ───────────────────────────────────────────────────────────
# Layout (scales with core count), tunable via env percentages:
#   Ollama:   first OLLAMA_CORE_PCT%   — GPU dispatch threads
#   Backend:  the middle remainder     — Node event loop + ALL its worker threads
#   Frontend: last FRONTEND_CORE_PCT%  — lightweight Next.js (min 1 core)
#
# IMPORTANT — worker-thread inheritance: the heartbeat pool (workers/heartbeat-pool.js)
# AND every per-world shard (workers/world-shard.js, spawned on travel when
# CONCORD_SHARD_WORLDS=true) are node:worker_threads of the concord-backend
# process, so they inherit the backend's CPU affinity automatically. Pinning the
# backend therefore isolates the whole sim (main loop + heartbeat pool + N shards)
# from Ollama's dispatch cores — no per-thread taskset needed. Because the sim now
# runs IN those threads, give the backend the largest share: with sharding active
# the backend wants enough cores for main + up-to-8 heartbeat workers + N shards.
#
# Defaults: Ollama 35% (GPU does inference; Ollama CPU is just dispatch — it does
# NOT need half the cores), backend the remainder, frontend ~10%. Override the
# split for your hardware:
#   OLLAMA_CORE_PCT=25 FRONTEND_CORE_PCT=10 bash scripts/pin-processes.sh
# On a single-Ollama RunPod box, a smaller Ollama share + a bigger backend share
# is the right call for the sharded workload.
#
# RTX Pro 4500 example (28 vCPU, defaults 35/–/10):
#   Ollama:   0-9   (10 cores)
#   Backend:  10-24 (15 cores — main loop + heartbeat pool + world shards)
#   Frontend: 25-27 (3 cores)

OLLAMA_PCT="${OLLAMA_CORE_PCT:-35}"
FRONTEND_PCT="${FRONTEND_CORE_PCT:-10}"

OLLAMA_COUNT=$(( TOTAL * OLLAMA_PCT / 100 ))
[ "$OLLAMA_COUNT" -lt 1 ] && OLLAMA_COUNT=1
FRONTEND_COUNT=$(( TOTAL * FRONTEND_PCT / 100 ))
[ "$FRONTEND_COUNT" -lt 1 ] && FRONTEND_COUNT=1
FRONTEND_START=$((TOTAL - FRONTEND_COUNT))
BACKEND_END=$((FRONTEND_START - 1))

OLLAMA_CORES="0-$((OLLAMA_COUNT - 1))"
BACKEND_CORES="${OLLAMA_COUNT}-${BACKEND_END}"
FRONTEND_CORES="${FRONTEND_START}-$((TOTAL - 1))"

# Edge case guards
[ "$OLLAMA_COUNT" -ge "$BACKEND_END" ] && BACKEND_CORES="$OLLAMA_COUNT"
[ "$FRONTEND_START" -gt "$((TOTAL - 1))" ] && FRONTEND_CORES="$((TOTAL - 1))"

log "Core allocation:"
log "  Ollama:   cores $OLLAMA_CORES"
log "  Backend:  cores $BACKEND_CORES"
log "  Frontend: cores $FRONTEND_CORES"

# ── Pin each process ──────────────────────────────────────────────────────────
pin_process() {
  local name="$1"
  local cores="$2"

  # Get PID from pm2
  local pid
  pid=$(pm2 pid "$name" 2>/dev/null | tr -d '[:space:]')

  if [ -z "$pid" ] || [ "$pid" = "0" ] || ! [[ "$pid" =~ ^[0-9]+$ ]]; then
    log "SKIP $name — not running or PID not found"
    return
  fi

  if taskset -cp "$cores" "$pid" &>/dev/null; then
    log "OK   $name (PID $pid) → cores $cores"
  else
    log "FAIL $name (PID $pid) — taskset returned non-zero (may need root)"
  fi
}

pin_process "ollama"           "$OLLAMA_CORES"
pin_process "concord-backend"  "$BACKEND_CORES"
pin_process "concord-frontend" "$FRONTEND_CORES"

log ""
log "CPU pinning complete. Verify with: taskset -cp <pid>"
log "Re-run this script after pm2 restarts a process."
