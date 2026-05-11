#!/usr/bin/env bash
# scripts/repair-cortex-platinum-runner.sh
#
# Sprint 31 — Repair Cortex as platinum-gate enforcer.
#
# Runs every platinum gate in dependency order. Each gate emits a
# machine-readable result line to stdout:
#
#   gate=<name> status=<pass|fail|skip> elapsed_ms=<n> details=<short>
#
# The Repair Cortex (`server/emergent/repair-cortex.js`) parses this
# output to decide:
#
#   1. Which gates are auto-fixable (lint, format, dead-code,
#      manifest-drift, route-auth-baseline drift) — fix locally and
#      re-run the gate.
#   2. Which gates need human escalation (SAST/DAST findings, real
#      test failures, security-header regressions).
#   3. Whether the current commit is deployable: deployable = every
#      gate either `pass` or auto-fixable with one round of repair.
#
# Usage:
#   ./scripts/repair-cortex-platinum-runner.sh              # full pass
#   ./scripts/repair-cortex-platinum-runner.sh --only=lint  # subset
#   ./scripts/repair-cortex-platinum-runner.sh --fix        # let
#       Repair Cortex apply safe auto-fixes mid-run
#
# Exit codes:
#   0  every gate pass (or pass-after-auto-fix when --fix is set)
#   1  one or more gates failed and were not auto-fixable
#   2  catastrophic error (env missing, infra broken)

set -uo pipefail

# ─── Parse flags ────────────────────────────────────────────────────────────
ONLY_GATES=""
APPLY_FIX="false"
NO_FAIL="false"
for arg in "$@"; do
  case "$arg" in
    --only=*) ONLY_GATES="${arg#*=}" ;;
    --fix) APPLY_FIX="true" ;;
    --no-fail) NO_FAIL="true" ;;  # log results but exit 0 (for first-time baselines)
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# ─── Gate definition ────────────────────────────────────────────────────────
# Each gate is a name + a shell command. Order matters — the cheap
# gates run first so a fast-fail aborts before the expensive ones.
declare -A GATES
declare -a GATE_ORDER

add_gate() {
  GATES["$1"]="$2"
  GATE_ORDER+=("$1")
}

#                          name                       command (must exit 0 on pass)
add_gate  lint-server               "cd server && npm run lint:ci"
add_gate  lint-frontend             "cd concord-frontend && npm run lint"
add_gate  typecheck-server          "cd server && npm run typecheck"
add_gate  typecheck-frontend        "cd concord-frontend && npm run type-check"
add_gate  route-auth                "cd server && npm run check-route-auth"
add_gate  deps-graph                "cd server && npm run check-deps"
# For tests that may not exist on every branch yet (cross-branch staging),
# the gate command checks for the test file first. If absent, it emits the
# `skip` sentinel and run_gate returns 2 (skipped). If the file exists, the
# test runs normally and a real failure correctly fails the gate.
# Previously these used `|| true` which silently passed even on test failure —
# fixed per code-review feedback on PR #332.
add_gate  migration-up-down         "cd server && { [ -f tests/platinum-migration-up-down.test.js ] || { echo 'skip: test file missing on this branch' >&2; exit 2; }; node --test --test-force-exit --test-timeout=120000 tests/platinum-migration-up-down.test.js; }"
add_gate  security-headers          "cd server && { [ -f tests/platinum-security-headers.test.js ] || { echo 'skip: test file missing on this branch' >&2; exit 2; }; node --test --test-force-exit --test-timeout=30000 tests/platinum-security-headers.test.js; }"
add_gate  chaos-heartbeat           "cd server && node --test --test-force-exit --test-timeout=60000 tests/platinum-chaos-heartbeat.test.js"
add_gate  gdpr                      "cd server && node --test --test-force-exit --test-timeout=60000 tests/platinum-gdpr.test.js"
add_gate  observability             "cd server && node --test --test-force-exit --test-timeout=30000 tests/platinum-observability.test.js"
add_gate  openapi-contract          "cd server && node --test --test-force-exit --test-timeout=30000 tests/platinum-openapi-contract.test.js"
add_gate  slo                       "cd server && node --test --test-force-exit --test-timeout=30000 tests/platinum-slo.test.js"
add_gate  threat-model              "cd server && node --test --test-force-exit --test-timeout=30000 tests/platinum-threat-model.test.js"
add_gate  privacy-review            "cd server && node --test --test-force-exit --test-timeout=60000 tests/platinum-privacy-review.test.js"
add_gate  prompt-injection          "cd server && node --test --test-force-exit --test-timeout=30000 tests/platinum-prompt-injection.test.js"
add_gate  dr-drill                  "cd server && node --test --test-force-exit --test-timeout=120000 tests/platinum-dr-drill.test.js"
add_gate  property-based            "cd server && node --test --test-force-exit --test-timeout=60000 tests/platinum-property-based.test.js"

