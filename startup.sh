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

  # ── File-descriptor limit (Vector 1 crash hardening) ──────────────────────
  # Linux default nofile = 1024. Node.js + WebSocket needs ~4 FDs per connection.
  # 1024 crashes at ~200 concurrent users. Raise to 1,048,576 (1M) — the
  # kernel-recommended production floor for servers handling 10k+ connections.
  # If the pod's cgroup blocks the hard limit, we silently drop to 65536.
  if ulimit -n 1048576 2>/dev/null; then
    log "File-descriptor limit raised to 1,048,576"
  elif ulimit -n 65536 2>/dev/null; then
    log "File-descriptor limit raised to 65,536 (pod restricted hard limit)"
  else
    log "WARNING: Could not raise ulimit -n — running at $(ulimit -n). Crash risk above ~200 concurrent users."
    log "         Fix: add 'concord hard nofile 1048576' to /etc/security/limits.conf and relogin."
  fi

  # ── Node heap + GC flags ───────────────────────────────────────────────────
  # PM2's node_args in ecosystem.config.cjs handles this for managed processes,
  # but exporting NODE_OPTIONS here ensures any direct `node` invocations (build
  # scripts, migration runners) also benefit before PM2 takes over.
  export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=32768 --expose-gc}"
  log "NODE_OPTIONS=${NODE_OPTIONS}"

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

  # ── Cloudflare tunnel (Vector 6 — eliminate SPOF) ─────────────────────────
  # cloudflared has built-in reconnect logic, but the process can hang or exit.
  # PM2 manages it as a supervised process so it restarts automatically.
  # Cloudflare natively supports multiple connectors on one tunnel (redundant
  # edge) — running startup.sh on a second node auto-adds a failover connector.
  # Set CLOUDFLARE_TUNNEL_TOKEN in .env to activate.
  if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ]; then
    if ! command -v cloudflared &>/dev/null; then
      log "WARNING: CLOUDFLARE_TUNNEL_TOKEN is set but cloudflared is not installed."
      log "         Install: curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cf.deb && dpkg -i /tmp/cf.deb"
    else
      if pm2 list | grep -q "concord-tunnel"; then
        log "Cloudflare tunnel already managed by PM2 — restarting..."
        pm2 restart concord-tunnel 2>/dev/null || true
      else
        log "Starting Cloudflare tunnel (supervised by PM2)..."
        pm2 start cloudflared \
          --name concord-tunnel \
          --no-autorestart \
          -- tunnel --no-autoupdate run --token "${CLOUDFLARE_TUNNEL_TOKEN}"
        pm2 start --name concord-tunnel --autorestart --max-restarts 20 2>/dev/null || true
        pm2 save
      fi
      log "Tunnel status: $(pm2 show concord-tunnel 2>/dev/null | grep status | head -1 || echo 'starting')"
    fi
  elif [ -n "${TUNNEL_PUBLIC_URL:-}" ]; then
    log "NOTE: TUNNEL_PUBLIC_URL is set but CLOUDFLARE_TUNNEL_TOKEN is not — tunnel must be started separately."
    log "      Set CLOUDFLARE_TUNNEL_TOKEN in .env to have startup.sh manage it."
  fi

  # ── Health watchdog cron (Vector 7 — auto-recovery) ───────────────────────
  # Installs a crontab entry that runs the health check every 5 minutes.
  # The health check script detects down services and triggers pm2 restart.
  # Idempotent: re-running startup.sh replaces the existing entry.
  if command -v crontab &>/dev/null; then
    CRON_JOB="*/5 * * * * cd $SCRIPT_DIR && bash scripts/health-check.sh >> $SCRIPT_DIR/logs/health.log 2>&1"
    ( crontab -l 2>/dev/null | grep -v "health-check\.sh" ; echo "$CRON_JOB" ) | crontab - 2>/dev/null \
      && log "Health-check cron installed (every 5 minutes)" \
      || log "WARNING: Could not install health-check cron — add it manually: $CRON_JOB"
  fi

  # ── DB backup watchdog (Vector — data durability) ─────────────────────────
  # 6-hourly WAL-safe SQLite snapshot to a PERSISTENT location. CONCORD_BACKUP_DIR
  # MUST point at the network volume (e.g. /workspace/concord/backups) or the
  # backups die with the container on a pod reclaim. Idempotent install.
  if command -v crontab &>/dev/null; then
    mkdir -p logs
    BACKUP_CRON="0 */6 * * * cd $SCRIPT_DIR && DB_PATH='${DB_PATH:-}' DATA_DIR='${DATA_DIR:-}' CONCORD_BACKUP_DIR='${CONCORD_BACKUP_DIR:-}' CONCORD_BACKUP_REMOTE='${CONCORD_BACKUP_REMOTE:-}' bash scripts/db-backup.sh >> $SCRIPT_DIR/logs/backup.log 2>&1"
    ( crontab -l 2>/dev/null | grep -v "db-backup\.sh" ; echo "$BACKUP_CRON" ) | crontab - 2>/dev/null \
      && log "DB backup cron installed (every 6 hours → ${CONCORD_BACKUP_DIR:-<DATA_DIR>/backups})" \
      || log "WARNING: Could not install backup cron — add it manually: $BACKUP_CRON"
    # Durability guard: warn loudly if the DB or backups are NOT on a volume.
    case "${DB_PATH:-${DATA_DIR:-}}" in
      /workspace*|/runpod-volume*|/data/*) : ;;  # likely persistent
      *) log "⚠️  DB_PATH='${DB_PATH:-unset}' may be on the EPHEMERAL container disk."
         log "    Point DB_PATH + CONCORD_BACKUP_DIR at your network volume (e.g."
         log "    /workspace/concord/db/concord.db) or a pod reclaim = total data loss." ;;
    esac
    # Take one backup right now so there's always at least one on disk.
    DB_PATH="${DB_PATH:-}" DATA_DIR="${DATA_DIR:-}" CONCORD_BACKUP_DIR="${CONCORD_BACKUP_DIR:-}" \
      bash scripts/db-backup.sh >> logs/backup.log 2>&1 \
      && log "Initial DB backup taken" || log "NOTE: initial backup skipped (DB not found yet — cron will catch the next one)"
  fi

  # ── pm2 startup (survive pod reboot) ──────────────────────────────────────
  # Save PM2 process list so it auto-restarts after a pod reboot.
  # `pm2 startup` prints a command to run as root to register the init script;
  # on RunPod we can't guarantee sudo, so we save the list and try the startup
  # hook non-fatally.
  pm2 save 2>/dev/null || true
  PM2_STARTUP_CMD=$(pm2 startup 2>/dev/null | grep "sudo" | tail -1 || true)
  if [ -n "$PM2_STARTUP_CMD" ]; then
    log "To survive reboots, run: $PM2_STARTUP_CMD"
    # On RunPod pods we often have root — try it automatically.
    if [ "$(id -u)" = "0" ]; then
      eval "$PM2_STARTUP_CMD" 2>/dev/null && log "pm2 startup hook registered." || true
    fi
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
  [ -n "${TUNNEL_PUBLIC_URL:-}" ]  && log "  Tunnel:   ${TUNNEL_PUBLIC_URL}"
  log ""
  log "  pm2 status:  pm2 list"
  log "  pm2 logs:    pm2 logs"
  log "  pm2 stop:    pm2 stop all"
  log "  FD limit:    $(ulimit -n)"
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
