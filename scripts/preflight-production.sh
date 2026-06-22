#!/bin/bash
# scripts/preflight-production.sh
#
# Single command to validate the production environment is fully
# configured before booting the server. Catches the "I deployed and
# now logins fail because JWT_SECRET wasn't set" class of bugs.
#
# Runs BEFORE startup.sh starts the server. Exits 1 with a clear list
# of what's missing if any required config is absent or malformed.
#
# Wire into RunPod startup:
#   ./scripts/preflight-production.sh && ./startup.sh --runpod
#
# What it checks:
#
#   REQUIRED in production:
#     JWT_SECRET           — Auth signing key. Must be ≥ 64 hex chars
#                            (openssl rand -hex 64). Without it the
#                            server fatal-exits at boot — good — but
#                            this script catches it 60s earlier with
#                            a clearer message.
#     SESSION_SECRET       — Distinct from JWT_SECRET. Used for cookie
#                            signing. ≥ 32 hex chars.
#     ADMIN_PASSWORD       — First-run admin login. ≥ 12 chars.
#     NODE_ENV             — Must equal "production" (else feature
#                            gates that key on this misbehave).
#     ALLOWED_ORIGINS or RUNPOD_PUBLIC_URL or DOMAIN
#                          — Origin allowlist for CORS + WebSocket
#                            handshake. Without it the frontend can't
#                            connect to the backend.
#
#   REQUIRED if specific features are enabled:
#     STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET — both must be set
#                          together. Webhook secret guards against
#                          forged checkout-completion events.
#     AWS_BUCKET + BACKUP_ENCRYPTION_KEY — S3 backup requires both.
#                          Otherwise off-site backups go unencrypted.
#     OPENAI_API_KEY or BRAIN_*_URL — at least one LLM path needs
#                          to be configured.
#
#   STRONGLY RECOMMENDED:
#     SENTRY_DSN           — Production error tracking. Soft-warns.
#     CONCORD_FEDERATION_TOKEN — Federation peer-auth.
#
# Exit codes:
#   0  — all required config present + sane
#   1  — one or more required vars missing or malformed

set -u

c_g() { printf "\033[32m%s\033[0m" "$*"; }
c_r() { printf "\033[31m%s\033[0m" "$*"; }
c_y() { printf "\033[33m%s\033[0m" "$*"; }
c_b() { printf "\033[1m%s\033[0m" "$*"; }

ERRORS=()
WARNINGS=()

require() {
  local name="$1"
  local min_len="${2:-1}"
  local value="${!name:-}"
  if [ -z "$value" ]; then
    ERRORS+=("$(c_r "✗ $name")  missing — required in production")
    return 1
  fi
  if [ "${#value}" -lt "$min_len" ]; then
    ERRORS+=("$(c_r "✗ $name")  too short (${#value} chars; need ≥ $min_len)")
    return 1
  fi
  echo "$(c_g "✓ $name")  set (${#value} chars)"
  return 0
}

require_one_of() {
  local label="$1"; shift
  local found=""
  for v in "$@"; do
    if [ -n "${!v:-}" ]; then found="$v"; break; fi
  done
  if [ -z "$found" ]; then
    ERRORS+=("$(c_r "✗ $label")  need one of: $*")
    return 1
  fi
  echo "$(c_g "✓ $label")  via $found"
  return 0
}

recommend() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    WARNINGS+=("$(c_y "⚠ $name")  not set — strongly recommended for production")
  else
    echo "$(c_g "✓ $name")  set"
  fi
}

paired() {
  # If either var is set, both must be set.
  local a="$1" b="$2" reason="$3"
  local va="${!a:-}" vb="${!b:-}"
  if [ -n "$va" ] && [ -z "$vb" ]; then
    ERRORS+=("$(c_r "✗ $b")  required because $a is set ($reason)")
  elif [ -z "$va" ] && [ -n "$vb" ]; then
    ERRORS+=("$(c_r "✗ $a")  required because $b is set ($reason)")
  elif [ -n "$va" ] && [ -n "$vb" ]; then
    echo "$(c_g "✓ $a + $b")  both set"
  fi
}

