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
# Ollama gets the first half — GPU dispatch threads need the most cores
# Backend gets the middle slice — Node.js event loop is single-threaded but
#   worker threads (cognitive worker) need extra cores
# Frontend gets the last 1-2 cores — lightweight Next.js serving

HALF=$((TOTAL / 2))
BACKEND_END=$((TOTAL - 2))
FRONTEND_START=$((TOTAL - 2))
FRONTEND_END=$((TOTAL - 1))

OLLAMA_CORES="0-$((HALF - 1))"
BACKEND_CORES="${HALF}-${BACKEND_END}"
FRONTEND_CORES="${FRONTEND_START}-${FRONTEND_END}"

# Single-core edge case
[ "$BACKEND_CORES" = "$OLLAMA_CORES" ] && BACKEND_CORES="$HALF"
[ "$FRONTEND_CORES" = "$BACKEND_CORES" ] && FRONTEND_CORES="$((TOTAL - 1))"

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
