#!/bin/bash
# startup.sh — Concord Cognitive Engine startup script
# Survives pod restart. Handles: dependency checks, state recovery, service start.
#
# Usage:
#   ./startup.sh              # Auto-detect: RunPod (pm2) or Docker Compose
#   ./startup.sh --runpod     # RunPod / bare-metal with pm2
#   ./startup.sh --dev        # Dev mode (direct node, no pm2)
#   ./startup.sh --recover    # Recovery mode (restore from latest backup)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

LOG_FILE="./logs/startup.log"
mkdir -p logs

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE"; }

log "=== Concord Cognitive Engine Startup ==="
log "Mode: ${1:-auto}"
log "Working directory: $(pwd)"

# ── Auto-detect RunPod ────────────────────────────────────────────────────────
IS_RUNPOD=false
if [ -n "${RUNPOD_POD_ID:-}" ] || [ -n "${RUNPOD_PUBLIC_IP:-}" ]; then
  IS_RUNPOD=true
fi
if [ "${1:-}" = "--runpod" ]; then IS_RUNPOD=true; fi

# ── Load .env ─────────────────────────────────────────────────────────────────
if [ -f .env ]; then
  set -a; source .env; set +a
  log "Loaded .env"
elif [ -f .env.runpod ] && $IS_RUNPOD; then
  log "No .env found — using .env.runpod as template. Please copy and configure:"
  log "  cp .env.runpod .env && nano .env"
  exit 1
else
  log "WARNING: No .env file found. Copy .env.runpod (RunPod) or .env.example to .env"
fi

# ── RunPod: auto-fill ALLOWED_ORIGINS from RUNPOD_PUBLIC_URL ─────────────────
if $IS_RUNPOD && [ -n "${RUNPOD_PUBLIC_URL:-}" ]; then
  # Strip trailing slash
  BASE_URL="${RUNPOD_PUBLIC_URL%/}"
  export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-$BASE_URL}"
  export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-$BASE_URL}"
  export NEXT_PUBLIC_SOCKET_URL="${NEXT_PUBLIC_SOCKET_URL:-$BASE_URL}"
  # Cookie domain = hostname only
  DOMAIN=$(echo "$BASE_URL" | sed 's|https\?://||' | cut -d'/' -f1)
  export COOKIE_DOMAIN="${COOKIE_DOMAIN:-$DOMAIN}"
  log "RunPod URL: $BASE_URL (domain: $DOMAIN)"
fi

# ── Recovery mode ─────────────────────────────────────────────────────────────
if [ "${1:-}" = "--recover" ]; then
  log "Recovery mode: restoring from latest backup..."
  BACKUP_DIR="./server/data/backups"
  if [ -d "$BACKUP_DIR" ]; then
    LATEST=$(ls -t "$BACKUP_DIR"/*.json 2>/dev/null | head -1)
    if [ -n "$LATEST" ]; then
      cp "$LATEST" "./server/data/concord_state.json"
      log "Restored from: $LATEST"
    else
      log "No backups found in $BACKUP_DIR"
    fi
  fi
fi

# ── Dev mode ──────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--dev" ]; then
  log "Starting in dev mode..."
  [ ! -d server/node_modules ] && (cd server && npm install)
  [ ! -d concord-frontend/node_modules ] && (cd concord-frontend && npm install)

  (cd server && node server.js) &
  SERVER_PID=$!
  (cd concord-frontend && npm run dev) &
  FRONTEND_PID=$!

  log "Backend: http://localhost:5050  Frontend: http://localhost:3000"
  trap "kill $SERVER_PID $FRONTEND_PID 2>/dev/null; wait" SIGTERM SIGINT
  wait
  exit 0
fi

# ── RunPod / bare-metal: pm2 ──────────────────────────────────────────────────
if $IS_RUNPOD || [ "${1:-}" = "--runpod" ]; then
  log "Starting with pm2 (RunPod / bare-metal)..."

  # Check pm2 installed
  if ! command -v pm2 &>/dev/null; then
    log "pm2 not found — installing..."
    npm install -g pm2
  fi

  # Check Ollama installed
  if ! command -v ollama &>/dev/null; then
    log "ERROR: Ollama not found. Install from https://ollama.com/download"
    exit 1
  fi

  # Ensure log dir exists
  mkdir -p logs

  # Install deps if needed
  [ ! -d server/node_modules ] && { log "Installing server deps..."; (cd server && npm install --production); }

  # Build frontend if needed
  if [ ! -d concord-frontend/.next/standalone ]; then
    log "Building frontend..."
    (cd concord-frontend && npm install && npm run build)
  fi

  # Start or restart with RunPod env
  if pm2 list | grep -q "concord-backend"; then
    log "Restarting existing pm2 processes..."
    pm2 restart ecosystem.config.cjs --env runpod
  else
    log "Starting pm2 processes..."
    pm2 start ecosystem.config.cjs --env runpod
    pm2 save
  fi

  # Wait for backend health
  log "Waiting for backend to be healthy..."
  RETRIES=30
  while [ $RETRIES -gt 0 ]; do
    if curl -sf http://localhost:5050/health >/dev/null 2>&1; then
      log "Backend healthy!"
      break
    fi
    RETRIES=$((RETRIES - 1))
    sleep 3
  done

  [ $RETRIES -eq 0 ] && log "WARNING: Backend did not become healthy — check: pm2 logs concord-backend"

  log ""
  log "=== Concord is running ==="
  log "  Backend:  http://localhost:5050"
  log "  Frontend: http://localhost:3000"
  [ -n "${RUNPOD_PUBLIC_URL:-}" ] && log "  Public:   ${RUNPOD_PUBLIC_URL}"
  log ""
  log "  pm2 status:  pm2 list"
  log "  pm2 logs:    pm2 logs"
  log "  pm2 stop:    pm2 stop all"
  log ""

  pm2 list
  exit 0
fi

# ── Docker Compose (default) ──────────────────────────────────────────────────
if command -v docker compose &>/dev/null 2>&1; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
else
  log "ERROR: Docker Compose not found."
  log "  RunPod users: ./startup.sh --runpod"
  log "  Local dev:    ./startup.sh --dev"
  exit 1
fi

log "Starting with $COMPOSE_CMD..."
mkdir -p "${DATA_DIR:-/data}/db" "${DATA_DIR:-/data}/backups" 2>/dev/null || true
$COMPOSE_CMD pull --quiet 2>/dev/null || log "Image pull skipped"
$COMPOSE_CMD up -d --remove-orphans

log "Waiting for backend health..."
RETRIES=30
while [ $RETRIES -gt 0 ]; do
  if curl -sf http://localhost:5050/health >/dev/null 2>&1; then
    log "Backend healthy!"; break
  fi
  RETRIES=$((RETRIES - 1))
  sleep 5
done

[ $RETRIES -eq 0 ] && { log "WARNING: Backend unhealthy"; $COMPOSE_CMD logs --tail=50 backend; }
$COMPOSE_CMD ps
log "=== Startup complete ==="
