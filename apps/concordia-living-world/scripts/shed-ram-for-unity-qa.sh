#!/usr/bin/env bash
# Shed competing RAM (Ollama / llama-server) so Unity Play Hub can run on 16GB Macs.
# Does not touch Assets. Concord node server is left running unless one process >2.5GB RSS.
set -euo pipefail

NODE_RSS_KILL_MB="${NODE_RSS_KILL_MB:-2560}"
HEALTH_URL="${CONCORD_HEALTH_URL:-http://127.0.0.1:5050/health}"

approx_free_mb() {
  # macOS: free pages from vm_stat (page size typically 4096 on Apple Silicon / Intel recent)
  local page_size free_pages wired inactive speculative
  page_size=$(pagesize 2>/dev/null || echo 4096)
  if command -v vm_stat >/dev/null 2>&1; then
    free_pages=$(vm_stat | awk '/Pages free/ {gsub(/\./,"",$3); print $3}')
    wired=$(vm_stat | awk '/Pages wired/ {gsub(/\./,"",$4); print $4}')
    inactive=$(vm_stat | awk '/Pages inactive/ {gsub(/\./,"",$3); print $3}')
    speculative=$(vm_stat | awk '/Pages speculative/ {gsub(/\./,"",$3); print $3}')
    free_pages=${free_pages:-0}
    inactive=${inactive:-0}
    speculative=${speculative:-0}
    echo $(( (free_pages + inactive + speculative) * page_size / 1024 / 1024 ))
  else
    echo "?"
  fi
}

print_rss_top() {
  echo "== RSS (ollama|llama|Unity|node) =="
  ps aux 2>/dev/null | egrep -i 'ollama|llama-server|Unity|/node ' | grep -v egrep | \
    awk '{printf "  %6d MB  %s\n", int($6/1024), substr($0,index($0,$11))}' | sort -nr | head -15 || true
}

echo "== disk =="
df -h /System/Volumes/Data 2>/dev/null || df -h /
echo "== vm_stat (summary) =="
vm_stat 2>/dev/null | head -12 || true

BEFORE=$(approx_free_mb)
echo "approx reclaimable-ish free MB (before): ${BEFORE}"
print_rss_top

REBOOT_AGENTS=()
UID_NUM="${UID:-$(id -u)}"
GUI_DOMAIN="gui/${UID_NUM}"

if command -v launchctl >/dev/null 2>&1; then
  while IFS= read -r plist; do
    [[ -z "$plist" ]] && continue
    label="$(basename "$plist" .plist)"
    if launchctl bootout "$GUI_DOMAIN" "$plist" 2>/dev/null; then
      REBOOT_AGENTS+=("$plist")
      echo "bootout LaunchAgent: $plist"
    elif launchctl bootout "$GUI_DOMAIN/$label" 2>/dev/null; then
      REBOOT_AGENTS+=("$plist")
      echo "bootout LaunchAgent (label): $GUI_DOMAIN/$label"
    fi
  done < <(find "$HOME/Library/LaunchAgents" -maxdepth 1 \( -iname '*ollama*' \) 2>/dev/null)
fi

if command -v brew >/dev/null 2>&1; then
  if brew services list 2>/dev/null | grep -qi ollama; then
    echo "brew services stop ollama"
    brew services stop ollama 2>/dev/null || true
  fi
fi

echo "Stopping ollama CLI serve if running..."
ollama stop 2>/dev/null || true
pkill -TERM -f 'llama-server' 2>/dev/null || true
pkill -TERM -f '[Oo]llama' 2>/dev/null || true
sleep 2
pkill -KILL -f 'llama-server' 2>/dev/null || true
pkill -KILL -f '/Applications/Ollama' 2>/dev/null || true

# Node: keep Concord /health responder; kill only runaway non-server node PIDs
if curl -sf --max-time 2 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "Concord /health OK at $HEALTH_URL — not stopping server.js"
  while read -r pid rss_kb cmd; do
    [[ -z "$pid" ]] && continue
    rss_mb=$((rss_kb / 1024))
    if [[ "$rss_mb" -gt "$NODE_RSS_KILL_MB" ]] && [[ "$cmd" != *server.js* ]] && [[ "$cmd" != *"node --watch server.js"* ]]; then
      echo "kill node pid=$pid rss=${rss_mb}MB (>${NODE_RSS_KILL_MB}MB, not server.js)"
      kill -TERM "$pid" 2>/dev/null || true
    fi
  done < <(ps aux | awk '/[\/]node / {print $2, $6, substr($0,index($0,$11))}')
else
  echo "WARN: $HEALTH_URL not reachable — skipping node cull (manual review)"
fi

sleep 1
AFTER=$(approx_free_mb)
echo "approx reclaimable-ish free MB (after):  ${AFTER}"
if [[ "$BEFORE" != "?" && "$AFTER" != "?" ]]; then
  echo "delta approx MB: $(( AFTER - BEFORE ))"
fi
print_rss_top

if ((${#REBOOT_AGENTS[@]} > 0)); then
  echo "== Re-enable Ollama LaunchAgents after QA (reboot or load) =="
  for p in "${REBOOT_AGENTS[@]}"; do
    echo "  launchctl bootstrap $GUI_DOMAIN \"$p\""
  done
fi

if [[ "${1:-}" == "--play" ]]; then
  echo "== Play Hub flag sequence =="
  touch /tmp/concordia-request-stop 2>/dev/null || true
  sleep 2
  rm -f /tmp/concordia-request-stop 2>/dev/null || true
  touch /tmp/concordia-request-play 2>/dev/null || true
  echo "touched /tmp/concordia-request-play (ConcordiaBoot → Play Hub Now)"
fi

echo "Done. Unity Play Hub: touch /tmp/concordia-request-play or Concordia → Play Hub Now."
echo "Optional: re-run with --play after shed to stop-then-start play via flags."
