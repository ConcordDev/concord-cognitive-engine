#!/usr/bin/env bash
# Concord — Health Check + Auto-Recovery Script
#
# Checks service health and triggers PM2 restarts on failure.
# Called by cron every 5 minutes (installed by startup.sh).
# Logs to stdout (cron captures to logs/health.log).
#
# Environment:
#   CONCORD_PORT            (default: 5050)
#   CONCORD_ALERT_WEBHOOK   (optional: Discord/Slack/Teams webhook URL)
#   CLOUDFLARE_TUNNEL_TOKEN (set in .env — enables tunnel health check)

set -euo pipefail

# Load .env if present (cron doesn't inherit shell env)
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$SCRIPT_DIR/.env" ]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

PORT="${CONCORD_PORT:-5050}"
BASE_URL="http://localhost:$PORT"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
ALERT_WEBHOOK="${CONCORD_ALERT_WEBHOOK:-}"

check_endpoint() {
  local name="$1" url="$2" expected_status="${3:-200}"
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$url" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "$expected_status" ]; then
    echo "[$TIMESTAMP] OK: $name (HTTP $HTTP_CODE)"; return 0
  else
    echo "[$TIMESTAMP] FAIL: $name (HTTP $HTTP_CODE, expected $expected_status)"; return 1
  fi
}

pm2_restart_if_stopped() {
  local name="$1"
  if command -v pm2 &>/dev/null; then
    STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys,json
procs=json.load(sys.stdin)
match=[p for p in procs if p.get('name','') == '$name']
print(match[0]['pm2_env']['status'] if match else 'not_found')
" 2>/dev/null || echo "unknown")
    if [ "$STATUS" = "stopped" ] || [ "$STATUS" = "errored" ]; then
      echo "[$TIMESTAMP] AUTO-RESTART: $name was $STATUS — restarting via PM2"
      pm2 restart "$name" 2>/dev/null || pm2 start ecosystem.config.cjs --only "$name" --env runpod 2>/dev/null || true
      return 1
    elif [ "$STATUS" = "online" ]; then
      echo "[$TIMESTAMP] OK: PM2 $name online"; return 0
    else
      echo "[$TIMESTAMP] WARN: PM2 $name status: $STATUS"; return 0
    fi
  fi
}

FAILURES=0

# ── Core API health ─────────────────────────────────────────────────────────
check_endpoint "Backend /health" "$BASE_URL/health" || {
  ((FAILURES++)) || true
  echo "[$TIMESTAMP] AUTO-RESTART: backend did not respond — restarting PM2 concord-backend"
  pm2_restart_if_stopped "concord-backend" || true
}
check_endpoint "API status" "$BASE_URL/api/status" || ((FAILURES++)) || true

# ── Frontend health ─────────────────────────────────────────────────────────
check_endpoint "Frontend" "http://localhost:3000/" 200 2>/dev/null \
  || { ((FAILURES++)) || true; pm2_restart_if_stopped "concord-frontend" || true; }

# ── PM2 process inventory ───────────────────────────────────────────────────
if command -v pm2 &>/dev/null; then
  for proc in concord-backend concord-frontend; do
    pm2_restart_if_stopped "$proc" || ((FAILURES++)) || true
  done
fi

# ── Cloudflare tunnel (Vector 6) ────────────────────────────────────────────
# Only check when CLOUDFLARE_TUNNEL_TOKEN is set — tunnel is optional.
if [ -n "${CLOUDFLARE_TUNNEL_TOKEN:-}" ] && command -v pm2 &>/dev/null; then
  TUNNEL_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "
import sys,json
procs=json.load(sys.stdin)
match=[p for p in procs if p.get('name','') == 'concord-tunnel']
print(match[0]['pm2_env']['status'] if match else 'not_found')
" 2>/dev/null || echo "unknown")
  if [ "$TUNNEL_STATUS" = "online" ]; then
    echo "[$TIMESTAMP] OK: Cloudflare tunnel online"
  elif [ "$TUNNEL_STATUS" = "not_found" ]; then
    echo "[$TIMESTAMP] INFO: concord-tunnel not in PM2 — will be managed at next startup.sh run"
  else
    echo "[$TIMESTAMP] AUTO-RESTART: concord-tunnel was $TUNNEL_STATUS — restarting"
    pm2 restart concord-tunnel 2>/dev/null || true
    ((FAILURES++)) || true
  fi
fi

# ── Ollama brain health ──────────────────────────────────────────────────────
OLLAMA_URL="${BRAIN_CONSCIOUS_URL:-http://localhost:11434}"
OLLAMA_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 5 "$OLLAMA_URL/api/tags" 2>/dev/null || echo "000")
if [ "$OLLAMA_CODE" = "200" ]; then
  echo "[$TIMESTAMP] OK: Ollama responding ($OLLAMA_URL)"
else
  echo "[$TIMESTAMP] WARN: Ollama not responding at $OLLAMA_URL (HTTP $OLLAMA_CODE)"
  # Restart PM2-managed Ollama only if running in single-Ollama PM2 mode
  if command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q "^│ ollama "; then
    pm2_restart_if_stopped "ollama" || true
  fi
fi

# ── Disk space (warn if >85%, fail if >95%) ──────────────────────────────────
DISK_USAGE=$(df / | awk 'NR==2 {gsub(/%/,""); print $5}' 2>/dev/null || echo "0")
if [ "$DISK_USAGE" -gt 95 ]; then
  echo "[$TIMESTAMP] CRITICAL: Disk usage at ${DISK_USAGE}% — service may crash"
  ((FAILURES++)) || true
elif [ "$DISK_USAGE" -gt 85 ]; then
  echo "[$TIMESTAMP] WARN: Disk usage at ${DISK_USAGE}%"
else
  echo "[$TIMESTAMP] OK: Disk ${DISK_USAGE}% used"
fi

# ── Memory (warn if >90%) ────────────────────────────────────────────────────
MEM_USAGE=$(free | awk 'NR==2 {printf "%.0f", $3/$2*100}' 2>/dev/null || echo "0")
if [ "$MEM_USAGE" -gt 90 ]; then
  echo "[$TIMESTAMP] WARN: Memory usage at ${MEM_USAGE}%"
else
  echo "[$TIMESTAMP] OK: Memory ${MEM_USAGE}% used"
fi

# ── File-descriptor check ─────────────────────────────────────────────────────
FD_LIMIT=$(cat /proc/sys/fs/file-max 2>/dev/null || echo "unknown")
OPEN_FDS=$(ls /proc/self/fd 2>/dev/null | wc -l || echo "0")
echo "[$TIMESTAMP] INFO: System FD max=$FD_LIMIT, health-check process open FDs=$OPEN_FDS"

# ── Alert on failure ─────────────────────────────────────────────────────────
if [ "$FAILURES" -gt 0 ]; then
  ALERT_MSG="[CONCORD ALERT] $FAILURES health check failure(s) at $TIMESTAMP on $(hostname)"
  echo "[$TIMESTAMP] ALERT: $FAILURES failure(s) — check logs/health.log"
  if [ -n "$ALERT_WEBHOOK" ]; then
    curl -s -X POST -H "Content-Type: application/json" \
      -d "{\"content\":\"$ALERT_MSG\",\"text\":\"$ALERT_MSG\"}" \
      "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
  fi
else
  echo "[$TIMESTAMP] ALL CHECKS PASSED"
fi

exit "$FAILURES"
