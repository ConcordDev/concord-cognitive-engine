#!/bin/bash
# Concord GPU tier autostart (2026-10-19, pod-restore-1019). Called from /pre_start.sh, which RunPod's /start.sh
# runs on every container start. Idempotent: only starts sessions that are missing.
#   brain   tmux ollama-a40brain  127.0.0.1:11434
#   bg      tmux ollama-bg        127.0.0.1:11436
#   gen     tmux gen-server       127.0.0.1:7870 (FLUX nf4 + TRELLIS v1 /mesh)
LOG=/workspace/logs/pod-autostart.log; mkdir -p /workspace/logs
exec >>"$LOG" 2>&1
echo "[$(date -u +%FT%TZ)] autostart begin"
tmux has-session -t ollama-a40brain 2>/dev/null || tmux new-session -d -s ollama-a40brain "bash /workspace/start-ollama-a40brain.sh"
for i in $(seq 1 120); do [ -x /opt/ollama/bin/ollama ] && curl -s -m 2 127.0.0.1:11434/api/version >/dev/null && break; sleep 5; done
cp -f /workspace/start-ollama-bg.sh /root/start-ollama-bg.sh && chmod +x /root/start-ollama-bg.sh
tmux has-session -t ollama-bg 2>/dev/null || tmux new -d -s ollama-bg "bash /root/start-ollama-bg.sh"
# 2026-10-19: local weight copy (container disk) so gen-server restarts load in ~1 min, not 4.5-16 min from geesefs.
# Runs in the background; gen-server uses the local copy once its .concord_complete marker exists
# (a restart after the copy finishes picks it up; the RSS watchdog or `bash /workspace/start_gen_server.sh` does that).
nohup bash /workspace/gen/sync-local-weights.sh >/dev/null 2>&1 &
tmux has-session -t gen-server 2>/dev/null || bash /workspace/start_gen_server.sh
echo "[$(date -u +%FT%TZ)] autostart done: $(tmux ls 2>&1 | tr '\n' ' ')"
