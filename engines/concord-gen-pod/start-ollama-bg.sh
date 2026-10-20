#!/bin/bash
# Concord BACKGROUND brain (2026-10-18, pod-offload PR-0). Second Ollama instance for
# non-user-facing work (idle agents, minor agents, dreams, embeddings). Bound to
# 127.0.0.1:11436, reached from the Mac via launchd com.concord.pod-bg-tunnel.
# Shares the model store with the user-facing instance (start-ollama-a40brain.sh owns
# restore + the /workspace mirror); this script never mirrors.
# Bounded on purpose: user chat (11434) must always win the GPU.
[ -x /opt/ollama/bin/ollama ] || { echo "ollama not installed yet (start-ollama-a40brain.sh first)"; exit 1; }
export OLLAMA_MODELS=/root/ollama-models
export OLLAMA_HOST=127.0.0.1:11436
export OLLAMA_NOPRUNE=1
export OLLAMA_MAX_LOADED_MODELS=3
export OLLAMA_KEEP_ALIVE=30m
export OLLAMA_NUM_PARALLEL=4
export OLLAMA_MAX_QUEUE=64
export OLLAMA_FLASH_ATTENTION=1
# 2026-10-19 pod-restore: q8_0 KV cache frees ~3 GB so TRELLIS v1 fits beside FLUX nf4 + brains (was CUDA OOM)
export OLLAMA_KV_CACHE_TYPE=q8_0
# 2026-10-19 leak fix: llama-server keeps a host-RAM prompt cache, default 8192 MiB PER RUNNER (4 runners = 32 GB
# anon in a 47.7 GB container). It crept up until the cgroup OOM killer took gen-server (largest process). Cap it.
export LLAMA_ARG_CACHE_RAM=${LLAMA_ARG_CACHE_RAM:-512}
export OLLAMA_CONTEXT_LENGTH=4096
mkdir -p /workspace/logs
while true; do
  # 2026-10-19: pinned to 3 CPUs (taskset) + nice 15. Unpinned, its runner spread over the 96 visible cores and burned the
  # whole 7.65-CPU container quota (900%), throttling gen-server/TRELLIS post-processing (mesh 57 s -> 300 s).
  taskset -c ${OLLAMA_BG_CPUS:-0-2} nice -n 15 /opt/ollama/bin/ollama serve >> /workspace/logs/ollama-bg.log 2>&1
  echo "[$(date -u)] ollama-bg exited $?; restarting in 5s" >> /workspace/logs/ollama-bg.log
  sleep 5
done
