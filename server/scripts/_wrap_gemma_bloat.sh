#!/bin/bash
set -e
LOG=/Users/dutch/.zuko/remaining-work/gemma-dhtp-dtu-bloat.run.log
CONCORD_PID=$(pgrep -f 'concord-cognitive-engine/server/server.js' | head -1 || true)
echo "[wrap] concord_pid=$CONCORD_PID" | tee "$LOG"
if [ -n "$CONCORD_PID" ]; then kill -STOP "$CONCORD_PID" || true; echo "[wrap] STOP concord" | tee -a "$LOG"; fi
cleanup() { if [ -n "$CONCORD_PID" ]; then kill -CONT "$CONCORD_PID" || true; echo "[wrap] CONT concord" | tee -a "$LOG"; fi; }
trap cleanup EXIT
export TRIALS=1 DELAY_SEC=0 TIMEOUT_SEC=180 MAX_RETRIES=1
export DHTP_RS_OLLAMA_MODEL=concord-brain-conscious:latest OLLAMA_URL=http://127.0.0.1:11435
cd "/Users/dutch/concord vs code/concord-cognitive-engine"
node server/scripts/run-gemma-dhtp-dtu-bloat.mjs 2>&1 | tee -a "$LOG"
echo EXIT:$? | tee -a "$LOG"
