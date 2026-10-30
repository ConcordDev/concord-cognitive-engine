#!/usr/bin/env bash
# Start the Lean check service on the pod with nohup (use lean-check.service for systemd instead).
# Usage: LEAN_SERVICE_TOKEN=... ./run.sh   (from the directory holding service.mjs + policy.js)
set -euo pipefail
cd "$(dirname "$0")"
LOG=${LEAN_SERVICE_LOG:-/root/lean/lean-check.log}
PIDFILE=${LEAN_SERVICE_PIDFILE:-/root/lean/lean-check.pid}
if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "already running pid $(cat "$PIDFILE")"; exit 0; fi
nohup node service.mjs >>"$LOG" 2>&1 &
echo $! >"$PIDFILE"
echo "started pid $! log $LOG"
