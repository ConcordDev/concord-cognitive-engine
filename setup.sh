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

# ── 3b. Check / install Z3 (OPTIONAL — the reason.verify proof gate) ─────
# Z3 is the SMT checker behind the formal-proof gate (server/lib/proof-gate.js).
# It's OPTIONAL: when absent, reason.verify/reason.prove return verdict:"unavailable"
# and the rest of verification (citation floor + council) is unaffected. We try a
# best-effort install but never fail the setup over it.
info "Checking for Z3 (optional — formal-proof gate)..."
if command -v z3 &>/dev/null; then
  ok "Z3 found at $(command -v z3) ($(z3 --version 2>/dev/null | head -1))"
else
  warn "Z3 not found — attempting a best-effort install (proof gate is optional)."
  if command -v apt-get &>/dev/null; then
    (sudo apt-get update -y && sudo apt-get install -y z3) 2>/dev/null || true
  elif command -v brew &>/dev/null; then
    brew install z3 2>/dev/null || true
  elif command -v pip3 &>/dev/null; then
    pip3 install --quiet z3-solver 2>/dev/null || true   # provides a `z3` console script
  fi
  if command -v z3 &>/dev/null; then
    ok "Z3 installed at $(command -v z3)."
  else
    warn "Z3 still unavailable — reason.verify's formal-proof gate will report"
    warn "verdict:\"unavailable\". Install later with: apt-get install z3  (or  pip3 install z3-solver)"
    warn "and optionally set CONCORD_Z3_PATH to the binary."
  fi
fi

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
# download ~23 GB; subsequent runs are no-ops because ollama pull is
# idempotent. The 14b base is downloaded so Modelfile can build
# concord-conscious from it in step 7b.
info "Pulling required Ollama models (this will download ~23 GB on first run)..."

MODELS=(
  "qwen2.5:14b-instruct-q4_K_M"        # Base for concord-conscious (built via Modelfile below) (~8 GB)
  "qwen2.5:7b-instruct-q4_K_M"        # Subconscious brain    (~4 GB)
  "qwen2.5:3b"                         # Utility brain         (~2 GB)
  "qwen2.5:0.5b"                       # Repair brain          (~0.3 GB)
  "qwen2.5vl:7b"                       # Vision / multimodal   (~7 GB) — Apache-2.0; swapped off llava (CC-BY-NC lineage) per docs/LICENSING.md
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

# ── 11. Generate VAPID keys for web-push (Phase 12 / Item C1) ────────────
# Web push subscriptions require a stable VAPID keypair on the server.
# If the .env already has both keys we leave them alone; otherwise we
# generate a fresh pair via the web-push package that was just installed.
if [ -f "${ROOT_DIR}/.env" ]; then
  if grep -qE '^VAPID_PUBLIC_KEY=.+' "${ROOT_DIR}/.env" && \
     grep -qE '^VAPID_PRIVATE_KEY=.+' "${ROOT_DIR}/.env"; then
    ok "VAPID keys already present in .env — skipping generation."
  else
    info "Generating a new VAPID keypair for web push..."
    if (cd "${ROOT_DIR}/server" && node -e "import('web-push').then(m => { const k = (m.default ?? m).generateVAPIDKeys(); process.stdout.write(k.publicKey + '\\n' + k.privateKey + '\\n'); }).catch(e => { console.error(e?.message || e); process.exit(1); })" > /tmp/vapid-keys.txt 2>/dev/null); then
      VAPID_PUB=$(sed -n '1p' /tmp/vapid-keys.txt)
      VAPID_PRIV=$(sed -n '2p' /tmp/vapid-keys.txt)
      rm -f /tmp/vapid-keys.txt
      if [ -n "$VAPID_PUB" ] && [ -n "$VAPID_PRIV" ]; then
        {
          printf '\n# Web push (VAPID) — auto-generated by setup.sh on %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
          printf 'VAPID_PUBLIC_KEY=%s\n'  "$VAPID_PUB"
          printf 'VAPID_PRIVATE_KEY=%s\n' "$VAPID_PRIV"
          printf 'VAPID_SUBJECT=mailto:noreply@concord-os.org\n'
        } >> "${ROOT_DIR}/.env"
        ok "VAPID keys written to .env"
      else
        warn "web-push generated empty keys — leaving .env untouched. Run manually:"
        warn "  (cd server && node -e \"import('web-push').then(m => console.log((m.default??m).generateVAPIDKeys()))\")"
      fi
    else
      warn "web-push package not available yet — run 'cd server && npm install' first, then re-run setup.sh."
    fi
  fi
fi

# ── 12. Generate ActivityPub RSA keypair (Phase 12 / Item B3) ────────────
# Outbound federated POSTs are signed with this keypair (HTTP Signatures,
# draft-cavage-10) and the matching public PEM is advertised on every
# actor descriptor so peers can verify our signature. Without it,
# Mastodon Authorized-Fetch mode will reject our deliveries.
# Newlines in the PEMs are escaped so .env stays one-line-per-key.
if [ -f "${ROOT_DIR}/.env" ]; then
  if grep -qE '^CONCORD_AP_PRIVATE_KEY_PEM=.+' "${ROOT_DIR}/.env" && \
     grep -qE '^CONCORD_AP_PUBLIC_KEY_PEM=.+' "${ROOT_DIR}/.env"; then
    ok "ActivityPub keys already present in .env — skipping generation."
  else
    info "Generating an RSA-2048 keypair for ActivityPub signing..."
    if (cd "${ROOT_DIR}/server" && node -e "
      const crypto = require('node:crypto');
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const pub = publicKey.export({ format: 'pem', type: 'spki' }).toString();
      const priv = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
      process.stdout.write(pub.replace(/\\n/g, '\\\\n') + '\\n' + priv.replace(/\\n/g, '\\\\n') + '\\n');
    " > /tmp/ap-keys.txt 2>/dev/null); then
      AP_PUB=$(sed -n '1p' /tmp/ap-keys.txt)
      AP_PRIV=$(sed -n '2p' /tmp/ap-keys.txt)
      rm -f /tmp/ap-keys.txt
      if [ -n "$AP_PUB" ] && [ -n "$AP_PRIV" ]; then
        {
          printf '\n# ActivityPub HTTP-Signature keypair — generated by setup.sh on %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
          printf 'CONCORD_AP_PUBLIC_KEY_PEM=%s\n'  "$AP_PUB"
          printf 'CONCORD_AP_PRIVATE_KEY_PEM=%s\n' "$AP_PRIV"
        } >> "${ROOT_DIR}/.env"
        ok "ActivityPub keys written to .env (escaped newlines)."
      else
        warn "AP keypair generation returned empty values — leaving .env untouched."
      fi
    else
      warn "AP keypair generation failed — skipping. Federation outbound posts will be unsigned."
    fi
  fi
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
echo "     (Optional) The VAPID keys for web-push were auto-generated above;"
echo "     edit VAPID_SUBJECT in .env to point at a real ops email."
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
