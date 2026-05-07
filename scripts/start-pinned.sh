#!/bin/bash
# ============================================================================
# Concord Cognitive Engine — CPU-Pinned Startup (4-Core RunPod)
# ============================================================================
#
# Assigns dedicated cores to each process so they never compete:
#
#   Core 0-1  →  Ollama (GPU inference dispatch — these cores just manage GPU calls)
#   Core 2    →  Node.js backend (API, routes, WebSocket, feed manager)
#   Core 3    →  Reserved for cognitive worker thread (heartbeat, autogen, dreams)
#
# The cognitive worker is a Node worker_thread, so it inherits the parent
# process affinity. We set CONCORD_WORKER_CORES=3 so the backend can pin
# the worker thread via taskset after spawn (or the OS scheduler isolates it).
#
# Usage:
#   ./scripts/start-pinned.sh              # Start everything
#   ./scripts/start-pinned.sh --no-ollama  # Skip Ollama (already running)
#   OLLAMA_MODEL=qwen2.5:14b ./scripts/start-pinned.sh  # Override model
#
# ============================================================================

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Configuration ──────────────────────────────────────────
OLLAMA_PORT="${OLLAMA_PORT:-11434}"
OLLAMA_CORES="0,1"
NODE_CORES="2"
WORKER_CORES="3"

# Models — override via env vars
OLLAMA_MODEL="${OLLAMA_MODEL:-qwen2.5:7b}"
SUBCONSCIOUS_MODEL="${SUBCONSCIOUS_MODEL:-qwen2.5:1.5b}"

NODE_PORT="${PORT:-5050}"
LOG_DIR="${LOG_DIR:-/var/log/concord}"
SKIP_OLLAMA=false

# Parse args
for arg in "$@"; do
  case $arg in
    --no-ollama) SKIP_OLLAMA=true ;;
    --help|-h)
      echo "Usage: $0 [--no-ollama]"
      echo "  --no-ollama  Skip Ollama startup (if already running)"
      echo ""
      echo "Environment variables:"
      echo "  OLLAMA_MODEL       Primary model (default: qwen2.5:7b)"
      echo "  SUBCONSCIOUS_MODEL Background model (default: qwen2.5:1.5b)"
      echo "  OLLAMA_PORT        Ollama port (default: 11434)"
      echo "  PORT               Node.js port (default: 5050)"
      echo "  LOG_DIR            Log directory (default: /var/log/concord)"
      exit 0
      ;;
  esac
done

mkdir -p "$LOG_DIR"

# ── Helpers ────────────────────────────────────────────────
log() {
  echo "[concord] $(date '+%H:%M:%S') $1"
}

check_cores() {
  local available
  available=$(nproc 2>/dev/null || echo 1)
  if [ "$available" -lt 4 ]; then
    log "WARNING: Only ${available} cores available. Pinning may overlap."
    log "  Falling back to unpinned mode for processes that exceed core count."
    # Adjust: give everything all cores
    OLLAMA_CORES="0-$((available - 1))"
    NODE_CORES="0-$((available - 1))"
    WORKER_CORES="0-$((available - 1))"
  fi
  log "CPU cores available: ${available}"
}

wait_for_port() {
  local port=$1 name=$2 max=${3:-30} attempt=0
  while [ $attempt -lt $max ]; do
    if curl -sf "http://localhost:${port}/" > /dev/null 2>&1 || \
       curl -sf "http://localhost:${port}/api/tags" > /dev/null 2>&1; then
      log "${name} ready on port ${port}"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  log "WARNING: ${name} not responding on port ${port} after ${max}s"
  return 1
}

# ── Cleanup on exit ───────────────────────────────────────
PIDS=()
cleanup() {
  log "Shutting down..."
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null
      log "  Stopped PID $pid"
    fi
  done
  wait 2>/dev/null
  log "All processes stopped."
}
trap cleanup SIGTERM SIGINT EXIT

# ── Start ─────────────────────────────────────────────────
log "============================================"
log "  CONCORD — CPU-Pinned Startup"
log "============================================"

