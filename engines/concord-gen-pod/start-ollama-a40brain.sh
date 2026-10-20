#!/bin/bash
# Concord A40 brain: Ollama bound to loopback only (127.0.0.1:11434). Reach it via SSH tunnel.
# /workspace is geesefs (S3 FUSE) and rejects chmod, which breaks Ollama blob/manifest writes.
# Layout: Ollama runs from local disk /root/ollama-models (fast, chmod OK).
# Persistent copy: /workspace/ollama-models/{blobs,manifests-backup,manifests-v2-backup}; restored on boot if local is
# missing, and mirrored back every 5 min as an exact mirror (rsync --delete), so models removed with `ollama rm`
# are also removed from the persistent copy and are NOT restored on the next boot.
# v2 (2026-10-17): mirror with --delete; also persist manifests-v2 (Ollama 0.40 layout, holds concord-core-v6).
if [ ! -x /opt/ollama/bin/ollama ]; then
  mkdir -p /opt/ollama && zstd -dc /workspace/ollama-bin/ollama-linux-amd64.tar.zst | tar -x -C /opt/ollama
  ln -sf /opt/ollama/bin/ollama /usr/local/bin/ollama
fi
LOCAL=/root/ollama-models
P=/workspace/ollama-models
mkdir -p "$LOCAL" $P/blobs $P/manifests-backup $P/manifests-v2-backup /workspace/logs
[ -L "$LOCAL/blobs" ] && rm -f "$LOCAL/blobs"
if [ ! -d "$LOCAL/blobs" ]; then
  mkdir -p "$LOCAL/blobs"
  cp -rn --no-preserve=mode,ownership,timestamps $P/blobs/. "$LOCAL/blobs/" 2>/dev/null
fi
if [ ! -d "$LOCAL/manifests" ] && [ -n "$(ls -A $P/manifests-backup 2>/dev/null)" ]; then
  cp -r --no-preserve=mode,ownership,timestamps $P/manifests-backup "$LOCAL/manifests"
fi
if [ ! -d "$LOCAL/manifests-v2" ] && [ -n "$(ls -A $P/manifests-v2-backup 2>/dev/null)" ]; then
  cp -r --no-preserve=mode,ownership,timestamps $P/manifests-v2-backup "$LOCAL/manifests-v2"
fi
export OLLAMA_MODELS="$LOCAL"
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_NOPRUNE=1
export OLLAMA_MAX_LOADED_MODELS=3
export OLLAMA_KEEP_ALIVE=30m
export OLLAMA_NUM_PARALLEL=2
export OLLAMA_FLASH_ATTENTION=1
# 2026-10-19 pod-restore: q8_0 KV cache frees ~3 GB so TRELLIS v1 fits beside FLUX nf4 + brains (was CUDA OOM)
export OLLAMA_KV_CACHE_TYPE=q8_0
# 2026-10-19 leak fix: llama-server keeps a host-RAM prompt cache, default 8192 MiB PER RUNNER (4 runners = 32 GB
# anon in a 47.7 GB container). It crept up until the cgroup OOM killer took gen-server (largest process). Cap it.
export LLAMA_ARG_CACHE_RAM=${LLAMA_ARG_CACHE_RAM:-2048}
RS="rsync -r --delete --delete-excluded --size-only --inplace --no-perms --no-owner --no-group --omit-dir-times --exclude=*-partial*"
# manifests-v2 entries are symlinks into blobs/ (geesefs has no symlinks): store them as regular files.
# exact mirror to persistent /workspace every 5 min. Guard: never mirror an empty local store (would wipe the backup).
( while true; do sleep 300
    if [ -n "$(ls -A "$LOCAL/manifests-v2" 2>/dev/null)$(ls -A "$LOCAL/manifests" 2>/dev/null)" ] && [ -n "$(ls -A "$LOCAL/blobs" 2>/dev/null)" ]; then
      $RS "$LOCAL/blobs/" $P/blobs/ 2>>/workspace/logs/ollama-mirror.log
      [ -d "$LOCAL/manifests" ]    && $RS "$LOCAL/manifests/"    $P/manifests-backup/    2>>/workspace/logs/ollama-mirror.log
      [ -d "$LOCAL/manifests-v2" ] && $RS --copy-links "$LOCAL/manifests-v2/" $P/manifests-v2-backup/ 2>>/workspace/logs/ollama-mirror.log
    fi
  done ) &
while true; do
  /opt/ollama/bin/ollama serve >> /workspace/logs/ollama-a40brain.log 2>&1
  echo "[$(date -u)] ollama serve exited $?; restarting in 5s" >> /workspace/logs/ollama-a40brain.log
  sleep 5
done
