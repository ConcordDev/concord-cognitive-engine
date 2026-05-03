#!/bin/bash
# scripts/runpod-smoke.sh — post-deploy verification for a Concord pod.
#
# Hits every critical endpoint (health, auth, world, Flow Combat substrate,
# training match, faction war) and prints a green/red summary. Exit 0 on
# all-pass, exit 1 on any failure so it's CI-pipeable.
#
# Usage:
#   ./scripts/runpod-smoke.sh                      # uses RUNPOD_PUBLIC_URL or http://localhost:5050
#   ./scripts/runpod-smoke.sh https://abc.proxy.runpod.net
#   API=https://my.host ./scripts/runpod-smoke.sh

set -uo pipefail

API="${1:-${API:-${RUNPOD_PUBLIC_URL:-http://localhost:5050}}}"
API="${API%/}"

PASS=0
FAIL=0
FAILED_CHECKS=()

c_g() { printf "\033[32m%s\033[0m" "$*"; }
c_r() { printf "\033[31m%s\033[0m" "$*"; }
c_y() { printf "\033[33m%s\033[0m" "$*"; }
c_d() { printf "\033[2m%s\033[0m" "$*"; }

check() {
  local label="$1"
  local url="$2"
  local expect="${3:-200}"
  local extra_grep="${4:-}"
  local body
  local code
  body="$(curl -sS -o /tmp/concord-smoke-body.txt -w "%{http_code}" --max-time 10 "$url" 2>&1)" || code=000
  code="${body:0:3}"
  if [ "$code" = "$expect" ]; then
    if [ -n "$extra_grep" ] && ! grep -q "$extra_grep" /tmp/concord-smoke-body.txt 2>/dev/null; then
      printf "  %s %s %s\n" "$(c_r FAIL)" "$label" "$(c_d "(expected '$extra_grep' in body)")"
      FAIL=$((FAIL + 1))
      FAILED_CHECKS+=("$label")
      return 1
    fi
    printf "  %s %s %s\n" "$(c_g " OK ")" "$label" "$(c_d "[$code]")"
    PASS=$((PASS + 1))
    return 0
  else
    printf "  %s %s %s\n" "$(c_r FAIL)" "$label" "$(c_d "[got $code, expected $expect]")"
    FAIL=$((FAIL + 1))
    FAILED_CHECKS+=("$label")
    return 1
  fi
}

# ── Banner ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Concord — RunPod Post-Deploy Smoke"
echo "  Target: $API"
echo "  Time:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Liveness ────────────────────────────────────────────────────────────────
echo "Liveness"
check "GET /health"                "$API/health"            200 'healthy\|degraded'
check "GET /ready"                 "$API/ready"             200 'ready'
check "GET /api/health/db"         "$API/api/health/db"     200 'sqlite'
check "GET /api/health/ws"         "$API/api/health/ws"     "" ""
check "GET /api/status"            "$API/api/status"        200

# ── Auth surfaces (read-only) ────────────────────────────────────────────────
echo ""
echo "Auth"
check "GET /api/auth/csrf-token"   "$API/api/auth/csrf-token" 200
check "GET /api/auth/providers"    "$API/api/auth/providers"  200

# ── World substrate (public reads) ──────────────────────────────────────────
echo ""
echo "World"
check "GET /api/worlds/concordia-hub/quests" "$API/api/worlds/concordia-hub/quests?limit=1" 200
check "GET /api/worlds/concordia-hub/buildings" "$API/api/worlds/concordia-hub/buildings" 200

# ── Flow Combat substrate ───────────────────────────────────────────────────
echo ""
echo "Flow Combat"
check "GET /api/combat-flow/context (no-auth → 401)" "$API/api/combat-flow/context" 401
check "GET /api/faction-war/active"  "$API/api/faction-war/active" 200 'wars'

# ── OpenAPI / docs ──────────────────────────────────────────────────────────
echo ""
echo "API Surface"
check "GET /api/openapi.json"      "$API/api/openapi.json"  200 'openapi'
check "GET /api/docs"              "$API/api/docs"          200

# ── Static / frontend manifest ──────────────────────────────────────────────
echo ""
echo "Frontend (if reverse-proxied to same origin)"
# Don't fail on frontend-not-served — pod might split frontend out
SCODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "$API/" 2>/dev/null || echo 000)
if [ "$SCODE" = "200" ] || [ "$SCODE" = "304" ]; then
  printf "  %s GET / %s\n" "$(c_g " OK ")" "$(c_d "[$SCODE — frontend served]")"
  PASS=$((PASS + 1))
else
  printf "  %s GET / %s\n" "$(c_y "SKIP")" "$(c_d "[$SCODE — frontend likely on separate origin]")"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS + FAIL))
if [ "$FAIL" -eq 0 ]; then
  printf "  %s — %s/%s checks green\n" "$(c_g 'ALL CLEAR')" "$PASS" "$TOTAL"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 0
else
  printf "  %s — %s passed, %s failed (%s total)\n" "$(c_r 'ISSUES')" "$PASS" "$FAIL" "$TOTAL"
  echo ""
  echo "  Failed:"
  for f in "${FAILED_CHECKS[@]}"; do
    printf "    - %s\n" "$f"
  done
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  exit 1
fi
