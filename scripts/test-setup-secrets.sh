#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Test harness for setup.sh's "auto-generate required secrets" step (10b).
#
# This does NOT re-implement the generation logic — it extracts the real
# block out of setup.sh (between the "10b." and "11." section markers) and
# executes it against a scratch copy of the real .env.example, so the test
# fails if setup.sh's actual code regresses.
#
# Usage: bash scripts/test-setup-secrets.sh
# Exits non-zero (with a message) on any assertion failure. Cleans up all
# temp files/directories it creates, including on failure (trap).
# ---------------------------------------------------------------------------
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SETUP_SH="${ROOT_DIR}/setup.sh"
ENV_EXAMPLE="${ROOT_DIR}/.env.example"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.yml"

PASS=0
FAIL=0

pass() { PASS=$((PASS+1)); printf "  [PASS] %s\n" "$*"; }
failed() { FAIL=$((FAIL+1)); printf "  [FAIL] %s\n" "$*"; }

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/concord-setup-secrets-test.XXXXXX")"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

# ── Extract the real step-10b block out of setup.sh ─────────────────────────
BLOCK_FILE="${WORKDIR}/step10b.sh"
awk '
  /^# ── 10b\. Auto-generate required secrets/ { grab = 1 }
  grab { print }
  /^# ── 11\. Generate VAPID keys/ { exit }
' "$SETUP_SH" | sed '$d' > "$BLOCK_FILE"

if [ ! -s "$BLOCK_FILE" ]; then
  echo "FATAL: could not extract step-10b block from setup.sh — markers may have changed." >&2
  exit 1
fi

# ── Stub logger functions the extracted block calls ─────────────────────────
STUBS="${WORKDIR}/stubs.sh"
cat > "$STUBS" <<'EOF'
info()  { printf "[INFO]  %s\n" "$*"; }
ok()    { printf "[OK]    %s\n" "$*"; }
warn()  { printf "[WARN]  %s\n" "$*"; }
EOF

run_block() {
  # run_block ENVFILE_DIR -> sources stubs + the real block with ROOT_DIR
  # pointed at a scratch dir containing .env
  ( set -euo pipefail
    ROOT_DIR="$1"
    # shellcheck disable=SC1090
    . "$STUBS"
    # shellcheck disable=SC1090
    . "$BLOCK_FILE"
  )
}

get_var() { # get_var FILE KEY
  grep -E "^${2}=" "$1" 2>/dev/null | head -1 | cut -d'=' -f2-
}

echo "== Test 1: fresh .env.example -> all docker-compose-required secrets populated =="
T1="${WORKDIR}/t1"
mkdir -p "$T1"
cp "$ENV_EXAMPLE" "$T1/.env"
run_block "$T1" > "${WORKDIR}/t1.log" 2>&1 || { cat "${WORKDIR}/t1.log"; failed "step-10b block exited non-zero"; }

JWT="$(get_var "$T1/.env" JWT_SECRET)"
SESSION="$(get_var "$T1/.env" SESSION_SECRET)"
ADMIN_PW="$(get_var "$T1/.env" ADMIN_PASSWORD)"
GRAFANA_PW="$(get_var "$T1/.env" GRAFANA_PASSWORD)"
GRAFANA_USER="$(get_var "$T1/.env" GRAFANA_USER)"

[ -n "$JWT" ] && [ "${#JWT}" -ge 64 ] && pass "JWT_SECRET generated (${#JWT} chars)" || failed "JWT_SECRET missing/short: '$JWT'"
[ -n "$SESSION" ] && [ "${#SESSION}" -ge 32 ] && pass "SESSION_SECRET generated (${#SESSION} chars)" || failed "SESSION_SECRET missing/short: '$SESSION'"
[ -n "$ADMIN_PW" ] && [ "${#ADMIN_PW}" -ge 12 ] && pass "ADMIN_PASSWORD generated (${#ADMIN_PW} chars)" || failed "ADMIN_PASSWORD missing/short: '$ADMIN_PW'"
[ -n "$GRAFANA_PW" ] && [ "${#GRAFANA_PW}" -ge 12 ] && pass "GRAFANA_PASSWORD generated (${#GRAFANA_PW} chars)" || failed "GRAFANA_PASSWORD missing/short: '$GRAFANA_PW'"
[ "$GRAFANA_USER" = "admin" ] && pass "GRAFANA_USER left untouched (already had a value)" || failed "GRAFANA_USER unexpectedly changed: '$GRAFANA_USER'"

