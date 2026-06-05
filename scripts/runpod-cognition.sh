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
# Per-role residency. Empty → inherit the global OLLAMA_KEEP_ALIVE (set below). Set a
# SHORT value for a bursty brain to make it load-on-demand and free its VRAM for a bigger
# Concordia slice — e.g. BRAIN_VISION_KEEP_ALIVE=30s evicts vision (~6.9GB) when idle, so
# you can raise CONCORD_WORLD_VRAM_MB without over-committing the card. The trade is a
# cold-load latency on the first vision call after idle. Conscious/subconscious should
# stay hot (long keep-alive) — they're on the chat + world-sim hot path.
declare -A KEEPALIVE=( [conscious]="${BRAIN_CONSCIOUS_KEEP_ALIVE:-}" [subconscious]="${BRAIN_SUBCONSCIOUS_KEEP_ALIVE:-}" \
                       [utility]="${BRAIN_UTILITY_KEEP_ALIVE:-}" [repair]="${BRAIN_REPAIR_KEEP_ALIVE:-}" \
                       [vision]="${BRAIN_VISION_KEEP_ALIVE:-}" )
ROLES=(conscious subconscious utility repair vision)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Custom models that are NOT on the Ollama registry are BUILT from a Modelfile via
# `ollama create`, not pulled. concord-conscious is the 14B flagship built from the
# repo-root Modelfile (FROM qwen2.5:14b-instruct-q4_K_M). A pull of a custom tag 404s —
# this map tells the launcher to build it instead. Empty → pull from the registry.
declare -A MODELFILE=( [conscious]="${BRAIN_CONSCIOUS_MODELFILE:-$REPO_ROOT/Modelfile}" )

