#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Concord Cognitive Engine — Bare-Metal Setup Script
# ---------------------------------------------------------------------------
# This script prepares a fresh checkout for local (non-Docker) development
# or production use.  It does NOT start any services — use PM2 or systemd
# for that.  Run from the repository root:
#
#   chmod +x setup.sh && ./setup.sh
#
# ---------------------------------------------------------------------------
set -euo pipefail

# ── Colours (no-op when piped) ────────────────────────────────────────────
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  CYAN='\033[0;36m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; NC=''
fi

info()  { printf "${CYAN}[INFO]${NC}  %s\n" "$*"; }
ok()    { printf "${GREEN}[OK]${NC}    %s\n" "$*"; }
warn()  { printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
fail()  { printf "${RED}[FAIL]${NC}  %s\n" "$*"; exit 1; }

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# ── 1. Check Node.js 18+ ─────────────────────────────────────────────────
info "Checking Node.js version..."
if ! command -v node &>/dev/null; then
  fail "Node.js is not installed.  Install v18 or later: https://nodejs.org/"
fi

NODE_MAJOR="$(node -e 'console.log(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js v18+ required (found v$(node -v | tr -d v)).  Please upgrade."
fi
ok "Node.js v$(node -v | tr -d v)"

# ── 2. Check npm ──────────────────────────────────────────────────────────
info "Checking npm..."
if ! command -v npm &>/dev/null; then
  fail "npm is not installed.  It should ship with Node.js."
fi
ok "npm v$(npm -v)"

# ── 3. Check Ollama ──────────────────────────────────────────────────────
info "Checking for Ollama binary..."
if ! command -v ollama &>/dev/null; then
  fail "Ollama is not installed.  Install it from https://ollama.com/download"
fi
ok "Ollama found at $(command -v ollama)"

# ── 4. Install server dependencies ───────────────────────────────────────
info "Installing server dependencies..."
(cd server && npm install)
ok "Server dependencies installed."

# ── 5. Install frontend dependencies ─────────────────────────────────────
info "Installing frontend dependencies..."
(cd concord-frontend && npm install)
ok "Frontend dependencies installed."

# ── 6. Build frontend ────────────────────────────────────────────────────
info "Building frontend (this may take a minute)..."
(cd concord-frontend && npm run build)
ok "Frontend built."

# ── 7. Pull required Ollama models ───────────────────────────────────────
# Canonical 5-brain set per server/lib/brain-config.js + CLAUDE.md, tuned
# for the RTX PRO 4500 Blackwell (32GB GDDR7). Total weight on first
# download ~15 GB; subsequent runs are no-ops because ollama pull is
# idempotent.
info "Pulling required Ollama models (this will download ~15 GB on first run)..."

MODELS=(
  "qwen2.5:7b-instruct-q4_K_M"        # Subconscious brain    (~4 GB) — also base for concord-conscious below
  "qwen2.5:3b"                         # Utility brain         (~2 GB)
  "qwen2.5:0.5b"                       # Repair brain          (~0.3 GB)
  "llava:13b-v1.6-vicuna-q4_K_M"       # Vision / multimodal   (~8 GB)
  "nomic-embed-text"                   # Embeddings            (~275 MB)
)

for model in "${MODELS[@]}"; do
  info "Pulling ${model}..."
  if ollama pull "$model"; then
    ok "Pulled ${model}"
  else
    warn "Failed to pull ${model} — you can retry later with: ollama pull ${model}"
  fi
done

# ── 7b. Build concord-conscious from Modelfile ────────────────────────────
# concord-conscious:latest is NOT on the Ollama registry — it's a custom
# model built locally from the Modelfile in the repo root. Without this
# step the Conscious brain stays offline forever (initFiveBrains'
# auto-pull fallback 404s because the registry doesn't have it).
# `ollama create` is idempotent — safe to re-run on every setup.
if [ -f "${ROOT_DIR}/Modelfile" ]; then
  info "Building concord-conscious:latest from Modelfile..."
  if ollama create concord-conscious:latest -f "${ROOT_DIR}/Modelfile"; then
    ok "Built concord-conscious:latest"
  else
    warn "Failed to build concord-conscious — fix Modelfile then run: ollama create concord-conscious:latest -f Modelfile"
  fi
else
  warn "No Modelfile at ${ROOT_DIR}/Modelfile — the Conscious brain will be offline. Create one and run: ollama create concord-conscious:latest -f Modelfile"
fi

# ── 8. Create data directory ─────────────────────────────────────────────
DATA_DIR="${ROOT_DIR}/data"
if [ ! -d "$DATA_DIR" ]; then
  info "Creating data directory at ${DATA_DIR}..."
  mkdir -p "$DATA_DIR"
  ok "Data directory created."
else
  ok "Data directory already exists."
fi

# ── 9. Create logs directory ─────────────────────────────────────────────
LOGS_DIR="${ROOT_DIR}/logs"
if [ ! -d "$LOGS_DIR" ]; then
  info "Creating logs directory at ${LOGS_DIR}..."
  mkdir -p "$LOGS_DIR"
  ok "Logs directory created."
else
  ok "Logs directory already exists."
fi

# ── 10. Seed .env from .env.example ──────────────────────────────────────
if [ ! -f "${ROOT_DIR}/.env" ]; then
  if [ -f "${ROOT_DIR}/.env.example" ]; then
    cp "${ROOT_DIR}/.env.example" "${ROOT_DIR}/.env"
    ok "Created .env from .env.example"
  else
    warn ".env.example not found — you will need to create .env manually."
  fi
else
  ok ".env already exists — skipping copy."
fi

# ── Done ──────────────────────────────────────────────────────────────────
echo ""
echo "============================================"
echo "  Concord Cognitive Engine — Setup Complete"
echo "============================================"
echo ""
echo "Next steps:"
echo ""
echo "  1. Edit .env and fill in the REQUIRED values:"
echo ""
echo "     JWT_SECRET        — generate with: openssl rand -hex 64"
echo "     SESSION_SECRET    — generate with: openssl rand -hex 32"
echo "     ADMIN_PASSWORD    — choose a strong password (12+ chars)"
echo "     GRAFANA_PASSWORD  — choose a strong password for Grafana"
echo ""
echo "  2. (Optional) Set OPENAI_API_KEY if you want cloud LLM features."
echo ""
echo "  3. Start with PM2:"
echo "     pm2 start ecosystem.config.cjs"
echo ""
echo "  4. Or start manually:"
echo "     cd server && node server.js"
echo "     cd concord-frontend && npm start"
echo ""
echo "  5. Open http://localhost:3000 in your browser."
echo ""
