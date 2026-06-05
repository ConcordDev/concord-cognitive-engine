#!/usr/bin/env bash
# scripts/runpod-up.sh
#
# One command to bring Concord up on a RunPod pod (NO docker-compose): it chains the
# whole boot in the correct order, GATED on the pre-flight verifiers so a bad config
# can't half-boot. The sequence is exactly the dependency order the architecture needs:
#
#   1. load .env.runpod                       (the single source of config)
#   2. preflight-production.sh                (required secrets present — JWT/SESSION/...)
#   3. verify-prod-flags.mjs                  (living-layer ON, security footguns OFF)
#   4. verify-resource-allocation.mjs         (the 5 brains + Concordia slice FIT the card)
#   5. runpod-cognition.sh                    (launch 5 pinned Ollama brains; verifies wiring)
#   6. npm run migrate                         (DB schema up to head)
#   7. start backend (:5050) + frontend (:3000) under pm2
#   8. pin-processes.sh                       (CPU bands: brains | Concordia/world | frontend)
#   9. print the Cloudflare tunnel command    (concord-os.org)
#
# Each verifier is a HARD GATE (exit non-zero stops the boot) — pass --force to downgrade
# them to warnings (e.g. to boot on a box without nvidia-smi for a dry run). Pass
# --no-tunnel to skip step 9's reminder, --no-brains to reuse an already-running cognition
# stack (skips step 5).
#
# Usage:
#   bash scripts/runpod-up.sh                 # full gated boot
#   bash scripts/runpod-up.sh --force         # boot even if a gate fails (warns)
#   bash scripts/runpod-up.sh --no-brains     # brains already up via runpod-cognition.sh
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
log()  { echo -e "\033[36m[up]\033[0m $(date '+%H:%M:%S') $*"; }
die()  { echo -e "\033[31m[up] FATAL:\033[0m $*" >&2; exit 1; }
warn() { echo -e "\033[33m[up] WARN:\033[0m $*" >&2; }

FORCE=0; DO_BRAINS=1; DO_TUNNEL=1
for a in "$@"; do case "$a" in
  --force) FORCE=1 ;;
  --no-brains) DO_BRAINS=0 ;;
  --no-tunnel) DO_TUNNEL=0 ;;
  --help|-h) sed -n '2,28p' "$0"; exit 0 ;;
  *) warn "unknown arg: $a" ;;
esac; done

# A gate: run a command; on failure either die (default) or warn (--force).
gate() { local what="$1"; shift; if "$@"; then log "✓ $what"; else
  if [ "$FORCE" = 1 ]; then warn "$what FAILED — continuing (--force)"; else die "$what FAILED (fix it, or re-run with --force to override)"; fi
fi; }

# ── 1. load env ──────────────────────────────────────────────────────────────
[ -f .env.runpod ] || die ".env.runpod not found in $ROOT — copy + fill it first."
log "Loading .env.runpod"
set -a; . ./.env.runpod; set +a
export NODE_ENV="${NODE_ENV:-production}"

# ── 2–4. pre-flight gates (no side effects, fail fast) ───────────────────────
[ -f scripts/preflight-production.sh ] && gate "preflight (required secrets)" bash scripts/preflight-production.sh || warn "preflight-production.sh missing — skipping secret check"
gate "prod-flag posture (living-layer on, footguns off)" node server/scripts/verify-prod-flags.mjs
gate "GPU resource fit (5 brains + Concordia slice ≤ card)" node server/scripts/verify-resource-allocation.mjs

# ── 5. cognition stack: 5 pinned Ollama brains (self-verifies wiring) ────────
if [ "$DO_BRAINS" = 1 ]; then
  log "Launching the 5-brain cognition stack (runpod-cognition.sh)…"
  gate "cognition stack up + brains wired" bash scripts/runpod-cognition.sh
  # export the Concordia power-core band the launcher computed, for the pinner.
  [ -n "${CONCORD_WORLD_CORES:-}" ] || warn "CONCORD_WORLD_CORES not exported by cognition script"
else
  log "--no-brains: assuming cognition stack already running; verifying wiring only"
  gate "brains wired" bash -c 'cd server && node scripts/verify-brain-wiring.mjs'
fi

# ── 6. DB migrations to head ─────────────────────────────────────────────────
log "Applying DB migrations…"
gate "migrations at head" bash -c 'cd server && npm run migrate'

# ── 7. start backend + frontend under pm2 ────────────────────────────────────
command -v pm2 >/dev/null 2>&1 || die "pm2 not installed (npm i -g pm2) — needed to supervise backend+frontend."
log "Starting backend (:${PORT:-5050})…"
pm2 start "$ROOT/server/server.js" --name concord-backend --cwd "$ROOT/server" \
  --node-args="--max-old-space-size=${MAX_OLD_SPACE_SIZE:-32768}" --max-memory-restart 30G --update-env 2>/dev/null \
  || pm2 restart concord-backend --update-env 2>/dev/null || warn "backend pm2 start failed"
log "Waiting for backend health…"
a=0; until curl -sf "http://127.0.0.1:${PORT:-5050}/api/status" >/dev/null 2>&1; do a=$((a+1)); [ $a -gt 90 ] && { warn "backend never reported healthy on :${PORT:-5050}"; break; }; sleep 2; done
[ $a -le 90 ] && log "✓ backend healthy"

if [ -d "$ROOT/concord-frontend" ]; then
  log "Starting frontend (:3000)…"
  if [ -f scripts/start-frontend.sh ]; then
    pm2 start "$ROOT/scripts/start-frontend.sh" --name concord-frontend --interpreter bash 2>/dev/null \
      || pm2 restart concord-frontend 2>/dev/null || warn "frontend pm2 start failed"
  else
    pm2 start "npm" --name concord-frontend --cwd "$ROOT/concord-frontend" -- start 2>/dev/null \
      || pm2 restart concord-frontend 2>/dev/null || warn "frontend pm2 start failed (run npm run build first?)"
  fi
fi
pm2 save 2>/dev/null || true

# ── 8. pin CPU bands (brains | Concordia/world-sim | frontend) ───────────────
if [ -f scripts/pin-processes.sh ]; then
  log "Pinning CPU bands (Concordia/world-sim = ${CONCORD_WORLD_CORES:-auto})…"
  CONCORD_WORLD_CORES="${CONCORD_WORLD_CORES:-}" OLLAMA_CORE_PCT="${OLLAMA_CORE_PCT:-35}" FRONTEND_CORE_PCT="${FRONTEND_CORE_PCT:-10}" \
    bash scripts/pin-processes.sh || warn "pin-processes.sh failed (taskset missing?) — sim still runs, just unpinned"
fi

# ── 9. tunnel reminder ───────────────────────────────────────────────────────
echo ""
log "\033[32mConcord is up.\033[0m  backend :${PORT:-5050}  frontend :3000   (pm2 list / pm2 logs)"
if [ "$DO_TUNNEL" = 1 ]; then
  log "Expose it on concord-os.org with the Cloudflare tunnel:"
  log "  cloudflared tunnel --config infra/cloudflare/cloudflared.yml run"
  log "  (copy infra/cloudflare/cloudflared.runpod.yml.example → cloudflared.yml, fill TUNNEL_UUID first)"
fi
log "Post-deploy smoke check:  bash scripts/runpod-smoke.sh https://concord-os.org"
