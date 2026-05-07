#!/bin/bash
# Pre-warm Ollama models with correct num_ctx values.
# Run BEFORE starting the backend to prevent models loading at default 32768 context
# which blows VRAM on smaller GPUs.

set -e

OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"

echo "[warm-models] Waiting for Ollama..."
until curl -s "$OLLAMA_URL/api/tags" > /dev/null 2>&1; do sleep 2; done
echo "[warm-models] Ollama is up."

# Conscious brain (14B) — main chat model, needs largest context
echo "[warm-models] Loading conscious brain (concord-conscious)..."
curl -s --max-time 120 "$OLLAMA_URL/api/generate" -d '{
  "model":"qwen2.5:14b-q4_K_M",
  "prompt":"ping",
  "stream":false,
  "keep_alive":"24h",
  "options":{"num_ctx":8192}
}' > /dev/null

# Subconscious brain (7B) — background processing
echo "[warm-models] Loading subconscious brain..."
curl -s --max-time 120 "$OLLAMA_URL/api/generate" -d '{
  "model":"qwen2.5:7b",
  "prompt":"ping",
  "stream":false,
  "keep_alive":"24h",
  "options":{"num_ctx":6144}
}' > /dev/null &

# Utility brain (3B) — quick tasks
echo "[warm-models] Loading utility brain..."
curl -s --max-time 60 "$OLLAMA_URL/api/generate" -d '{
  "model":"qwen2.5:3b",
  "prompt":"ping",
  "stream":false,
  "keep_alive":"24h",
  "options":{"num_ctx":2048}
}' > /dev/null &

# Repair brain (1.5B) — lightweight repair cortex
echo "[warm-models] Loading repair brain..."
curl -s --max-time 60 "$OLLAMA_URL/api/generate" -d '{
  "model":"qwen2.5:1.5b",
  "prompt":"ping",
  "stream":false,
  "keep_alive":"24h",
  "options":{"num_ctx":2048}
}' > /dev/null &

# Embedding model
echo "[warm-models] Loading embedding model..."
curl -s --max-time 60 "$OLLAMA_URL/api/embeddings" -d '{
  "model":"nomic-embed-text",
  "prompt":"test",
  "keep_alive":"24h"
}' > /dev/null &

wait
echo "[warm-models] All models loaded and warm."
