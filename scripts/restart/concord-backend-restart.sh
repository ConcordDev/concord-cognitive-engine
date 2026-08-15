#!/bin/bash
# Restart the Concord backend every 90 minutes to avoid the memory leak
# This is a BANDAID: the real fix is the dtu_store_persist_failed patch
# (which IS deployed on the pod). When the leak is fully root-caused,
# this cron can be deleted.

set -uo pipefail

# Identify the running backend
PID=$(ps aux | grep 'node server/server.js' | grep -v grep | awk '{print $2}' | head -1)

if [[ -z "$PID" ]]; then
  echo "No backend process running — skipping restart"
  exit 0
fi

# Snapshot the current RSS for the restart report
RSS_BEFORE=$(ps -p "$PID" -o rss= 2>/dev/null || echo 0)
echo "Restarting backend PID $PID (RSS: ${RSS_BEFORE} KB)"

# Graceful kill (SIGTERM first, then SIGKILL after 5s)
kill -TERM "$PID" 2>/dev/null
sleep 5
if kill -0 "$PID" 2>/dev/null; then
  kill -9 "$PID" 2>/dev/null
  sleep 1
fi

# Start fresh
cd /workspace/concord-cognitive-engine
set -a
source .env
set +a
export DB_PATH=/workspace/concord-data/concord.db PORT=5050 NODE_ENV=production
nohup node server/server.js > /tmp/concord-boot.log 2>&1 &
disown

# Report
MSG="[RESTART] Concord backend restarted. Before: ${RSS_BEFORE}KB PID ${PID}. New: $(sleep 5; ps aux | grep 'node server/server.js' | grep -v grep | head -1 | awk '{print "PID", $2, "RSS:", $6}')"
echo "$MSG"
hermes send -t "telegram:6776710732" "$MSG" 2>&1
exit 0