check_cores

# ── 1. Ollama (Cores 0-1) ────────────────────────────────
if [ "$SKIP_OLLAMA" = false ]; then
  # Kill any existing Ollama
  pkill -f "ollama serve" 2>/dev/null || true
  sleep 1

  log "Starting Ollama on cores ${OLLAMA_CORES}, port ${OLLAMA_PORT}..."
  OLLAMA_HOST="127.0.0.1:${OLLAMA_PORT}" \
  OLLAMA_NUM_PARALLEL=2 \
  OLLAMA_MAX_LOADED_MODELS=2 \
    taskset -c "${OLLAMA_CORES}" ollama serve \
    > "${LOG_DIR}/ollama.log" 2>&1 &
  PIDS+=($!)
  log "  Ollama PID: ${PIDS[-1]}"

  wait_for_port "${OLLAMA_PORT}" "Ollama"

  # Pull primary model (if not already present)
  log "Ensuring model ${OLLAMA_MODEL} is available..."
  OLLAMA_HOST="127.0.0.1:${OLLAMA_PORT}" ollama pull "${OLLAMA_MODEL}" 2>&1 | tail -1 || true

  # Pull embedding model
  log "Ensuring embedding model is available..."
  OLLAMA_HOST="127.0.0.1:${OLLAMA_PORT}" ollama pull nomic-embed-text 2>&1 | tail -1 || true
else
  log "Skipping Ollama (--no-ollama flag)"
fi

# ── 2. Node.js Backend (Core 2) ──────────────────────────
log "Starting Node.js backend on core ${NODE_CORES}, port ${NODE_PORT}..."

# Export worker core hint so the backend can pin its cognitive worker
export CONCORD_WORKER_CORES="${WORKER_CORES}"

# Brain URLs — single Ollama instance serves all models
export BRAIN_CONSCIOUS_URL="http://localhost:${OLLAMA_PORT}"
export BRAIN_CONSCIOUS_MODEL="${OLLAMA_MODEL}"
export BRAIN_SUBCONSCIOUS_URL="http://localhost:${OLLAMA_PORT}"
export BRAIN_SUBCONSCIOUS_MODEL="${SUBCONSCIOUS_MODEL}"
export BRAIN_UTILITY_URL="http://localhost:${OLLAMA_PORT}"
export BRAIN_UTILITY_MODEL="${SUBCONSCIOUS_MODEL}"
export BRAIN_REPAIR_URL="http://localhost:${OLLAMA_PORT}"
export BRAIN_REPAIR_MODEL="qwen2.5:0.5b"
export OLLAMA_HOST="http://localhost:${OLLAMA_PORT}"

cd server
taskset -c "${NODE_CORES}" node server.js \
  > "${LOG_DIR}/node-backend.log" 2>&1 &
PIDS+=($!)
NODE_PID=${PIDS[-1]}
cd ..
log "  Node.js PID: ${NODE_PID} (cognitive worker will inherit, target core ${WORKER_CORES})"

wait_for_port "${NODE_PORT}" "Node.js backend" 20

# ── 3. Status Report ─────────────────────────────────────
log ""
log "============================================"
log "  ALL PROCESSES PINNED AND RUNNING"
log "============================================"
log ""
log "  Core 0-1  →  Ollama (${OLLAMA_MODEL})"
log "  Core 2    →  Node.js backend (port ${NODE_PORT})"
log "  Core 3    →  Cognitive worker (heartbeat, autogen)"
log ""
log "  Ollama:   http://localhost:${OLLAMA_PORT}"
log "  Backend:  http://localhost:${NODE_PORT}"
log "  Logs:     ${LOG_DIR}/"
log ""
log "  PIDs: ${PIDS[*]}"
log "============================================"
log ""
log "Press Ctrl+C to stop all processes."

# ── Wait for any process to exit ──────────────────────────
wait -n "${PIDS[@]}" 2>/dev/null || true
EXIT_PID=$?
log "A process exited (code: ${EXIT_PID}). Shutting down..."
