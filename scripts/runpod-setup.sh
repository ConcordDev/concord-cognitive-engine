#!/usr/bin/env bash
# scripts/runpod-setup.sh
#
# ONE-TIME fresh-pod bootstrap for Concord on RunPod (NO docker-compose). Run this once
# on a new pod; then `scripts/runpod-up.sh` every boot. It does the host prep that has to
# happen before the stack can start, and it REMOVES the manual-secret step — it generates
# JWT/SESSION/ADMIN into a gitignored .env so the prod-flag gate passes without you
# hand-editing anything. Idempotent: safe to re-run (skips what's already done).
#
#   1. tool check            (node 18+, npm, ollama, pm2, taskset)
#   2. seed .env             (cp .env.runpod -> .env, the gitignored working file)
#   3. auto-gen secrets      (JWT_SECRET / SESSION_SECRET / ADMIN_PASSWORD if blank)
#   4. install deps          (server + frontend)
#   5. build frontend        (next build)
#   6. data/log dirs
#   7. DB migrations to head
#   8. acquire models        (pull the 4 base brains + build concord-conscious from Modelfile)
#
# Model acquisition (8) is OPTIONAL here (runpod-up.sh's cognition launch also builds/pulls
# on first run) — pass --with-models to pre-warm them now so the first boot is fast, or
# --no-models to skip. Default: skip (let the first runpod-up.sh do it under the real pins).
#
# Usage:
#   bash scripts/runpod-setup.sh                 # host prep + secrets (no model download)
#   bash scripts/runpod-setup.sh --with-models   # also pull bases + build concord-conscious
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
C='\033[0;36m'; G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
info() { echo -e "${C}[setup]${N} $*"; }
ok()   { echo -e "${G}[setup] ✓${N} $*"; }
warn() { echo -e "${Y}[setup] !${N} $*"; }
die()  { echo -e "${R}[setup] FATAL:${N} $*" >&2; exit 1; }

WITH_MODELS=0
for a in "$@"; do case "$a" in
  --with-models) WITH_MODELS=1 ;;
  --no-models) WITH_MODELS=0 ;;
  --help|-h) sed -n '2,24p' "$0"; exit 0 ;;
  *) warn "unknown arg: $a" ;;
esac; done

# ── 1. tool check ────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "node not found (need v18+)."
NMAJ="$(node -e 'console.log(process.versions.node.split(".")[0])')"; [ "$NMAJ" -ge 18 ] || die "node v18+ required (found $(node -v))."
command -v npm  >/dev/null 2>&1 || die "npm not found."
command -v ollama >/dev/null 2>&1 || warn "ollama not found — install from https://ollama.com/download before runpod-up.sh."
command -v pm2  >/dev/null 2>&1 || warn "pm2 not found — 'npm i -g pm2' before runpod-up.sh (it supervises backend+frontend)."
command -v taskset >/dev/null 2>&1 || warn "taskset not found — CPU pinning will be skipped ('apt-get install util-linux')."
ok "tools: node $(node -v), npm $(npm -v)$(command -v ollama >/dev/null 2>&1 && echo ', ollama')$(command -v pm2 >/dev/null 2>&1 && echo ', pm2')"

# ── 2. seed .env from the RunPod template ────────────────────────────────────
if [ ! -f .env ]; then
  [ -f .env.runpod ] || die ".env.runpod template not found — can't seed .env."
  cp .env.runpod .env
  ok "seeded .env from .env.runpod (gitignored — safe place for secrets)"
else
  ok ".env already exists — leaving it (re-run won't clobber your secrets)"
fi

