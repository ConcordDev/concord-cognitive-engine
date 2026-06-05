#!/usr/bin/env bash
# scripts/runpod-cognition.sh
#
# Single-pod, multi-Ollama brain launcher with CPU-CORE PINNING + GPU ALLOCATION.
# Each of the five brains runs as its OWN Ollama instance on its own port, pinned to
# its own CPU cores (taskset) and assigned its own GPU (CUDA_VISIBLE_DEVICES), serving
# its own model. This is the RunPod (no docker-compose) version of the 5-brain stack —
# it wires each brain to its respective place and isolates their resources.
#
# After it boots + pulls models it points you at the exact BRAIN_<ROLE>_URL values
# (which .env.runpod already expects) and runs the wiring verifier.
#
# Per-role config — override ANY of these in the environment (or .env.runpod) to match
# your pod's core count / GPU layout. Defaults assume ~16 cores + the models in
# .env.runpod. Cores: largest share to conscious; GPU: all on GPU 0 by default (set
# distinct CUDA ids to spread across multiple GPUs).
set -uo pipefail
log() { echo "[cognition] $(date '+%H:%M:%S') $*"; }

# ── per-role resource map (role: port | model | cores | gpu) ─────────────────
declare -A PORT=(  [conscious]=11434 [subconscious]=11435 [utility]=11436 [repair]=11437 [vision]=11438 )
declare -A MODEL=( [conscious]="${BRAIN_CONSCIOUS_MODEL:-concord-conscious:latest}" \
                   [subconscious]="${BRAIN_SUBCONSCIOUS_MODEL:-qwen2.5:7b-instruct-q4_K_M}" \
                   [utility]="${BRAIN_UTILITY_MODEL:-qwen2.5:3b}" \
                   [repair]="${BRAIN_REPAIR_MODEL:-qwen2.5:0.5b}" \
                   [vision]="${BRAIN_VISION_MODEL:-qwen2.5vl:7b}" )
# Single Blackwell GPU → every brain shares GPU 0 (VRAM is the budget, not GPU count).
declare -A GPU=(   [conscious]="${BRAIN_CONSCIOUS_GPU:-0}" [subconscious]="${BRAIN_SUBCONSCIOUS_GPU:-0}" \
                   [utility]="${BRAIN_UTILITY_GPU:-0}" [repair]="${BRAIN_REPAIR_GPU:-0}" \
                   [vision]="${BRAIN_VISION_GPU:-0}" )
ROLES=(conscious subconscious utility repair vision)

NPROC=$(nproc 2>/dev/null || echo 4)

# ── auto-allocate CPU cores from the pod's REAL core count (no hand-tuning) ───
# Reserve the top cores for the backend/frontend/world-shards, split the rest across
# the brains by weight (conscious heaviest), as contiguous ranges. Override any role
# with BRAIN_<ROLE>_CORES to take manual control.
declare -A WEIGHT=( [conscious]=8 [subconscious]=4 [utility]=2 [repair]=1 [vision]=1 ); WSUM=16
APP_RESERVE="${CONCORD_APP_CORE_RESERVE:-2}"
POOL=$NPROC; [ "$NPROC" -gt $((APP_RESERVE + 5)) ] && POOL=$((NPROC - APP_RESERVE))
declare -A CORES; cur=0
for role in "${ROLES[@]}"; do
  ov="BRAIN_$(echo "$role" | tr '[:lower:]' '[:upper:]')_CORES"
  if [ -n "${!ov:-}" ]; then CORES[$role]="${!ov}"; continue; fi   # explicit override wins
  n=$(( POOL * WEIGHT[$role] / WSUM )); [ "$n" -lt 1 ] && n=1
  end=$(( cur + n - 1 )); [ "$end" -gt $((POOL - 1)) ] && end=$((POOL - 1))
  [ "$cur" -gt "$end" ] && cur=$end
  CORES[$role]=$([ "$cur" -eq "$end" ] && echo "$cur" || echo "${cur}-${end}")
  cur=$(( end + 1 ))
done
HAVE_TASKSET=1; command -v taskset >/dev/null 2>&1 || { HAVE_TASKSET=0; log "WARN: taskset not found — CPU pinning DISABLED (apt-get install util-linux)"; }
command -v ollama  >/dev/null 2>&1 || { log "ERROR: ollama not installed (https://ollama.com/download)"; exit 1; }
HAVE_GPU=0; command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1 && HAVE_GPU=1 || log "WARN: no NVIDIA GPU detected — Ollama will run on CPU."

