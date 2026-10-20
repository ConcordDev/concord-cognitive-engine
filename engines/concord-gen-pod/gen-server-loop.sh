#!/bin/bash
# Restart loop for concord_gen_server.py (started by /workspace/start_gen_server.sh inside tmux "gen-server").
export PYTHONUSERBASE=/root/gen/userbase HF_HOME=/root/gen/hf-cache HF_HUB_OFFLINE=1 \
  PYTHONPATH=/root/gen/TRELLIS:${PYTHONPATH:-} CONCORD_TRELLIS1_REPO=/root/gen/TRELLIS \
  ATTN_BACKEND=sdpa SPARSE_BACKEND=spconv TORCH_HOME=/root/gen/torch-home \
  CONCORD_GEN_MODELS=/workspace/models CONCORD_GEN_PORT=7870 CUDA_VISIBLE_DEVICES=0 PYTHONUNBUFFERED=1 \
  CONCORD_FLUX_MODE=${CONCORD_FLUX_MODE:-nf4} PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True \
  MALLOC_ARENA_MAX=2 CONCORD_GEN_THREADS=${CONCORD_GEN_THREADS:-6} OMP_NUM_THREADS=${OMP_NUM_THREADS:-6} MKL_NUM_THREADS=${MKL_NUM_THREADS:-6} OPENBLAS_NUM_THREADS=${OPENBLAS_NUM_THREADS:-6}
while true; do
  echo "$(date -u +%FT%TZ) starting concord_gen_server" >> /workspace/logs/gen-server.out.log
  python3 /workspace/concord_gen_server.py >> /workspace/logs/gen-server.out.log 2>> /workspace/logs/gen-server.err.log
  rc=$?
  echo "$(date -u +%FT%TZ) exited rc=$rc (137 = killed, e.g. cgroup OOM); restart in 5s" >> /workspace/logs/gen-server.out.log
  sleep 5
done
