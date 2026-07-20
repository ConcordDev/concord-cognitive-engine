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

# ── Log rotation for logs pm2-logrotate doesn't cover ────────────────────────
# Stability audit (2026-07-20) — pm2-logrotate (installed by startup.sh)
# covers logs/backend-*.log, frontend-*.log, cloudflared-*.log — every
# pm2-managed process. It does NOT cover: (a) this script's OWN output
# (logs/health.log, appended forever by the cron redirect), or (b) the 5
# Ollama brain logs (scripts/runpod-cognition.sh's respawn loop appends to
# them, by design, so a crash's full context survives the respawn — but
# "append forever" needs a backstop). Truncating a file that's currently
# open for O_APPEND writes (cron's `>>` redirect for health.log, and the
# respawn loop's own `>>` for brain logs) is safe and standard — POSIX
# guarantees an O_APPEND fd always seeks to the current end-of-file before
# each write, so subsequent writes correctly continue from the new
# (post-truncation) end rather than leaving a sparse hole. This is the same
# principle logrotate's own `copytruncate` mode relies on.
CONCORD_LOG_ROTATE_MAX_BYTES="${CONCORD_LOG_ROTATE_MAX_BYTES:-20971520}"  # 20MB
rotate_if_large() {
  local f="$1" size
  [ -f "$f" ] || return 0
  size=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f" 2>/dev/null || echo 0)
  if [ "${size:-0}" -gt "$CONCORD_LOG_ROTATE_MAX_BYTES" ]; then
    if command -v gzip &>/dev/null; then
      cp "$f" "${f}.1" 2>/dev/null && gzip -f "${f}.1" 2>/dev/null && : > "$f" \
        && echo "[$TIMESTAMP] INFO: rotated $f (was ${size} bytes) -> ${f}.1.gz"
    else
      : > "$f" && echo "[$TIMESTAMP] INFO: rotated $f (was ${size} bytes) — truncated (gzip unavailable)"
    fi
  fi
}
rotate_if_large "$SCRIPT_DIR/logs/health.log"
BRAIN_LOG_DIR="${LOG_DIR:-/tmp/concord-brains}"
if [ -d "$BRAIN_LOG_DIR" ]; then
  for bf in "$BRAIN_LOG_DIR"/brain-*.log; do
    [ -f "$bf" ] || continue
    rotate_if_large "$bf"
  done
fi

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

# ── Ollama brain health (all 5, not just conscious) ──────────────────────────
# Stability audit (2026-07-20) — FIXED: this only ever checked
# BRAIN_CONSCIOUS_URL, so a crashed subconscious/utility/repair/vision brain
# was completely invisible to this script — no WARN, no alert, nothing. The
# restart attempt also only matched a pm2 process literally named "ollama"
# (singular), which never exists in the real bare-metal topology (5 separate
# processes on fixed ports 11434-11438, launched by
# scripts/runpod-cognition.sh — not pm2-managed). Real recovery now lives in
# that script's own per-brain respawn loop (same audit); this check's job is
# now VISIBILITY — catching the case where a brain has exhausted its
# respawn-loop restart cap and given up (logged as FATAL there), which has
# no other alerting path. Checks all 5 real fixed ports, defaulting to
# BRAIN_*_URL env vars when set (so this still works if ports are ever
# reconfigured), and increments FAILURES (triggering the webhook alert
# below) per brain that's down.
declare -A OLLAMA_BRAIN_URLS=(
  [conscious]="${BRAIN_CONSCIOUS_URL:-http://localhost:11434}"
  [subconscious]="${BRAIN_SUBCONSCIOUS_URL:-http://localhost:11435}"
  [utility]="${BRAIN_UTILITY_URL:-http://localhost:11436}"
  [repair]="${BRAIN_REPAIR_URL:-http://localhost:11437}"
  [vision]="${BRAIN_VISION_URL:-http://localhost:11438}"
)
for role in conscious subconscious utility repair vision; do
  url="${OLLAMA_BRAIN_URLS[$role]}"
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 5 "$url/api/tags" 2>/dev/null || echo "000")
  if [ "$code" = "200" ]; then
    echo "[$TIMESTAMP] OK: Ollama brain '$role' responding ($url)"
  else
    echo "[$TIMESTAMP] WARN: Ollama brain '$role' not responding at $url (HTTP $code) — check its respawn loop's own restart count in the brain-${role}.log; if it's exhausted CONCORD_BRAIN_MAX_RESTARTS, it needs a manual re-run of scripts/runpod-cognition.sh"
    ((FAILURES++)) || true
  fi
done
# Legacy fallback: restart PM2-managed Ollama only if running in the older
# single-Ollama PM2 mode (a process literally named "ollama") — harmless
# no-op on the real 5-process bare-metal topology, kept for back-compat.
if command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -q "^│ ollama "; then
  pm2_restart_if_stopped "ollama" || true
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
