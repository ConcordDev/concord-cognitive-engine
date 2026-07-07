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

# ── Detect the REAL allowed core set (cgroup-aware) ───────────────────────────
# CRITICAL: `nproc` reports the HOST core count, not the pod's cgroup slice — on RunPod
# it can read 128 while you have ~16, so a 0..nproc-1 layout pins to cores OUTSIDE the
# cpuset and every taskset fails ("Invalid argument"). Read the actual allowed ids from
# /proc/self/status (Cpus_allowed_list). (github.com/moby/moby/issues/43205)
read_allowed_cpus() {
  local spec parts part lo hi i; local -a ids=()
  spec="$(grep -i '^Cpus_allowed_list:' /proc/self/status 2>/dev/null | awk '{print $2}')"
  [ -z "$spec" ] && spec="0-$(( $(nproc 2>/dev/null || echo 4) - 1 ))"
  IFS=',' read -ra parts <<< "$spec"
  for part in "${parts[@]}"; do
    if [[ "$part" == *-* ]]; then lo="${part%-*}"; hi="${part#*-}"; for ((i=lo;i<=hi;i++)); do ids+=("$i"); done
    else ids+=("$part"); fi
  done
  echo "${ids[@]}"
}
ALLOWED=( $(read_allowed_cpus) ); TOTAL=${#ALLOWED[@]}
idslice() { local a=$1 b=$2 out=() i; for ((i=a;i<=b && i<TOTAL;i++)); do out+=("${ALLOWED[$i]}"); done; (IFS=,; echo "${out[*]}"); }
log "Detected $TOTAL allowed CPU cores (cgroup set)"

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
# Layout (index order MUST match runpod-cognition.sh's so the two scripts
# agree even when CONCORD_WORLD_CORES isn't inherited — same formula, same
# ordering, same result): Ollama (low indices, gets the remainder) → Backend/
# world-sim (fixed small count, CONCORD_WORLD_CORE_COUNT) → Frontend (top,
# FRONTEND_CORE_PCT%).
#
# IMPORTANT — worker-thread inheritance: the heartbeat pool (workers/heartbeat-pool.js)
# AND every per-world shard (workers/world-shard.js, spawned on travel when
# CONCORD_SHARD_WORLDS=true) are node:worker_threads of the concord-backend
# process, so they inherit the backend's CPU affinity automatically. Pinning the
# backend therefore isolates the whole sim (main loop + heartbeat pool + N shards)
# from Ollama's dispatch cores — no per-thread taskset needed.
#
# Backend gets a FIXED small slice rather than "the remainder": world-sim work
# (heartbeats + on-demand shards) is bursty/event-driven, not a constant CPU
# hog, and CONCORD_SHARD_WORLDS defaults OFF on a small box anyway (see
# .env.runpod), so there's no standing shard-worker load to size for. Ollama's
# 5 dispatch/tokenization processes get what's left — on a small box that's a
# better trade than starving them for a world-sim band that mostly sits idle.
# Override for your hardware:
#   CONCORD_WORLD_CORE_COUNT=4 FRONTEND_CORE_PCT=10 bash scripts/pin-processes.sh
#
# This deploy's actual box — single A40, 9 vCPU (defaults: world=2, frontend~10%):
#   Ollama:   0-5  (6 cores — 5 dispatch/tokenization processes)
#   Backend:  6-7  (2 cores, fixed — main loop + CONCORD_HEARTBEAT_POOL_SIZE=4
#                   workers; CONCORD_SHARD_WORLDS stays off at this size)
#   Frontend: 8    (1 core)
#
# Bigger-pod example (28 vCPU, world still fixed at 2, frontend ~10%):
#   Ollama:   0-22  (23 cores)
#   Backend:  23-24 (2 cores, fixed — bump CONCORD_WORLD_CORE_COUNT if sharding is on)
#   Frontend: 25-27 (3 cores)

WORLD_COUNT="${CONCORD_WORLD_CORE_COUNT:-2}"
[ "$WORLD_COUNT" -lt 1 ] && WORLD_COUNT=1
[ "$WORLD_COUNT" -gt $((TOTAL - 2)) ] && WORLD_COUNT=$((TOTAL - 2))   # leave >=1 each for ollama+frontend
[ "$WORLD_COUNT" -lt 1 ] && WORLD_COUNT=1
FRONTEND_PCT="${FRONTEND_CORE_PCT:-10}"
FRONTEND_COUNT=$(( TOTAL * FRONTEND_PCT / 100 )); [ "$FRONTEND_COUNT" -lt 1 ] && FRONTEND_COUNT=1
[ $(( WORLD_COUNT + FRONTEND_COUNT )) -ge "$TOTAL" ] && FRONTEND_COUNT=$(( TOTAL - WORLD_COUNT - 1 )); [ "$FRONTEND_COUNT" -lt 1 ] && FRONTEND_COUNT=1
OLLAMA_COUNT=$(( TOTAL - WORLD_COUNT - FRONTEND_COUNT )); [ "$OLLAMA_COUNT" -lt 1 ] && OLLAMA_COUNT=1
BACKEND_END_IDX=$(( OLLAMA_COUNT + WORLD_COUNT - 1 ))

# map index ranges onto the ACTUAL allowed core ids (taskset -c accepts the comma list)
# honor the band runpod-cognition.sh already computed + exported, so the two scripts agree.
OLLAMA_CORES="$(idslice 0 $((OLLAMA_COUNT - 1)))"
BACKEND_CORES="${CONCORD_WORLD_CORES:-$(idslice "$OLLAMA_COUNT" "$BACKEND_END_IDX")}"
FRONTEND_CORES="$(idslice $((BACKEND_END_IDX + 1)) $((TOTAL - 1)))"

log "Core allocation (cgroup-allowed ids):"
log "  Ollama:   cores $OLLAMA_CORES"
log "  Backend:  cores $BACKEND_CORES${CONCORD_WORLD_CORES:+  (from CONCORD_WORLD_CORES)}"
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
