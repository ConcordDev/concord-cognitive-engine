#!/bin/bash
# Gated weights (need a Hugging Face token whose account has been granted
# access): DINOv3 (manual approval by Meta) and FLUX.1-schnell (click-through).
# Usage: HF_TOKEN=hf_... bash pod_weights_gated.sh
# The token stays in this process's environment; nothing is written to disk.
set -uo pipefail
: "${HF_TOKEN:?set HF_TOKEN for this command only}"
M=/workspace/models
get_repo() {  # repo [exclude-regex]
  local repo=$1 exclude=${2:-^$}
  local files; files=$(curl -s -H "Authorization: Bearer $HF_TOKEN" "https://huggingface.co/api/models/$repo" \
    | python3 -c "import json,sys;d=json.load(sys.stdin);print('\n'.join(s['rfilename'] for s in d.get('siblings',[])))" )
  [ -z "$files" ] && { echo "NO ACCESS $repo (request/accept it on huggingface.co with this account)"; return; }
  local fails=0
  for f in $files; do
    [[ "$f" =~ $exclude ]] && continue
    local dest="$M/$repo/$f"; mkdir -p "$(dirname "$dest")"
    [ -s "$dest" ] && continue
    curl -sfL --retry 5 -H "Authorization: Bearer $HF_TOKEN" -o "$dest.part" "https://huggingface.co/$repo/resolve/main/$f" \
      && mv "$dest.part" "$dest" && echo "ok $repo/$f" || { echo "FAIL $repo/$f"; fails=$((fails+1)); }
  done
  [ "$fails" -eq 0 ] && [ -n "$files" ] && touch "$M/$repo/.concord_complete" && echo "COMPLETE $repo"
}
get_repo facebook/dinov3-vitl16-pretrain-lvd1689m
# FLUX: diffusers layout only — skip the duplicate single-file checkpoint (~24 GB).
get_repo black-forest-labs/FLUX.1-schnell '^(flux1-schnell\.safetensors|ae\.safetensors)$'
du -sh $M/facebook $M/black-forest-labs 2>/dev/null