echo ""
echo "== Test 2: cross-check against docker-compose.yml's actual :? -required vars =="
# Every ${VAR:?...} in docker-compose.yml must now resolve to a non-empty value.
REQUIRED_VARS="$(grep -noE '\$\{[A-Z0-9_]+:\?' "$COMPOSE_FILE" | sed -E 's/.*\{([A-Z0-9_]+):\?/\1/' | sort -u)"
ALL_SET=1
for v in $REQUIRED_VARS; do
  val="$(get_var "$T1/.env" "$v")"
  if [ -z "$val" ]; then
    failed "docker-compose-required var $v is still empty after step-10b"
    ALL_SET=0
  fi
done
[ "$ALL_SET" = "1" ] && pass "All docker-compose ':?'-required vars ($REQUIRED_VARS) are populated"

echo ""
echo "== Test 3: idempotency — re-running does not change already-generated secrets =="
run_block "$T1" > "${WORKDIR}/t1-rerun.log" 2>&1 || { cat "${WORKDIR}/t1-rerun.log"; failed "re-run exited non-zero"; }
JWT2="$(get_var "$T1/.env" JWT_SECRET)"
[ "$JWT" = "$JWT2" ] && pass "JWT_SECRET unchanged across re-run (idempotent)" || failed "JWT_SECRET changed on re-run — not idempotent"

echo ""
echo "== Test 4: a real user-set secret is never clobbered =="
T4="${WORKDIR}/t4"
mkdir -p "$T4"
cp "$ENV_EXAMPLE" "$T4/.env"
REAL_SECRET="user-chose-this-real-secret-do-not-touch-1234567890"
# Overwrite JWT_SECRET with a "real" value before running the generator.
awk -v v="$REAL_SECRET" '
  /^JWT_SECRET=/ { print "JWT_SECRET=" v; next } { print }
' "$T4/.env" > "$T4/.env.tmp" && mv "$T4/.env.tmp" "$T4/.env"

run_block "$T4" > "${WORKDIR}/t4.log" 2>&1 || { cat "${WORKDIR}/t4.log"; failed "step-10b block exited non-zero on t4"; }
JWT4="$(get_var "$T4/.env" JWT_SECRET)"
[ "$JWT4" = "$REAL_SECRET" ] && pass "Pre-set JWT_SECRET left untouched" || failed "Pre-set JWT_SECRET was clobbered: '$JWT4'"
# GRAFANA_PASSWORD was still empty in this fixture -> should have been generated.
GPW4="$(get_var "$T4/.env" GRAFANA_PASSWORD)"
[ -n "$GPW4" ] && pass "GRAFANA_PASSWORD still generated for the untouched fields in the same run" || failed "GRAFANA_PASSWORD not generated in mixed fixture"

echo ""
echo "== Test 5: placeholder-style values ARE replaced (not just blank) =="
T5="${WORKDIR}/t5"
mkdir -p "$T5"
cp "$ENV_EXAMPLE" "$T5/.env"
awk '
  /^SESSION_SECRET=/ { print "SESSION_SECRET=your-session-secret-here"; next } { print }
' "$T5/.env" > "$T5/.env.tmp" && mv "$T5/.env.tmp" "$T5/.env"
run_block "$T5" > "${WORKDIR}/t5.log" 2>&1 || { cat "${WORKDIR}/t5.log"; failed "step-10b block exited non-zero on t5"; }
SESSION5="$(get_var "$T5/.env" SESSION_SECRET)"
[ "$SESSION5" != "your-session-secret-here" ] && [ "${#SESSION5}" -ge 32 ] && pass "Placeholder SESSION_SECRET replaced with a real value" || failed "Placeholder SESSION_SECRET not replaced: '$SESSION5'"

echo ""
echo "== Test 6: bash -n syntax check on setup.sh =="
bash -n "$SETUP_SH" && pass "setup.sh passes bash -n" || failed "setup.sh has a syntax error"

echo ""
echo "----------------------------------------"
echo "Results: ${PASS} passed, ${FAIL} failed"
echo "----------------------------------------"

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
exit 0
