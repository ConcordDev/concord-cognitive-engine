#!/bin/bash
# Concord Smoke Test Suite
# Verifies core functionality is working after deployment.
#
# Usage:
#   ./smoke.sh [base_url]
#   ./smoke.sh http://localhost:5050

set -euo pipefail

BASE_URL="${1:-http://localhost:5050}"
PASS=0
FAIL=0

green() { echo -e "\033[32m$1\033[0m"; }
red() { echo -e "\033[31m$1\033[0m"; }

check() {
  local name="$1"
  local url="$2"
  local method="${3:-GET}"
  local body="${4:-}"
  local expected_status="${5:-200}"

  # Use a non-curl User-Agent so the server's bot guard
  # (server.js:_BOT_UA_RE at ~5870) doesn't 403 every smoke request.
  # Authenticated smoke via API key is documented in DEPLOYMENT.md;
  # this script covers the public-read surface only.
  local UA="Concord-Smoke/1.0"
  if [ "$method" = "GET" ]; then
    STATUS=$(curl -s -A "$UA" -o /dev/null -w "%{http_code}" "$BASE_URL$url" 2>/dev/null || echo "000")
  else
    STATUS=$(curl -s -A "$UA" -o /dev/null -w "%{http_code}" -X "$method" "$BASE_URL$url" \
      -H "Content-Type: application/json" \
      -d "$body" 2>/dev/null || echo "000")
  fi

  if [ "$STATUS" = "$expected_status" ]; then
    green "  PASS: $name ($STATUS)"
    PASS=$((PASS + 1))
  else
    red "  FAIL: $name (expected $expected_status, got $STATUS)"
    FAIL=$((FAIL + 1))
  fi
}

check_json() {
  local name="$1"
  local url="$2"
  local jq_expr="$3"

  BODY=$(curl -s -A "Concord-Smoke/1.0" "$BASE_URL$url" 2>/dev/null || echo "{}")
  RESULT=$(echo "$BODY" | node -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const o=JSON.parse(d);const v=o$jq_expr;if(v!==undefined&&v!==null)process.stdout.write(String(v));else process.stdout.write('PARSE_ERROR')}
      catch(e){process.stdout.write('PARSE_ERROR')}
    })
  " 2>/dev/null || echo "PARSE_ERROR")

  if [ "$RESULT" != "" ] && [ "$RESULT" != "PARSE_ERROR" ] && [ "$RESULT" != "None" ]; then
    green "  PASS: $name ($RESULT)"
    PASS=$((PASS + 1))
  else
    red "  FAIL: $name (expression '$jq_expr' failed)"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "=== Concord Smoke Tests ==="
echo "Base URL: $BASE_URL"
echo ""

# ── System Health ────────────────────────────────────────
echo "--- System Health ---"
check "Ready endpoint" "/ready"
check "Status endpoint" "/api/status"
check_json "Status returns ok" "/api/status" "['ok']"
check "Schema version" "/api/schema/version"

# ── Paginated Endpoints ──────────────────────────────────
echo ""
echo "--- Paginated Endpoints ---"
check "DTUs paginated" "/api/dtus/paginated?limit=5"
check "Artifacts paginated" "/api/artifacts/paginated?limit=5"
check "Jobs paginated" "/api/jobs/paginated?limit=5"
check "Marketplace paginated" "/api/marketplace/paginated?limit=5"

# ── Artifact Upload ──────────────────────────────────────
echo ""
echo "--- Artifact Upload ---"
UPLOAD_BODY='{"type":"file","title":"Smoke Test File","data":"SGVsbG8gV29ybGQ=","mime_type":"text/plain","filename":"test.txt","visibility":"private"}'
check "Upload artifact" "/api/artifacts/upload" "POST" "$UPLOAD_BODY"

# ── Durable DTU ──────────────────────────────────────────
echo ""
echo "--- Durable DTU ---"
DTU_BODY='{"title":"Smoke Test DTU","body":{"content":"test"},"tags":["smoke-test"],"visibility":"public"}'
check "Create durable DTU" "/api/dtus/durable" "POST" "$DTU_BODY"

# ── Studio Projects ──────────────────────────────────────
echo ""
echo "--- Studio ---"
PROJ_BODY='{"name":"Smoke Test Project","bpm":120,"key":"C"}'
check "Create studio project" "/api/studio/projects" "POST" "$PROJ_BODY"
check "List studio projects" "/api/studio/projects"

# ── Marketplace ──────────────────────────────────────────
echo ""
echo "--- Marketplace ---"
check "Browse marketplace" "/api/marketplace/browse"

# ── Jobs ─────────────────────────────────────────────────
echo ""
echo "--- Jobs ---"
check "Vocal analyze" "/api/studio/vocal/analyze" "POST" '{"project_id":"test","track_id":"test"}'
check "Master job" "/api/studio/master/job" "POST" '{"project_id":"test","preset":"balanced"}'

# ── Events ───────────────────────────────────────────────
echo ""
echo "--- Events ---"
check "Events log" "/api/events/log?limit=10"

# ── Guidance Layer ────────────────────────────────────────
echo ""
echo "--- Guidance Layer ---"
check "System health" "/api/system/health"
check "Events paginated" "/api/events/paginated?limit=5"
check "Suggestions" "/api/guidance/suggestions"
check "First-win status" "/api/guidance/first-win"

# ── Guided DTU (create + undo) ────────────────────────────
echo ""
echo "--- Guided DTU + Undo ---"
GUIDED_DTU='{"title":"Smoke Guide DTU","body":{"content":"test"},"tags":["smoke"],"visibility":"private"}'
check "Guided DTU create" "/api/dtus/guided" "POST" "$GUIDED_DTU"

# ── Action Preview ────────────────────────────────────────
PREVIEW_BODY='{"action":"delete_dtu","entityType":"dtu","entityId":"nonexistent"}'
check "Action preview" "/api/preview-action" "POST" "$PREVIEW_BODY"

# ── Economy System ────────────────────────────────────────
echo ""
echo "--- Economy ---"
check "Fee schedule" "/api/economy/fees"
check "Ledger integrity" "/api/economy/integrity"
BUY_BODY='{"user_id":"smoke-user","amount":100}'
check "Token purchase" "/api/economy/buy" "POST" "$BUY_BODY"
check "Balance check" "/api/economy/balance?user_id=smoke-user"
check "Economy status" "/api/economy/status"
check "Platform balance" "/api/economy/platform-balance"
check "Economy config" "/api/economy/config"
check "Connect status" "/api/stripe/connect/status?user_id=smoke-user"

# ── Results ──────────────────────────────────────────────
echo ""
echo "========================"
echo "Results: $PASS passed, $FAIL failed"
echo "========================"
echo ""

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
