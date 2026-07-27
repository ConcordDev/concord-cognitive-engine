#!/bin/bash
# bootstrap.sh — first-time provisioning for a FRESH bare-metal GPU box
# (the A40 target). Installs the system-level prerequisites that setup.sh
# and startup.sh hard-require but do not install themselves, then hands
# off to setup.sh.
#
# The honest two-script story is:
#   1. ./bootstrap.sh              (once, on a fresh box — needs root)
#   2. ./startup.sh --cloudflare   (every boot; or --runpod without a tunnel)
#
# Idempotent: every step checks before acting; re-running is safe.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

log()  { echo "[bootstrap] $*"; }
fail() { echo "[bootstrap] ERROR: $*" >&2; exit 1; }

log "=== Concord bare-metal bootstrap ==="

# ── 1. GPU driver sanity ─────────────────────────────────────────────────────
# We do NOT install the NVIDIA driver/CUDA here — driver installs are
# distro/image-specific and usually preinstalled on GPU cloud images. We
# verify and stop with a clear message instead of half-installing.
if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1 || true)
  GPU_MEM=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader 2>/dev/null | head -1 || true)
  log "GPU detected: ${GPU_NAME:-unknown} (${GPU_MEM:-unknown})"
else
  log "WARNING: nvidia-smi not found — no NVIDIA driver visible."
  log "         The 5 Ollama brains will fall back to CPU (very slow)."
  log "         Install the NVIDIA driver for your distro, then re-run."
fi

# ── 2. Node.js >= 20 ─────────────────────────────────────────────────────────
NEED_NODE=true
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
  if [ "${NODE_MAJOR:-0}" -ge 20 ]; then
    NEED_NODE=false
    log "Node.js $(node -v) present."
  else
    log "Node.js $(node -v) is too old (need >= 20)."
  fi
fi
if $NEED_NODE; then
  if command -v apt-get >/dev/null 2>&1; then
    log "Installing Node.js 20 (NodeSource)..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
  else
    fail "Node.js >= 20 required. Install it for your distro, then re-run."
  fi
fi

# ── 3. Base packages ─────────────────────────────────────────────────────────
# util-linux → taskset (CPU pinning); sqlite3 CLI → WAL-safe backups;
# build tools → better-sqlite3 native compile; cron → health/backup watchdogs.
if command -v apt-get >/dev/null 2>&1; then
  log "Installing base packages (git curl sqlite3 build-essential python3 cron util-linux)..."
  apt-get update -qq
  apt-get install -y -qq git curl sqlite3 build-essential python3 cron util-linux >/dev/null
else
  for tool in git curl sqlite3 crontab taskset; do
    command -v "$tool" >/dev/null 2>&1 || log "WARNING: '$tool' not found — install it manually (non-apt distro)."
  done
fi

# ── 4. Ollama ────────────────────────────────────────────────────────────────
if command -v ollama >/dev/null 2>&1; then
  log "Ollama present: $(ollama --version 2>/dev/null | head -1 || echo installed)"
else
  log "Installing Ollama..."
  curl -fsSL https://ollama.com/install.sh | sh
  command -v ollama >/dev/null 2>&1 || fail "Ollama install failed — install manually from https://ollama.com/download"
fi

# ── 5. pm2 ───────────────────────────────────────────────────────────────────
if command -v pm2 >/dev/null 2>&1; then
  log "pm2 present: $(pm2 -v)"
else
  log "Installing pm2..."
  npm install -g pm2
fi

# ── 6. cloudflared (optional — only needed for the CF-tunnel path) ───────────
if ! command -v cloudflared >/dev/null 2>&1; then
  if command -v dpkg >/dev/null 2>&1; then
    log "Installing cloudflared..."
    curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb -o /tmp/cloudflared.deb \
      && dpkg -i /tmp/cloudflared.deb >/dev/null \
      && rm -f /tmp/cloudflared.deb \
      && log "cloudflared installed." \
      || log "WARNING: cloudflared install failed — only needed for ./startup.sh --cloudflare."
  else
    log "NOTE: cloudflared not installed (non-dpkg distro) — only needed for the CF-tunnel path."
  fi
else
  log "cloudflared present."
fi

# ── 7. Hand off to setup.sh ──────────────────────────────────────────────────
log "Prerequisites ready — running setup.sh (deps, data dirs, .env secrets)..."
./setup.sh

log ""
log "=== Bootstrap complete ==="
log "Next steps:"
log "  1. Edit .env — set TUNNEL_PUBLIC_URL (+ run infra/cloudflare/setup-tunnel.sh"
log "     for the CLOUDFLARE_TUNNEL_TOKEN) if deploying behind Cloudflare."
log "  2. ./startup.sh --cloudflare    (or --runpod without a tunnel)"
log "  3. (Recommended) Reboot persistence: see infra/systemd/concord.service"
