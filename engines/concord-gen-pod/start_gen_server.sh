#!/bin/bash
# Concord gen server (FLUX.1-schnell /concept) on 127.0.0.1:7870, supervised by a restart loop in tmux session "gen-server".
# INC-127 (2026-10-17): pm2 and /root/gen/venv vanish on pod recreate, and /workspace (geesefs) rejects chmod so pip
# cannot install onto it. Python deps therefore live in a local PYTHONUSERBASE (/root/gen/userbase, on top of the image's
# system torch) and a persistent snapshot (/workspace/gen/gen-userbase.tar.zst) restores it in seconds after a recreate.
# FLUX runs NF4 + model CPU offload by default (CONCORD_FLUX_MODE) so it shares the A40 with the Ollama chat brain.
# Previous pm2 version: /workspace/start_gen_server.sh.bak-inc127-20261017
set -u
UB=/root/gen/userbase
TAR=/workspace/gen/gen-userbase.tar.zst
PKGS="scipy>=1.14 diffusers accelerate transformers sentencepiece protobuf safetensors pillow bitsandbytes"
mkdir -p /workspace/gen /workspace/logs "$UB"
python3 -c "import torch" 2>/dev/null || PIP_BREAK_SYSTEM_PACKAGES=1 pip install -q torch --index-url https://download.pytorch.org/whl/cu128
if ! PYTHONUSERBASE=$UB python3 -c "import diffusers, bitsandbytes, transformers, scipy.stats" 2>/dev/null; then
  if [ -s "$TAR" ]; then
    echo "restoring python deps from $TAR"; zstd -dc "$TAR" | tar -x -C "$UB"
  fi
  if ! PYTHONUSERBASE=$UB python3 -c "import diffusers, bitsandbytes, transformers, scipy.stats" 2>/dev/null; then
    echo "installing python deps"; PYTHONUSERBASE=$UB PIP_BREAK_SYSTEM_PACKAGES=1 pip install -q --user $PKGS
    tar -C "$UB" -cf - . | zstd -q -3 > "$TAR.tmp" && mv -f "$TAR.tmp" "$TAR"
  fi
fi
tmux has-session -t gen-server 2>/dev/null && tmux kill-session -t gen-server
tmux new-session -d -s gen-server "bash /workspace/gen/gen-server-loop.sh"
for i in $(seq 1 60); do curl -s -m 2 127.0.0.1:7870/health && break; sleep 2; done; echo
