#!/bin/bash
# startup.sh — Concord Cognitive Engine startup script
# Survives pod restart. Handles: dependency checks, state recovery, service start.
#
# Usage:
#   ./startup.sh              # Auto-detect: RunPod (pm2) or Docker Compose
#   ./startup.sh --runpod     # RunPod / bare-metal with pm2
#   ./startup.sh --cloudflare # RunPod/bare-metal behind a Cloudflare tunnel
#                             # (requires TUNNEL_PUBLIC_URL set in .env)
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

# ── Production preflight gate ────────────────────────────────────────────────
# Validates every required env var is set with a sane value BEFORE the server
# starts. Catches the "deployed and now logins fail because JWT_SECRET wasn't
# set" class of bugs by failing fast with a clear list of what's missing.
# Skipped for --dev mode where soft-fails are acceptable.
if [ "${NODE_ENV:-}" = "production" ] && [ "${1:-}" != "--dev" ]; then
  log "Running production preflight check..."
  if ! ./scripts/preflight-production.sh; then
    log "Preflight failed — fix missing env vars in .env then re-run startup.sh"
    exit 1
  fi
fi

# ── Cloudflare tunnel detection ──────────────────────────────────────────────
# When the pod is fronted by a Cloudflare tunnel (or any reverse proxy on a
# custom domain), the public URL is NOT the *.proxy.runpod.net address. Set
# TUNNEL_PUBLIC_URL in .env — or pass --cloudflare with it set — and the
# public-facing vars below are derived from the tunnel domain instead of
# RUNPOD_PUBLIC_URL.
USE_TUNNEL=false
for _arg in "$@"; do
  [ "$_arg" = "--cloudflare" ] && USE_TUNNEL=true
done
[ -n "${TUNNEL_PUBLIC_URL:-}" ] && USE_TUNNEL=true
if $USE_TUNNEL && [ -z "${TUNNEL_PUBLIC_URL:-}" ]; then
  log "ERROR: --cloudflare given but TUNNEL_PUBLIC_URL is not set in .env"
  log "  Set TUNNEL_PUBLIC_URL=https://your-tunnel-domain.example then re-run."
  exit 1
fi

# ── Auto-fill public-facing vars ─────────────────────────────────────────────
# Precedence: TUNNEL_PUBLIC_URL (Cloudflare / reverse proxy) > RUNPOD_PUBLIC_URL.
# Every var still respects an explicit value already in .env (the ${VAR:-...}
# default only fills when blank), so a hand-set value is never clobbered.
PUBLIC_BASE_URL=""
if $USE_TUNNEL; then
  PUBLIC_BASE_URL="${TUNNEL_PUBLIC_URL%/}"
  log "Public ingress: Cloudflare tunnel — $PUBLIC_BASE_URL"
elif $IS_RUNPOD && [ -n "${RUNPOD_PUBLIC_URL:-}" ]; then
  PUBLIC_BASE_URL="${RUNPOD_PUBLIC_URL%/}"
  log "Public ingress: RunPod proxy — $PUBLIC_BASE_URL"
fi
if [ -n "$PUBLIC_BASE_URL" ]; then
  export ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-$PUBLIC_BASE_URL}"
  export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-$PUBLIC_BASE_URL}"
  export NEXT_PUBLIC_SOCKET_URL="${NEXT_PUBLIC_SOCKET_URL:-$PUBLIC_BASE_URL}"
  # Cookie domain = hostname only
  DOMAIN=$(echo "$PUBLIC_BASE_URL" | sed 's|https\?://||' | cut -d'/' -f1)
  export COOKIE_DOMAIN="${COOKIE_DOMAIN:-$DOMAIN}"
  log "  ALLOWED_ORIGINS=$ALLOWED_ORIGINS"
  log "  NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL"
  log "  COOKIE_DOMAIN=$COOKIE_DOMAIN"
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
if $IS_RUNPOD || [ "${1:-}" = "--runpod" ] || [ "${1:-}" = "--cloudflare" ]; then
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

  # ── Ensure concord-conscious:latest is built ─────────────────────────
  # The conscious brain uses a custom Ollama model that can't be fetched
  # from the registry — it's built locally from the Modelfile in the
  # repo root. server/server.js#initFiveBrains() will try /api/pull as a
  # fallback if missing; that pull 404s for custom models, leaving the
  # conscious brain permanently disabled. Build it here on every boot
  # (ollama create is idempotent + cheap if already present) so the
  # user doesn't have to remember a separate step.
  if [ -f Modelfile ] && command -v ollama &>/dev/null; then
    if ! ollama list 2>/dev/null | grep -q "^concord-conscious:latest"; then
      log "Building concord-conscious:latest from Modelfile (one-time)..."
      if ollama create concord-conscious:latest -f Modelfile 2>>"$LOG_FILE"; then
        log "Built concord-conscious:latest"
      else
        log "WARNING: ollama create failed — Conscious brain will stay offline."
        log "         Edit Modelfile, then: ollama create concord-conscious:latest -f Modelfile"
      fi
    fi
  elif [ ! -f Modelfile ]; then
    log "WARNING: No Modelfile in repo root — Conscious brain will be offline."
    log "         Create a Modelfile and run: ollama create concord-conscious:latest -f Modelfile"
  fi

  # Build frontend if needed. NEXT_PUBLIC_* are baked into the bundle at
  # build time, so a build produced for a different public URL (e.g. switched
  # from the RunPod proxy to a Cloudflare tunnel) is stale and must be rebuilt.
  # Stamp the URL each build used and compare on every start.
  BUILD_STAMP="concord-frontend/.next/.concord-public-url"
  NEED_BUILD=false
  if [ ! -d concord-frontend/.next/standalone ]; then
    NEED_BUILD=true
  elif [ "$(cat "$BUILD_STAMP" 2>/dev/null || echo)" != "${NEXT_PUBLIC_API_URL:-}" ]; then
    log "Frontend bundle was built for a different public URL — rebuilding..."
    NEED_BUILD=true
  fi
  if $NEED_BUILD; then
    log "Building frontend (NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL:-<unset>})..."
    (cd concord-frontend && npm install && npm run build)
    echo "${NEXT_PUBLIC_API_URL:-}" > "$BUILD_STAMP"
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

  # Pin processes to dedicated CPU cores (non-fatal if taskset unavailable)
  if command -v taskset &>/dev/null; then
    log "Applying CPU pinning..."
    bash scripts/pin-processes.sh || log "CPU pinning skipped (non-fatal)"
  fi

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