# ─── Repair Cortex auto-fix recipes ─────────────────────────────────────────
# Each entry: gate-name → shell command that attempts a safe fix.
# Returning exit 0 means "fix applied; re-run gate". Non-zero means
# "Repair Cortex cannot auto-fix; escalate to a human."
declare -A AUTOFIX
AUTOFIX[lint-server]="cd server && npx eslint . --fix"
AUTOFIX[lint-frontend]="cd concord-frontend && npm run lint -- --fix"
AUTOFIX[route-auth]="cd server && npm run check-route-auth:update"

run_gate() {
  local name="$1"
  local cmd="$2"

  if [ -n "$ONLY_GATES" ] && [[ ",$ONLY_GATES," != *",$name,"* ]]; then
    echo "gate=$name status=skip elapsed_ms=0 details=not-in-only-filter"
    return 2  # 2 = skipped (not counted as pass or fail)
  fi

  local start_ms
  start_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  local tmp
  tmp=$(mktemp)
  bash -c "$cmd" > "$tmp" 2>&1
  local rc=$?
  local end_ms
  end_ms=$(date +%s%3N 2>/dev/null || python3 -c 'import time;print(int(time.time()*1000))')
  local elapsed=$((end_ms - start_ms))

  if [ "$rc" = "0" ]; then
    echo "gate=$name status=pass elapsed_ms=$elapsed details=ok"
    rm -f "$tmp"
    return 0
  fi
  # exit 2 from a gate command = intentional skip (e.g. test file missing
  # on this branch). Per code-review feedback on PR #332 — gates can no
  # longer be silently bypassed with `|| true`; they must explicitly skip
  # or fail.
  if [ "$rc" = "2" ]; then
    local short
    short=$(tail -n 1 "$tmp" | tr '\n' ' ' | head -c 200)
    echo "gate=$name status=skip elapsed_ms=$elapsed details='$short'"
    rm -f "$tmp"
    return 2
  fi

  local short
  short=$(tail -n 5 "$tmp" | tr '\n' ' ' | head -c 200)
  echo "gate=$name status=fail elapsed_ms=$elapsed details='$short'" >&2

  # Try Repair Cortex auto-fix recipe
  if [ "$APPLY_FIX" = "true" ] && [ -n "${AUTOFIX[$name]:-}" ]; then
    echo "gate=$name action=auto-fix-attempt cmd='${AUTOFIX[$name]}'"
    if bash -c "${AUTOFIX[$name]}"; then
      # Re-run gate after fix
      if bash -c "$cmd" > "$tmp" 2>&1; then
        echo "gate=$name status=pass-after-fix elapsed_ms=$elapsed"
        rm -f "$tmp"
        return 0
      fi
    fi
  fi

  echo "gate=$name status=fail-final elapsed_ms=$elapsed"
  rm -f "$tmp"
  return 1
}

# ─── Run gates ──────────────────────────────────────────────────────────────
FAILED_GATES=()
PASSED_GATES=()
SKIPPED_GATES=()

echo "═══════════════════════════════════════════════════════════════"
echo "Repair Cortex — Platinum Gate Runner"
echo "Mode: $([ "$APPLY_FIX" = "true" ] && echo "AUTO-FIX ENABLED" || echo "AUDIT-ONLY")"
echo "Scope: ${ONLY_GATES:-all gates}"
echo "═══════════════════════════════════════════════════════════════"

for name in "${GATE_ORDER[@]}"; do
  set +e
  run_gate "$name" "${GATES[$name]}"
  rc=$?
  set -e
  case "$rc" in
    0) PASSED_GATES+=("$name") ;;
    2) SKIPPED_GATES+=("$name") ;;
    *) FAILED_GATES+=("$name") ;;
  esac
done

# ─── Summary ────────────────────────────────────────────────────────────────
echo
echo "═══════════════════════════════════════════════════════════════"
echo "Summary: ${#PASSED_GATES[@]} pass / ${#FAILED_GATES[@]} fail / ${#SKIPPED_GATES[@]} skip"
echo "═══════════════════════════════════════════════════════════════"

if [ "${#FAILED_GATES[@]}" -gt 0 ]; then
  echo "Failed gates: ${FAILED_GATES[*]}" >&2
  [ "$NO_FAIL" = "true" ] && exit 0 || exit 1
fi

exit 0