# ── 3. auto-generate the blocking secrets if blank ───────────────────────────
# Writes into .env (gitignored). Only fills a key that is present-but-empty or absent.
gen_secret() { command -v openssl >/dev/null 2>&1 && openssl rand -hex "$1" || node -e "console.log(require('crypto').randomBytes($1).toString('hex'))"; }
gen_pw()     { command -v openssl >/dev/null 2>&1 && openssl rand -base64 18 | tr -d '/+=' | cut -c1-20 || node -e "console.log(require('crypto').randomBytes(15).toString('base64').replace(/[/+=]/g,'').slice(0,20))"; }
set_env() {  # set_env KEY VALUE — replace `KEY=` (blank) or append if absent
  local k="$1" v="$2"
  if grep -qE "^${k}=.+" .env; then return 1; fi          # already has a value → leave it
  if grep -qE "^${k}=$" .env; then
    # portable in-place edit of the blank assignment
    node -e "const fs=require('fs');const f='.env';let s=fs.readFileSync(f,'utf8');s=s.replace(new RegExp('^${k}=\$','m'),'${k}='+process.argv[1]);fs.writeFileSync(f,s);" "$v"
  else
    printf '\n%s=%s\n' "$k" "$v" >> .env
  fi
  return 0
}
GENERATED=()
set_env JWT_SECRET     "$(gen_secret 64)" && GENERATED+=("JWT_SECRET")
set_env SESSION_SECRET "$(gen_secret 32)" && GENERATED+=("SESSION_SECRET")
# ADMIN_PASSWORD is commented in the template; only set it if there's no active line.
if ! grep -qE "^ADMIN_PASSWORD=.+" .env; then
  ADMIN_PW="$(gen_pw)"; printf '\nADMIN_PASSWORD=%s\n' "$ADMIN_PW" >> .env; GENERATED+=("ADMIN_PASSWORD")
fi
if [ "${#GENERATED[@]}" -gt 0 ]; then
  ok "generated secrets into .env: ${GENERATED[*]}"
  [ -n "${ADMIN_PW:-}" ] && warn "first-run admin password: ${ADMIN_PW}  (saved in .env — record it now)"
else
  ok "secrets already set in .env — none generated"
fi

# ── 4. install deps ──────────────────────────────────────────────────────────
info "installing server deps…"; (cd server && npm install --no-audit --no-fund) && ok "server deps" || die "server npm install failed"
if [ -d concord-frontend ]; then
  info "installing frontend deps…"; (cd concord-frontend && npm install --no-audit --no-fund) && ok "frontend deps" || warn "frontend npm install failed"
fi

# ── 5. build frontend ────────────────────────────────────────────────────────
if [ -d concord-frontend ]; then
  info "building frontend (next build — a minute or two)…"
  (cd concord-frontend && npm run build) && ok "frontend built" || warn "frontend build failed — fix before runpod-up.sh (the UI won't serve)"
fi

# ── 6. data / log dirs ───────────────────────────────────────────────────────
mkdir -p data logs server/data; ok "data/log dirs"

# ── 7. DB migrations ─────────────────────────────────────────────────────────
info "applying DB migrations…"; (set -a; . ./.env; set +a; cd server && npm run migrate) && ok "DB at head" || warn "migrations failed — check DB_PATH + better-sqlite3 build"

# ── 8. (optional) acquire models now ─────────────────────────────────────────
if [ "$WITH_MODELS" = 1 ]; then
  command -v ollama >/dev/null 2>&1 || die "--with-models needs ollama installed."
  info "pre-warming models: pulling base brains + building concord-conscious…"
  # a temporary single serve just to pull/build into the shared blob store
  pkill -f "ollama serve" 2>/dev/null || true; sleep 1
  OLLAMA_HOST="127.0.0.1:11434" ollama serve >/tmp/concord-setup-ollama.log 2>&1 &
  for _ in $(seq 1 60); do curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 1; done
  for m in "qwen2.5:14b-instruct-q4_K_M" "qwen2.5:7b-instruct-q4_K_M" "qwen2.5:3b" "qwen2.5:0.5b" "qwen2.5vl:7b" "nomic-embed-text"; do
    info "pull ${m}…"; OLLAMA_HOST="127.0.0.1:11434" ollama pull "$m" 2>&1 | tail -1 || warn "pull failed: ${m} (egress?)"
  done
  if [ -f Modelfile ]; then
    info "build concord-conscious:latest from Modelfile…"
    OLLAMA_HOST="127.0.0.1:11434" ollama create concord-conscious:latest -f Modelfile 2>&1 | tail -2 && ok "concord-conscious built" || warn "build failed — check Modelfile FROM base"
  else
    warn "no Modelfile — concord-conscious not built; the Conscious brain will be offline."
  fi
  pkill -f "ollama serve" 2>/dev/null || true
  ok "models pre-warmed (in the shared blob store; runpod-cognition.sh will reuse them)"
else
  info "skipping model download (runpod-up.sh's cognition launch builds/pulls on first run). Use --with-models to pre-warm."
fi

echo ""
ok "Fresh-pod setup complete."
echo "  Next:  bash scripts/runpod-up.sh        # boots brains + app + pin + tunnel reminder"
echo "  Verify any time:  set -a; . ./.env; set +a; node server/scripts/verify-prod-flags.mjs"
