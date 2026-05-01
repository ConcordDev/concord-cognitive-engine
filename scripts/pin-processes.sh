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
# Layout (scales with core count):
#   Ollama:   first 50% — GPU dispatch threads saturate these
#   Backend:  next 39%  — Node event loop + cognitive worker threads
#   Frontend: last 11%  — lightweight Next.js (min 1 core)
#
# RTX Pro 4500 example (28 vCPU):
#   Ollama:   0-13  (14 cores)
#   Backend:  14-24 (11 cores)
#   Frontend: 25-27  (3 cores)

HALF=$((TOTAL / 2))
FRONTEND_COUNT=$((TOTAL / 9))
[ "$FRONTEND_COUNT" -lt 1 ] && FRONTEND_COUNT=1
FRONTEND_START=$((TOTAL - FRONTEND_COUNT))
BACKEND_END=$((FRONTEND_START - 1))

OLLAMA_CORES="0-$((HALF - 1))"
BACKEND_CORES="${HALF}-${BACKEND_END}"
FRONTEND_CORES="${FRONTEND_START}-$((TOTAL - 1))"

# Edge case guards
[ "$HALF" -ge "$BACKEND_END" ] && BACKEND_CORES="$HALF"
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
