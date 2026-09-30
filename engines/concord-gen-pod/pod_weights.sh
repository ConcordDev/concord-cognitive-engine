#!/bin/bash
# Ungated, commercially-licensed weights only (MIT). Plain files under
# /workspace/models/<repo> (geesefs: no symlinks, so no HF cache layout).
set -uo pipefail
M=/workspace/models
get_repo() {  # repo [path-prefix-filter]
  local repo=$1 filter=${2:-}
  local files; files=$(curl -s "https://huggingface.co/api/models/$repo" | python3 -c "import json,sys;print('\n'.join(s['rfilename'] for s in json.load(sys.stdin)['siblings']))")
  local fails=0
  for f in $files; do
    [ -n "$filter" ] && [[ "$f" != $filter* ]] && continue
    local dest="$M/$repo/$f"; mkdir -p "$(dirname "$dest")"
    if [ -s "$dest" ]; then continue; fi
    curl -sfL --retry 5 -o "$dest.part" "https://huggingface.co/$repo/resolve/main/$f" && mv "$dest.part" "$dest" && echo "ok $repo/$f $(stat -c%s "$dest")" || { echo "FAIL $repo/$f"; fails=$((fails+1)); }
  done
  [ "$fails" -eq 0 ] && [ -n "$files" ] && touch "$M/$repo/.concord_complete" && echo "COMPLETE $repo"
}
echo "=== $(date +%T) start"
get_repo ZhengPeng7/BiRefNet
get_repo microsoft/TRELLIS-image-large ckpts/ss_dec_conv3d_16l8_fp16
get_repo microsoft/TRELLIS.2-4B
echo "=== $(date +%T) done"; du -sh $M/* 2>/dev/null
