#!/usr/bin/env bash
# Ease Mac disk pressure so Unity Editor can process Coplay / Play Hub.
# Safe targets only: caches, logs, Temp, Bee — never Assets/ or bible/.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LW="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$LW/../.." && pwd)"
PROJECT="$LW/unity-client"
if [[ ! -d "$PROJECT" ]]; then
  PROJECT="$LW"
fi

echo "== before =="
df -h /System/Volumes/Data 2>/dev/null || df -h /

reclaim() {
  local path="$1"
  if [[ -e "$path" ]]; then
    local before
    before=$(du -sk "$path" 2>/dev/null | awk '{print $1}' || echo 0)
    rm -rf "$path"
    echo "removed $path (~${before} KiB)"
  fi
}

reclaim "$HOME/Library/Logs/Unity"
reclaim "$PROJECT/Temp"
reclaim "$PROJECT/Library/Bee"
reclaim "$PROJECT/Library/ShaderCache"
reclaim "$PROJECT/Library/ArtifactDB-lock"
reclaim "$PROJECT/Library/SourceAssetDB-lock"

rm -f /tmp/concordia-request-play /tmp/concordia-request-webgl-export 2>/dev/null || true
# stop play if a flag watcher is looping
touch /tmp/concordia-request-stop 2>/dev/null || true

LLAMA="$REPO/concord-frontend/public/unity-client/StreamingAssets/LlamaLib-v2.0.5"
if [[ -d "$LLAMA" ]]; then
  reclaim "$LLAMA"
fi

if [[ -d "$HOME/.zuko/live-play" ]]; then
  find "$HOME/.zuko/live-play" -type f -mtime +7 \( -name '*.png' -o -name '*.jpg' \) -delete 2>/dev/null || true
fi

echo "== after =="
df -h /System/Volumes/Data 2>/dev/null || df -h /
echo "Next: quit Unity if still wedged, reopen, Concordia → Play Hub Now."