# ────────────────────────────────────────────────────────────────────
echo "$(c_b "Concord production preflight")"
echo "$(c_b "═════════════════════════════")"
echo

# Load .env if present (let it override the shell)
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
  echo "Loaded .env"
elif [ -f server/.env ]; then
  set -a
  # shellcheck disable=SC1091
  source server/.env
  set +a
  echo "Loaded server/.env"
else
  WARNINGS+=("$(c_y "⚠ no .env or server/.env found")  — reading from process env only")
fi
echo

# ── NODE_ENV ──
if [ "${NODE_ENV:-}" != "production" ]; then
  ERRORS+=("$(c_r "✗ NODE_ENV")  is '${NODE_ENV:-unset}' — must be 'production' for prod gates to apply")
else
  echo "$(c_g "✓ NODE_ENV")  production"
fi

# ── Auth secrets ──
require JWT_SECRET 64
require SESSION_SECRET 32
require ADMIN_PASSWORD 12

# ── Origin allowlist ──
require_one_of "CORS origin" ALLOWED_ORIGINS RUNPOD_PUBLIC_URL DOMAIN

# ── LLM path ──
require_one_of "LLM provider" OPENAI_API_KEY BRAIN_CONSCIOUS_URL ANTHROPIC_API_KEY OLLAMA_HOST

# ── Stripe (both-or-neither) ──
paired STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET "webhook signature verification needs both keys"

# ── S3 backup (both-or-neither) ──
paired AWS_BUCKET BACKUP_ENCRYPTION_KEY "off-site backup encryption requires both"

# ── Strongly recommended ──
recommend SENTRY_DSN
recommend CONCORD_FEDERATION_TOKEN

# ── Cloudflare-aware sanity ──
if [ -n "${RUNPOD_PUBLIC_URL:-}" ] || [ -n "${DOMAIN:-}" ]; then
  if [ "${TRUST_PROXY:-1}" -lt 1 ] 2>/dev/null; then
    WARNINGS+=("$(c_y "⚠ TRUST_PROXY")  is 0 but you're behind a proxy (Cloudflare/RunPod) — sessions + IP detection will break")
  fi
fi

# ── Heap sanity ──
if [ -n "${MAX_OLD_SPACE_SIZE:-}" ]; then
  if [ "$MAX_OLD_SPACE_SIZE" -lt 4096 ]; then
    WARNINGS+=("$(c_y "⚠ MAX_OLD_SPACE_SIZE")  is $MAX_OLD_SPACE_SIZE MB — server.js (70k LOC) wants ≥ 4096; recommend 6144+ for prod")
  else
    echo "$(c_g "✓ MAX_OLD_SPACE_SIZE")  ${MAX_OLD_SPACE_SIZE} MB"
  fi
fi

# ── Phase G — per-world flavor files ──
# Every authored sub-world must have a valid loops.json so the heartbeat
# dispatcher's per-world filtering doesn't fall back to "all loops on"
# silently. Missing or malformed files surface as warnings (not errors)
# because the engine still works with the defaults — but the operator
# should know the per-world tuning isn't taking effect.
WORLD_DIR="${CONCORD_WORLD_DIR:-./content/world}"
if [ -d "$WORLD_DIR" ]; then
  EXPECTED_WORLDS=(concordia-hub tunya sovereign-ruins crime cyber superhero fantasy lattice-crucible)
  for w in "${EXPECTED_WORLDS[@]}"; do
    if [ ! -f "$WORLD_DIR/$w/loops.json" ]; then
      WARNINGS+=("$(c_y "⚠ loops.json missing")  for world '$w' — Phase G flavor will fall back to defaults")
    elif ! node -e "JSON.parse(require('fs').readFileSync('$WORLD_DIR/$w/loops.json','utf8'))" 2>/dev/null; then
      ERRORS+=("$(c_r "✗ loops.json malformed")  for world '$w' — invalid JSON")
    fi
  done
fi