# ── cgroup/cpuset-aware core detection ───────────────────────────────────────
# CRITICAL: `nproc` reports the HOST's core count, NOT the pod's cgroup slice — on
# RunPod a pod is a sliver of a big host, so nproc can read 128 while you actually have
# ~16 cores. Pinning math built on nproc lands OUTSIDE the allowed set and every taskset
# call fails with "Invalid argument". The real allowed set is in /proc/self/status
# (Cpus_allowed_list, e.g. "0-15" or "2-5,40-43"). We expand it to explicit ids and pin
# only within it. (Verified: github.com/moby/moby/issues/43205 — procfs isn't cgroup-virtualized.)
read_allowed_cpus() {
  local spec parts part lo hi i; local -a ids=()
  spec="$(grep -i '^Cpus_allowed_list:' /proc/self/status 2>/dev/null | awk '{print $2}')"
  [ -z "$spec" ] && spec="0-$(( $(nproc 2>/dev/null || echo 4) - 1 ))"
  IFS=',' read -ra parts <<< "$spec"
  for part in "${parts[@]}"; do
    if [[ "$part" == *-* ]]; then lo="${part%-*}"; hi="${part#*-}"; for ((i=lo;i<=hi;i++)); do ids+=("$i"); done
    else ids+=("$part"); fi
  done
  echo "${ids[@]}"
}
ALLOWED=( $(read_allowed_cpus) ); NCORES=${#ALLOWED[@]}; [ "$NCORES" -lt 1 ] && { ALLOWED=(0); NCORES=1; }
idslice() { local a=$1 b=$2 out=() i; for ((i=a;i<=b && i<NCORES;i++)); do out+=("${ALLOWED[$i]}"); done; (IFS=,; echo "${out[*]}"); }

# ── auto-allocate CPU cores from the pod's REAL (cgroup) core set ─────────────
# Ollama inference is GPU-bound — the CPU side is just dispatch/tokenization — so the
# five brains are confined to an OLLAMA BAND (~35% of cores, low end). The LARGE middle
# band is left for the BACKEND, which hosts Concordia's world simulation (the
# world-shard worker_threads + governorTick + 124 heartbeats + NPC/physics sim) — that's
# the world lens's "power cores". The top band is the frontend. pin-processes.sh pins the
# backend(world)+frontend to those bands after the app starts; this script keeps the
# brains in their lane so they don't steal Concordia's cores. (Matches pin-processes.sh:
# OLLAMA_CORE_PCT / FRONTEND_CORE_PCT.)
declare -A WEIGHT=( [conscious]=8 [subconscious]=4 [utility]=2 [repair]=1 [vision]=1 ); WSUM=16
OLLAMA_PCT="${OLLAMA_CORE_PCT:-35}"
POOL=$(( NCORES * OLLAMA_PCT / 100 )); [ "$POOL" -lt 1 ] && POOL=1; [ "$POOL" -gt "$NCORES" ] && POOL=$NCORES
FE_PCT="${FRONTEND_CORE_PCT:-10}"; FE_COUNT=$(( NCORES * FE_PCT / 100 )); [ "$FE_COUNT" -lt 1 ] && FE_COUNT=1
[ $(( POOL + FE_COUNT )) -ge "$NCORES" ] && FE_COUNT=$(( NCORES - POOL - 1 )); [ "$FE_COUNT" -lt 1 ] && FE_COUNT=1
WORLD_START_IDX=$POOL; WORLD_END_IDX=$(( NCORES - FE_COUNT - 1 )); [ "$WORLD_END_IDX" -lt "$WORLD_START_IDX" ] && WORLD_END_IDX=$WORLD_START_IDX
declare -A CORES; cur=0
for role in "${ROLES[@]}"; do
  ov="BRAIN_$(echo "$role" | tr '[:lower:]' '[:upper:]')_CORES"
  if [ -n "${!ov:-}" ]; then CORES[$role]="${!ov}"; continue; fi   # explicit override wins
  n=$(( POOL * WEIGHT[$role] / WSUM )); [ "$n" -lt 1 ] && n=1
  endi=$(( cur + n - 1 )); [ "$endi" -gt $((POOL - 1)) ] && endi=$((POOL - 1))
  [ "$cur" -gt "$endi" ] && cur=$endi
  CORES[$role]="$(idslice "$cur" "$endi")"
  cur=$(( endi + 1 ))
done
# the ACTUAL allowed core ids for the Concordia/world-sim band — export for
# pin-processes.sh / the operator (a comma list taskset -c accepts verbatim).
export CONCORD_WORLD_CORES="$(idslice "$WORLD_START_IDX" "$WORLD_END_IDX")"
FE_CORES="$(idslice $((WORLD_END_IDX+1)) $((NCORES-1)))"
HAVE_TASKSET=1; command -v taskset >/dev/null 2>&1 || { HAVE_TASKSET=0; log "WARN: taskset not found — CPU pinning DISABLED (apt-get install util-linux)"; }
command -v ollama  >/dev/null 2>&1 || { log "ERROR: ollama not installed (https://ollama.com/download)"; exit 1; }
HAVE_GPU=0; command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1 && HAVE_GPU=1 || log "WARN: no NVIDIA GPU detected — Ollama will run on CPU."

# shared model blob store (content-addressed; a model pulled once is visible to every
# instance). Default it onto the RunPod PERSISTENT /workspace volume when present so the
# ~26GB of weights survive pod restart (the container disk is wiped on terminate); else
# fall back to $HOME. Pulls run sequentially below so the shared dir won't hit write races.
DEFAULT_MODELS_DIR="$HOME/.ollama/models"; [ -d /workspace ] && DEFAULT_MODELS_DIR="/workspace/.ollama/models"
export OLLAMA_MODELS="${OLLAMA_MODELS:-$DEFAULT_MODELS_DIR}"; mkdir -p "$OLLAMA_MODELS" 2>/dev/null || true
# Blackwell perf flags from CLAUDE.md — tensor cores + halved KV cache. NUM_PARALLEL=1 is
# load-bearing for the VRAM fit: KV scales with NUM_PARALLEL × context, and with 5 SEPARATE
# serve processes there's no cross-process LRU safety net — an over-commit is a hard CUDA
# OOM, not a graceful unload. Keep it at 1 unless you've measured the headroom.
export OLLAMA_FLASH_ATTENTION="${OLLAMA_FLASH_ATTENTION:-1}"
export OLLAMA_KV_CACHE_TYPE="${OLLAMA_KV_CACHE_TYPE:-q8_0}"
export OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}"
export OLLAMA_NUM_PARALLEL="${OLLAMA_NUM_PARALLEL:-1}"
# Flash attention is EXPERIMENTAL on vision/multimodal (may degrade qwen2.5vl) — default it
# OFF for the vision instance. q8_0 KV REQUIRES flash attention (silently falls back to f16
# without it), so a FA-off instance also drops to f16 KV — set explicitly per role below.
declare -A FLASHATTN=( [vision]="${BRAIN_VISION_FLASH_ATTENTION:-0}" )
# ── Concordia's GPU "slice" (a soft buffer, honestly labelled) ──────────────────
# OLLAMA_GPU_OVERHEAD asks each instance to keep N bytes free per GPU — BUT it is NOT
# reliably enforced (open bug github.com/ollama/ollama/issues/12223), and it can't fence
# VRAM for a non-Ollama consumer. Concordia has no server-side CUDA of its own anyway (its
# 3D render is client-side Three.js), so this "slice" is really FIT MARGIN: headroom the
# brains' own KV growth shouldn't eat. The real guarantee is the pre-boot fit check
# (verify-resource-allocation.mjs) + BRAIN_VISION_KEEP_ALIVE to shed ~6.9GB on demand —
# NOT this env var. We still set it (it helps when honored), just don't trust it as a fence.
CONCORD_WORLD_VRAM_MB="${CONCORD_WORLD_VRAM_MB:-6144}"
export OLLAMA_GPU_OVERHEAD=$(( CONCORD_WORLD_VRAM_MB * 1024 * 1024 ))
export CONCORD_WORLD_GPU="${CONCORD_WORLD_GPU:-0}"
LOG_DIR="${LOG_DIR:-/tmp/concord-brains}"; mkdir -p "$LOG_DIR"

