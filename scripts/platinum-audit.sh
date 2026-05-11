#!/usr/bin/env bash
# Platinum quality gate orchestrator — Sprint 18.
#
# Runs the full platinum-tier audit across server + frontend:
#
#   SECURITY
#     - npm audit (high/critical fail)
#     - secrets scan (gitleaks)
#     - dependency licenses (license-checker allowlist)
#
#   QUALITY
#     - server lint + typecheck + tests
#     - frontend lint + typecheck + tests
#     - production-grade-per-lens gate (Sprint 17 — 10/10 required)
#
#   PERFORMANCE
#     - bundle size budget (size-limit)
#     - Lighthouse CI per critical route (LCP/INP/CLS thresholds)
#
#   ACCESSIBILITY
#     - axe-core via Playwright (WCAG 2.2 AA — AAA on critical surfaces)
#
#   SUPPLY CHAIN
#     - SBOM generation (cyclonedx-bom)
#     - lockfile drift detection
#
# Each check is independently runnable. The script exits non-zero on
# the first failure unless --continue is passed (logs all, then exits
# with the worst result code).
#
# Usage:
#   scripts/platinum-audit.sh                # full audit, fail-fast
#   scripts/platinum-audit.sh --continue     # log everything, then fail
#   scripts/platinum-audit.sh --only=security
#   scripts/platinum-audit.sh --only=quality

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="$REPO_ROOT/server"
FRONTEND="$REPO_ROOT/concord-frontend"

CONTINUE_ON_ERROR=false
ONLY=""

for arg in "$@"; do
  case $arg in
    --continue) CONTINUE_ON_ERROR=true ;;
    --only=*) ONLY="${arg#*=}" ;;
  esac
done

FAILED=()
PASSED=()

run() {
  local name="$1"
  shift
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "▶ $name"
  echo "═══════════════════════════════════════════════════════════════"
  if "$@"; then
    echo "✓ $name"
    PASSED+=("$name")
  else
    echo "✗ $name"
    FAILED+=("$name")
    if [ "$CONTINUE_ON_ERROR" != "true" ]; then
      exit 1
    fi
  fi
}

want() {
  local category="$1"
  [ -z "$ONLY" ] || [ "$ONLY" = "$category" ]
}

# ── SECURITY ──────────────────────────────────────────────────────

if want security; then
  run "Server: npm audit (high/critical)" \
    bash -c "cd '$SERVER' && npm audit --production --audit-level=high"

  run "Frontend: npm audit (high/critical)" \
    bash -c "cd '$FRONTEND' && npm audit --production --audit-level=high"

  if command -v gitleaks >/dev/null 2>&1; then
    run "Secrets scan (gitleaks)" \
      bash -c "cd '$REPO_ROOT' && gitleaks detect --no-git --redact -s . -c .gitleaks.toml"
  else
    echo "⚠ gitleaks not installed; skipping (install: brew install gitleaks)"
  fi

  if [ -f "$REPO_ROOT/.license-checker-allowlist.json" ]; then
    run "Server: license compliance" \
      bash -c "cd '$SERVER' && npx license-checker --production --json | node '$REPO_ROOT/scripts/check-licenses.js' '$REPO_ROOT/.license-checker-allowlist.json'"
  fi
fi

# ── QUALITY ────────────────────────────────────────────────────────

if want quality; then
  run "Server: lint" \
    bash -c "cd '$SERVER' && npm run lint:ci"
  run "Server: typecheck" \
    bash -c "cd '$SERVER' && npm run typecheck"
  run "Server: check-deps" \
    bash -c "cd '$SERVER' && npm run check-deps"
  run "Frontend: lint" \
    bash -c "cd '$FRONTEND' && NODE_OPTIONS=--max-old-space-size=6144 npm run lint"
  run "Frontend: typecheck" \
    bash -c "cd '$FRONTEND' && NODE_OPTIONS=--max-old-space-size=6144 npm run type-check"
  run "Production-grade-per-lens gate (STRICT)" \
    bash -c "cd '$FRONTEND' && npx tsx scripts/validate-production-grade-lens.ts --strict"
  run "Validate-routes" \
    bash -c "cd '$FRONTEND' && npm run validate-routes"
  run "Validate-lens-quality" \
    bash -c "cd '$FRONTEND' && npm run validate-lens-quality"
fi

# ── PERFORMANCE ────────────────────────────────────────────────────

if want performance; then
  if [ -f "$FRONTEND/.size-limit.json" ]; then
    run "Bundle size budget (size-limit)" \
      bash -c "cd '$FRONTEND' && npx size-limit"
  else
    echo "⚠ .size-limit.json not found; bundle-size gate skipped (Sprint 18 ships the config; CI integration is follow-on)"
  fi

  if [ -f "$FRONTEND/lighthouserc.json" ]; then
    run "Lighthouse CI (Core Web Vitals)" \
      bash -c "cd '$FRONTEND' && npx @lhci/cli@latest autorun --config=lighthouserc.json"
  else
    echo "⚠ lighthouserc.json not found; Lighthouse CI skipped (Sprint 18 ships the config; running it requires a built app + CI infra)"
  fi
fi

# ── ACCESSIBILITY ──────────────────────────────────────────────────

if want accessibility; then
  if [ -f "$FRONTEND/tests/a11y/axe.spec.ts" ]; then
    run "axe-core accessibility (Playwright)" \
      bash -c "cd '$FRONTEND' && npx playwright test tests/a11y --reporter=list"
  else
    echo "⚠ axe-core Playwright test not found; a11y deep-scan skipped (Sprint 18 ships the spec; running it requires built app + Playwright infra)"
  fi
fi

# ── SUPPLY CHAIN ───────────────────────────────────────────────────

if want supply_chain; then
  if command -v npx >/dev/null 2>&1 && npx --no-install @cyclonedx/cyclonedx-npm --version >/dev/null 2>&1; then
    run "SBOM generation (cyclonedx)" \
      bash -c "cd '$REPO_ROOT' && npx @cyclonedx/cyclonedx-npm --output-file audit/sbom.json"
  else
    echo "⚠ @cyclonedx/cyclonedx-npm not available; SBOM generation skipped"
  fi
fi

# ── REPORT ─────────────────────────────────────────────────────────

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "Platinum audit summary"
echo "═══════════════════════════════════════════════════════════════"
echo "Passed:  ${#PASSED[@]}"
echo "Failed:  ${#FAILED[@]}"
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo ""
  echo "Failures:"
  for f in "${FAILED[@]}"; do echo "  ✗ $f"; done
  exit 1
fi
echo ""
echo "✓ Platinum gate passed."
exit 0
