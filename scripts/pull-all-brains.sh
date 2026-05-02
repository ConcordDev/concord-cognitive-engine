#!/usr/bin/env bash
# pull-all-brains.sh — pre-pull every model the Concord stack needs.
#
# Run once before the first production boot (or any time you've blown away
# the ollama-*-data volumes). Server's initThreeBrains() will also auto-pull
# if Ollama is reachable, but that blocks the first request for 5-10 minutes
# of total download — pre-pulling avoids the cold-start hit.
#
# Targets the four-brain architecture from DEPLOYMENT.md:
#   conscious     qwen2.5:14b-instruct-q4_K_M  (Brain 1, port 11434)
#   subconscious  qwen2.5:7b-instruct-q4_K_M   (Brain 2, port 11435)
#   utility       qwen2.5:3b                    (Brain 3, port 11436)
#   repair        qwen2.5:1.5b                  (Brain 4, port 11437) — was 0.5b
#   vision        llava:7b                      (multimodal)
#   embed         nomic-embed-text              (semantic search)
#
# Usage:
#   ./scripts/pull-all-brains.sh
#
# Override individual models / hosts via env:
#   BRAIN_CONSCIOUS_HOST=http://ollama-conscious:11434 \
#   BRAIN_CONSCIOUS_MODEL=qwen2.5:7b-instruct-q4_K_M \
#   ./scripts/pull-all-brains.sh
#
# Exit 0 if all targeted models are present (after pull). Exit 1 if any
# pull fails — caller should retry with backoff.

set -euo pipefail

# Default hosts (in-cluster). Override via env for non-Docker setups.
BRAIN_CONSCIOUS_HOST="${BRAIN_CONSCIOUS_HOST:-http://localhost:11434}"
BRAIN_SUBCONSCIOUS_HOST="${BRAIN_SUBCONSCIOUS_HOST:-http://localhost:11435}"
BRAIN_UTILITY_HOST="${BRAIN_UTILITY_HOST:-http://localhost:11436}"
BRAIN_REPAIR_HOST="${BRAIN_REPAIR_HOST:-http://localhost:11437}"

BRAIN_CONSCIOUS_MODEL="${BRAIN_CONSCIOUS_MODEL:-qwen2.5:14b-instruct-q4_K_M}"
BRAIN_SUBCONSCIOUS_MODEL="${BRAIN_SUBCONSCIOUS_MODEL:-qwen2.5:7b-instruct-q4_K_M}"
BRAIN_UTILITY_MODEL="${BRAIN_UTILITY_MODEL:-qwen2.5:3b}"
BRAIN_REPAIR_MODEL="${BRAIN_REPAIR_MODEL:-qwen2.5:1.5b}"
VISION_MODEL="${VISION_MODEL:-llava:7b}"
EMBED_MODEL="${EMBED_MODEL:-nomic-embed-text}"

# Pull a single (host, model) pair. Idempotent — Ollama no-ops if present.
pull_model() {
  local host="$1"
  local model="$2"
  local label="$3"

  echo ""
  echo "[$label] Pulling ${model} from ${host}…"

  # Wait for the host to be reachable (up to 60s — model containers may still be starting)
  for i in $(seq 1 60); do
    if curl -sf "${host}/api/tags" > /dev/null 2>&1; then
      break
    fi
    if [ "$i" -eq 60 ]; then
      echo "[$label] ERROR: ${host} unreachable after 60s"
      return 1
    fi
    sleep 1
  done

  # POST /api/pull is the streaming pull endpoint. We just want completion;
  # consume the stream and discard.
  if curl -sf -X POST "${host}/api/pull" \
       -H "Content-Type: application/json" \
       -d "{\"name\":\"${model}\",\"stream\":false}" > /dev/null; then
    echo "[$label] ${model} OK"
    return 0
  else
    echo "[$label] ERROR: pull failed for ${model}"
    return 1
  fi
}

FAIL=0

pull_model "$BRAIN_CONSCIOUS_HOST"    "$BRAIN_CONSCIOUS_MODEL"    "conscious"    || FAIL=1
pull_model "$BRAIN_SUBCONSCIOUS_HOST" "$BRAIN_SUBCONSCIOUS_MODEL" "subconscious" || FAIL=1
pull_model "$BRAIN_UTILITY_HOST"      "$BRAIN_UTILITY_MODEL"      "utility"      || FAIL=1
pull_model "$BRAIN_REPAIR_HOST"       "$BRAIN_REPAIR_MODEL"       "repair"       || FAIL=1

# Vision + embed both live on the conscious instance by convention; if
# you split them out, set VISION_HOST / EMBED_HOST.
pull_model "${VISION_HOST:-$BRAIN_CONSCIOUS_HOST}" "$VISION_MODEL" "vision" || FAIL=1
pull_model "${EMBED_HOST:-$BRAIN_CONSCIOUS_HOST}"  "$EMBED_MODEL"  "embed"  || FAIL=1

echo ""
if [ "$FAIL" -eq 0 ]; then
  echo "[pull-all-brains] All models pulled successfully."
  exit 0
else
  echo "[pull-all-brains] ONE OR MORE PULLS FAILED — retry, or check host reachability + disk space."
  exit 1
fi