log "Stopping any existing Ollama instances..."; pkill -f "ollama serve" 2>/dev/null || true; sleep 2
log "Cores: allowed=${NCORES} (cgroup set [$(IFS=,; echo "${ALLOWED[*]}" | cut -c1-40)…])  taskset=$HAVE_TASKSET  gpu=$HAVE_GPU  model-store=$OLLAMA_MODELS"

# ── launch each brain pinned to its cores + GPU ──────────────────────────────
for role in "${ROLES[@]}"; do
  p=${PORT[$role]}; c=${CORES[$role]}; gid=${GPU[$role]}
  pin=""; [ "$HAVE_TASKSET" = 1 ] && [ -n "$c" ] && pin="taskset -c $c"
  gpuenv=""; [ "$HAVE_GPU" = 1 ] && gpuenv="CUDA_VISIBLE_DEVICES=$gid"
  ka="${KEEPALIVE[$role]:-$OLLAMA_KEEP_ALIVE}"          # per-role residency; empty inherits global
  fa="${FLASHATTN[$role]:-$OLLAMA_FLASH_ATTENTION}"     # per-role flash attn; vision defaults off
  kv="$OLLAMA_KV_CACHE_TYPE"; [ "$fa" = "0" ] && kv="f16"   # q8_0 KV needs FA — drop to f16 when FA off
  log "Brain ${role}: port ${p}  cores ${c:-<unpinned>}  gpu ${gid}  keep-alive ${ka}  flash-attn ${fa}  kv ${kv}  model ${MODEL[$role]}"
  env $gpuenv OLLAMA_HOST="127.0.0.1:${p}" OLLAMA_KEEP_ALIVE="$ka" OLLAMA_FLASH_ATTENTION="$fa" \
      OLLAMA_KV_CACHE_TYPE="$kv" OLLAMA_MAX_LOADED_MODELS=1 OLLAMA_NUM_PARALLEL="$OLLAMA_NUM_PARALLEL" \
      $pin ollama serve > "${LOG_DIR}/brain-${role}.log" 2>&1 &
done