# ── Phase D — multi-endpoint brain URL parseability ──
for B in CONSCIOUS SUBCONSCIOUS UTILITY REPAIR VISION; do
  PLURAL_VAR="BRAIN_${B}_URLS"
  if [ -n "${!PLURAL_VAR:-}" ]; then
    # comma-separated, each must look like http(s)://...
    OK=1
    IFS=',' read -ra ARR <<< "${!PLURAL_VAR}"
    for url in "${ARR[@]}"; do
      url_trim="$(echo "$url" | xargs)"
      if ! echo "$url_trim" | grep -qE '^https?://[^/]+'; then
        OK=0
        ERRORS+=("$(c_r "✗ $PLURAL_VAR")  contains invalid URL: '$url_trim'")
      fi
    done
    [ "$OK" = "1" ] && echo "$(c_g "✓ $PLURAL_VAR")  $(echo "${!PLURAL_VAR}" | tr ',' '\n' | wc -l | tr -d ' ') endpoint(s)"
  fi
done

# ── Phase I — sharding kill-switch parseability ──
if [ -n "${CONCORD_SHARD_WORLDS:-}" ]; then
  case "$CONCORD_SHARD_WORLDS" in
    true|false|0|1) echo "$(c_g "✓ CONCORD_SHARD_WORLDS")  ${CONCORD_SHARD_WORLDS}" ;;
    *) ERRORS+=("$(c_r "✗ CONCORD_SHARD_WORLDS")  must be true/false/0/1, got '$CONCORD_SHARD_WORLDS'") ;;
  esac
fi

# ── Phase C — heartbeat pool size sanity (warn if cpus < pool + 2) ──
if [ -n "${CONCORD_HEARTBEAT_POOL_SIZE:-}" ]; then
  POOL="$CONCORD_HEARTBEAT_POOL_SIZE"
  CPUS="$(nproc 2>/dev/null || echo 4)"
  if [ "$CPUS" -lt "$((POOL + 2))" ]; then
    WARNINGS+=("$(c_y "⚠ CONCORD_HEARTBEAT_POOL_SIZE")  is $POOL but only $CPUS vCPU available — workers will starve main thread; reduce to ≤ $((CPUS - 2))")
  fi
fi

# ── Database path writable ──
DB_DIR="$(dirname "${DB_PATH:-./server/data/concord.db}")"
if [ -d "$DB_DIR" ] && [ -w "$DB_DIR" ]; then
  echo "$(c_g "✓ DB_PATH dir writable")  $DB_DIR"
elif [ -d "$DB_DIR" ]; then
  ERRORS+=("$(c_r "✗ DB_PATH dir not writable")  $DB_DIR")
else
  WARNINGS+=("$(c_y "⚠ DB_PATH dir missing")  $DB_DIR — server will create at boot if parent is writable")
fi

