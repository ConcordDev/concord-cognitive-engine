#!/usr/bin/env bash
# Concord — Health Check Script
#
# Checks server health and logs alerts. Called by cron every 5 minutes.
# Logs to stdout (cron captures to health.log).
# Optionally sends webhook alerts on failure.
#
# Environment:
#   CONCORD_PORT (default: 3001)
#   CONCORD_ALERT_WEBHOOK (optional: Discord/Slack webhook URL)
#   CONCORD_ALERT_EMAIL (optional: email for alerts)

set -euo pipefail

PORT="${CONCORD_PORT:-5050}"
BASE_URL="http://localhost:$PORT"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
ALERT_WEBHOOK="${CONCORD_ALERT_WEBHOOK:-}"

check_endpoint() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"

  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$url" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "$expected_status" ]; then
    echo "[$TIMESTAMP] OK: $name (HTTP $HTTP_CODE)"
    return 0
  else
    echo "[$TIMESTAMP] FAIL: $name (HTTP $HTTP_CODE, expected $expected_status)"
    return 1
  fi
}

FAILURES=0

# Core health checks
check_endpoint "Server" "$BASE_URL/health" || ((FAILURES++)) || true
check_endpoint "API Status" "$BASE_URL/api/status" || ((FAILURES++)) || true

# Check PM2 process
if command -v pm2 &>/dev/null; then
  PM2_STATUS=$(pm2 jlist 2>/dev/null | python3 -c "import sys,json; procs=json.load(sys.stdin); concord=[p for p in procs if 'concord' in p.get('name','').lower()]; print('online' if any(p['pm2_env']['status']=='online' for p in concord) else 'stopped')" 2>/dev/null || echo "unknown")
  if [ "$PM2_STATUS" = "online" ]; then
    echo "[$TIMESTAMP] OK: PM2 process online"
  else
    echo "[$TIMESTAMP] FAIL: PM2 process status: $PM2_STATUS"
    ((FAILURES++)) || true
  fi
fi

# Check disk space (warn if >90%)
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%' 2>/dev/null || echo "0")
if [ "$DISK_USAGE" -gt 90 ]; then
  echo "[$TIMESTAMP] WARN: Disk usage at ${DISK_USAGE}%"
  ((FAILURES++)) || true
else
  echo "[$TIMESTAMP] OK: Disk usage ${DISK_USAGE}%"
fi

# Check memory (warn if >90%)
MEM_USAGE=$(free | awk 'NR==2 {printf "%.0f", $3/$2*100}' 2>/dev/null || echo "0")
if [ "$MEM_USAGE" -gt 90 ]; then
  echo "[$TIMESTAMP] WARN: Memory usage at ${MEM_USAGE}%"
  ((FAILURES++)) || true
else
  echo "[$TIMESTAMP] OK: Memory usage ${MEM_USAGE}%"
fi

# Check Ollama
OLLAMA_URL="${OLLAMA_URL:-http://localhost:11434}"
OLLAMA_CODE=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 --max-time 5 "$OLLAMA_URL/api/tags" 2>/dev/null || echo "000")
if [ "$OLLAMA_CODE" = "200" ]; then
  echo "[$TIMESTAMP] OK: Ollama responding"
else
  echo "[$TIMESTAMP] WARN: Ollama not responding (HTTP $OLLAMA_CODE)"
fi

# Send alert if failures detected
if [ "$FAILURES" -gt 0 ]; then
  ALERT_MSG="[CONCORD ALERT] $FAILURES health check failure(s) at $TIMESTAMP"
  echo "[$TIMESTAMP] ALERT: $FAILURES failure(s) detected"

  # Webhook alert (Discord/Slack compatible)
  if [ -n "$ALERT_WEBHOOK" ]; then
    curl -s -X POST -H "Content-Type: application/json" \
      -d "{\"content\":\"$ALERT_MSG\",\"text\":\"$ALERT_MSG\"}" \
      "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
  fi
else
  echo "[$TIMESTAMP] ALL CHECKS PASSED"
fi

exit $FAILURES