# ── health-check + pull each role's model on its own instance ────────────────
wait_for() { local p=$1 n=$2 a=0; while [ $a -lt 60 ]; do curl -sf "http://127.0.0.1:${p}/api/tags" >/dev/null 2>&1 && { log "${n} ready (:$p)"; return 0; }; a=$((a+1)); sleep 1; done; log "ERROR: ${n} never came up on :$p"; return 1; }
for role in "${ROLES[@]}"; do wait_for "${PORT[$role]}" "$role" || true; done
for role in "${ROLES[@]}"; do
  mf="${MODELFILE[$role]:-}"
  if [ -n "$mf" ] && [ -f "$mf" ]; then
    # custom model → build from its Modelfile (ollama create auto-pulls the FROM base).
    # idempotent + cheap if already built; the shared blob store makes it visible to all.
    log "Building ${MODEL[$role]} for ${role} (:${PORT[$role]}) from ${mf} — first build downloads the base, ~minutes..."
    OLLAMA_HOST="127.0.0.1:${PORT[$role]}" ollama create "${MODEL[$role]}" -f "$mf" 2>&1 | tail -2 \
      || log "ERROR: build failed for ${role} from ${mf} — the Conscious brain will be offline. Check the Modelfile FROM base is pullable."
  elif [ -n "$mf" ]; then
    log "WARN: ${role} expects a Modelfile at ${mf} but it's missing — falling back to pull (will 404 for a custom tag)."
    OLLAMA_HOST="127.0.0.1:${PORT[$role]}" ollama pull "${MODEL[$role]}" 2>&1 | tail -1 || log "WARN: pull failed for ${role}"
  else
    log "Pulling ${MODEL[$role]} into ${role} (:${PORT[$role]})..."
    OLLAMA_HOST="127.0.0.1:${PORT[$role]}" ollama pull "${MODEL[$role]}" 2>&1 | tail -1 || log "WARN: pull failed for ${role} (registry model unreachable — check egress)"
  fi
done
# embeddings on the conscious instance (small, CPU, used by the substrate)
OLLAMA_HOST="127.0.0.1:${PORT[conscious]}" ollama pull "${CONCORD_EMBED_MODEL:-nomic-embed-text}" >/dev/null 2>&1 || true

# ── the wiring map the app needs (.env.runpod), then verify ──────────────────
echo ""; log "Brain ⇆ endpoint wiring (set these in .env.runpod):"
for role in "${ROLES[@]}"; do
  RU=$(echo "$role" | tr '[:lower:]' '[:upper:]')
  echo "  BRAIN_${RU}_URL=http://127.0.0.1:${PORT[$role]}  ${dim:-}(cores ${CORES[$role]}, gpu ${GPU[$role]})"
done
echo ""
log "CPU bands (cgroup-allowed ids):  brains [$(idslice 0 $((POOL-1)))]   Concordia/world-sim [${CONCORD_WORLD_CORES}]   frontend [${FE_CORES}]"
log "  → after the app starts, pin the backend (Concordia lives in its worker_threads) +"
log "    frontend to their bands:  CONCORD_WORLD_CORES=${CONCORD_WORLD_CORES} bash scripts/pin-processes.sh"
log "GPU (the one Blackwell): the Concordia VRAM 'slice' is FIT MARGIN, not a hard fence —"
log "  ${CONCORD_WORLD_VRAM_MB} MB is requested free via OLLAMA_GPU_OVERHEAD, but that env var is NOT"
log "  reliably enforced (ollama#12223) and Concordia has no server-side CUDA anyway (Three.js is"
log "  client-side). The real guarantee is the pre-boot fit check + BRAIN_VISION_KEEP_ALIVE to shed"
log "  ~6.9GB on demand. Concordia's dedicated cognition is the SUBCONSCIOUS brain (dream/oracle/"
log "  forward-sim route there) on GPU ${CONCORD_WORLD_GPU}. If 5 models + margin exceed 32GB it's a"
log "  hard CUDA OOM (no cross-process LRU) — drop CONCORD_GPU_PROFILE a band or evict vision."
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