# ── Data durability — is the DB on a persistent volume? ──
# The container disk is ephemeral on RunPod; a pod reclaim wipes it. Warn if
# DB_PATH doesn't look like a persistent network-volume mount.
case "${DB_PATH:-$DB_DIR}" in
  /workspace*|/runpod-volume*|/data/*) echo "$(c_g "✓ DB on a likely-persistent path")  ${DB_PATH:-$DB_DIR}" ;;
  *) WARNINGS+=("$(c_y "⚠ DB_PATH may be EPHEMERAL")  ${DB_PATH:-$DB_DIR} — put it on the network volume (e.g. /workspace/concord/db/concord.db) or a pod reclaim = total data loss") ;;
esac

# ── Transactional email — account recovery depends on it ──
# Without SMTP, password-reset + verification emails never send; a user who
# forgets their password is locked out. Not a hard fail (some launch without
# email), but a loud warning since it's a silent footgun.
if [ -n "${SMTP_HOST:-}" ]; then
  echo "$(c_g "✓ SMTP configured")  ${SMTP_HOST} — password reset + verification will send"
else
  WARNINGS+=("$(c_y "⚠ SMTP not configured")  password reset + email verification will NOT send — users who forget passwords are locked out. Set SMTP_HOST/USER/PASS.")
fi

# ── MMO sprint — content + flag parseability ──
# Phase U2 — achievement catalog
if [ -d "./content/achievements" ]; then
  ACH_COUNT="$(ls ./content/achievements/*.json 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$ACH_COUNT" -gt 0 ]; then
    echo "$(c_g "✓ achievement catalog")  $ACH_COUNT JSON file(s)"
  else
    WARNINGS+=("$(c_y "⚠ content/achievements")  exists but is empty — achievement engine will boot with no triggers")
  fi
fi

# Phase W — disease catalog
if [ -d "./content/diseases" ]; then
  DIS_COUNT="$(ls ./content/diseases/*.json 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$DIS_COUNT" -gt 0 ]; then
    echo "$(c_g "✓ disease catalog")  $DIS_COUNT JSON file(s)"
    # Validate each parses.
    for f in ./content/diseases/*.json; do
      if ! node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null; then
        ERRORS+=("$(c_r "✗ disease catalog")  $f is malformed JSON")
      fi
    done
  else
    WARNINGS+=("$(c_y "⚠ content/diseases")  exists but is empty — disease engine will boot with no diseases")
  fi
fi

# Phase U-W kill switches — parseability.
for FLAG in CONCORD_MAIL_ENABLED CONCORD_LFG_ENABLED CONCORD_AUCTION_HOUSE CONCORD_DISEASE_ENGINE CONCORD_INTOXICATION; do
  VAL="${!FLAG:-}"
  if [ -n "$VAL" ]; then
    case "$VAL" in
      true|false|0|1) echo "$(c_g "✓ $FLAG")  $VAL" ;;
      *) ERRORS+=("$(c_r "✗ $FLAG")  must be true/false/0/1, got '$VAL'") ;;
    esac
  fi
done

# Phase AA-AG kill switches.
for FLAG in CONCORD_NEMESIS_CYCLE CONCORD_QUEST_DIALOGUE_LLM CONCORD_AMBIENT_CHAT_ENABLED; do
  VAL="${!FLAG:-}"
  if [ -n "$VAL" ]; then
    case "$VAL" in
      true|false|0|1) echo "$(c_g "✓ $FLAG")  $VAL" ;;
      *) ERRORS+=("$(c_r "✗ $FLAG")  must be true/false/0/1, got '$VAL'") ;;
    esac
  fi
done

# Phase CA-CF kill switches.
for FLAG in CONCORD_TIME_LOOPS CONCORD_FACTORY_ENABLED CONCORD_FARMING_ENABLED CONCORD_HORDE_MODE_ENABLED CONCORD_THEME_PARK_ENABLED CONCORD_EXTRACTION_ENABLED; do
  VAL="${!FLAG:-}"
  if [ -n "$VAL" ]; then
    case "$VAL" in
      true|false|0|1) echo "$(c_g "✓ $FLAG")  $VAL" ;;
      *) ERRORS+=("$(c_r "✗ $FLAG")  must be true/false/0/1, got '$VAL'") ;;
    esac
  fi
done

# Phase BA-BE kill switches.
for FLAG in CONCORD_FESTIVALS_ENABLED CONCORD_WORLD_BOSSES_ENABLED CONCORD_ANNOUNCEMENTS_ENABLED; do
  VAL="${!FLAG:-}"
  if [ -n "$VAL" ]; then
    case "$VAL" in
      true|false|0|1) echo "$(c_g "✓ $FLAG")  $VAL" ;;
      *) ERRORS+=("$(c_r "✗ $FLAG")  must be true/false/0/1, got '$VAL'") ;;
    esac
  fi
done

# ── Summary ──
echo
if [ ${#WARNINGS[@]} -gt 0 ]; then
  echo "$(c_b "Warnings:")"
  for w in "${WARNINGS[@]}"; do echo "  $w"; done
  echo
fi

if [ ${#ERRORS[@]} -gt 0 ]; then
  echo "$(c_b "$(c_r "ERRORS — production cannot start:")")"
  for e in "${ERRORS[@]}"; do echo "  $e"; done
  echo
  echo "$(c_r "✗ PREFLIGHT FAILED  (${#ERRORS[@]} required vars missing/malformed)")"
  echo
  echo "To fix: set the missing vars in .env, then re-run this script."
  echo "See docs/RUNPOD_DEPLOY.md § Required env vars."
  exit 1
fi

echo "$(c_g "✓ PREFLIGHT PASSED")  — environment ready for production"
echo "  $(c_b "Next:") ./startup.sh --runpod"
echo
exit 0