# shared model blob store so a model pulled once is visible to every instance.
export OLLAMA_MODELS="${OLLAMA_MODELS:-$HOME/.ollama/models}"
# Blackwell perf flags from CLAUDE.md — tensor cores + halved KV cache.
export OLLAMA_FLASH_ATTENTION="${OLLAMA_FLASH_ATTENTION:-1}"
export OLLAMA_KV_CACHE_TYPE="${OLLAMA_KV_CACHE_TYPE:-q8_0}"
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}"
LOG_DIR="${LOG_DIR:-/tmp/concord-brains}"; mkdir -p "$LOG_DIR"

log "Stopping any existing Ollama instances..."; pkill -f "ollama serve" 2>/dev/null || true; sleep 2
log "Cores=$NPROC  taskset=$HAVE_TASKSET  gpu=$HAVE_GPU  model-store=$OLLAMA_MODELS"

# ── launch each brain pinned to its cores + GPU ──────────────────────────────
for role in "${ROLES[@]}"; do
  p=${PORT[$role]}; c=${CORES[$role]}; gid=${GPU[$role]}
  pin=""; [ "$HAVE_TASKSET" = 1 ] && pin="taskset -c $c"
  gpuenv=""; [ "$HAVE_GPU" = 1 ] && gpuenv="CUDA_VISIBLE_DEVICES=$gid"
  log "Brain ${role}: port ${p}  cores ${c}  gpu ${gid}  model ${MODEL[$role]}"
  env $gpuenv OLLAMA_HOST="127.0.0.1:${p}" $pin ollama serve > "${LOG_DIR}/brain-${role}.log" 2>&1 &
done

# ── health-check + pull each role's model on its own instance ────────────────
wait_for() { local p=$1 n=$2 a=0; while [ $a -lt 60 ]; do curl -sf "http://127.0.0.1:${p}/api/tags" >/dev/null 2>&1 && { log "${n} ready (:$p)"; return 0; }; a=$((a+1)); sleep 1; done; log "ERROR: ${n} never came up on :$p"; return 1; }
for role in "${ROLES[@]}"; do wait_for "${PORT[$role]}" "$role" || true; done
for role in "${ROLES[@]}"; do
  log "Pulling ${MODEL[$role]} into ${role} (:${PORT[$role]})..."
  OLLAMA_HOST="127.0.0.1:${PORT[$role]}" ollama pull "${MODEL[$role]}" 2>&1 | tail -1 || log "WARN: pull failed for ${role} (custom model? use 'ollama create' from the Modelfile)"
done
# embeddings on the conscious instance (small, CPU, used by the substrate)
OLLAMA_HOST="127.0.0.1:${PORT[conscious]}" ollama pull "${CONCORD_EMBED_MODEL:-nomic-embed-text}" >/dev/null 2>&1 || true

# ── the wiring map the app needs (.env.runpod), then verify ──────────────────
echo ""; log "Brain ⇆ endpoint wiring (set these in .env.runpod):"
for role in "${ROLES[@]}"; do
  RU=$(echo "$role" | tr '[:lower:]' '[:upper:]')
  echo "  BRAIN_${RU}_URL=http://127.0.0.1:${PORT[$role]}"
done
echo ""
if [ -f "$(dirname "$0")/../server/scripts/verify-brain-wiring.mjs" ]; then
  log "Verifying wiring..."
  ( cd "$(dirname "$0")/../server" && \
    BRAIN_CONSCIOUS_URL="http://127.0.0.1:${PORT[conscious]}" \
    BRAIN_SUBCONSCIOUS_URL="http://127.0.0.1:${PORT[subconscious]}" \
    BRAIN_UTILITY_URL="http://127.0.0.1:${PORT[utility]}" \
    BRAIN_REPAIR_URL="http://127.0.0.1:${PORT[repair]}" \
    BRAIN_VISION_URL="http://127.0.0.1:${PORT[vision]}" \
    node scripts/verify-brain-wiring.mjs ) || true
fi
log "Cognition stack up. Logs: ${LOG_DIR}/brain-*.log  (stop: pkill -f 'ollama serve')"
