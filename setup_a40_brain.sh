#!/bin/bash
# setup_a40_brain.sh — Configure Concord to route brains to NVIDIA A40 GPU
# Run this ONCE after your A40 is online with model weights loaded.

set -e

echo "Concord A40 Brain Routing Setup"
echo "================================"

# Default A40 endpoint (change if your A40 is on a different host/port)
A40_HOST="${1:-http://localhost:11434}"
echo "A40 endpoint: $A40_HOST"
echo ""

# Normalize to ensure http:// prefix (for ollama default; override for https if needed)
if [[ ! "$A40_HOST" =~ ^https?:// ]]; then
  A40_HOST="http://$A40_HOST"
fi
echo "Normalized: $A40_HOST"
echo ""

# Verify A40 is reachable
if ! curl -fsS "$A40_HOST/api/tags" >/dev/null 2>&1; then
  echo "ERROR: Cannot reach $A40_HOST"
  echo "Make sure Ollama is running on your A40 with: ollama serve"
  exit 1
fi

echo "✓ A40 reachable"
echo ""

# Check which models are loaded
MODELS=$(curl -fsS "$A40_HOST/api/tags" | python3 -c "import sys,json; print('\n'.join(m['name'] for m in json.load(sys.stdin).get('models', [])))")
echo "Loaded models on A40:"
echo "$MODELS"
echo ""

# Append to .env
ENV_FILE="/workspace/concord-cognitive-engine/.env"

# Backup
cp "$ENV_FILE" "$ENV_FILE.bak-$(date +%Y%m%d-%H%M%S)"

# Remove existing brain vars
sed -i.bak '/^BRAIN_/d; /^OLLAMA_URL=/d; /^OLLAMA_HOST=/d' "$ENV_FILE"

# Add A40 routing (single instance — all 5 brains)
cat >> "$ENV_FILE" << EOF

# A40 GPU brain routing ($(date +%Y-%m-%d))
OLLAMA_URL=$A40_HOST
BRAIN_CONSCIOUS_URL=$A40_HOST
BRAIN_SUBCONSCIOUS_URL=$A40_HOST
BRAIN_UTILITY_URL=$A40_HOST
BRAIN_REPAIR_URL=$A40_HOST
BRAIN_VISION_URL=$A40_HOST
EOF

echo "✓ .env updated with A40 routing"
echo ""
echo "Restart Concord: bash /tmp/launch.sh"
