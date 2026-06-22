#!/usr/bin/env bash
# Concord — load-test runner. Picks k6 if installed, else the zero-dep Node
# smoke test. Defaults to a SAFE read + WebSocket test (no writes, no GPU).
#
#   ./scripts/loadtest/run.sh https://concord-os.org
#   ./scripts/loadtest/run.sh https://concord-os.org soak
#
# Arg 1: base URL (default http://localhost:5050)
# Arg 2: ramp profile — normal | soak | spike   (default normal)

set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE_URL="${1:-http://localhost:5050}"
RAMP="${2:-normal}"

echo ""
echo "  Concord load test → $BASE_URL  (ramp: $RAMP)"
echo ""

if command -v k6 >/dev/null 2>&1; then
  echo "  k6 found — running the full scenario mix (read + WebSocket)."
  echo "  Write/chat scenarios are OPT-IN; see README.md."
  echo ""
  BASE_URL="$BASE_URL" RAMP="$RAMP" k6 run "$SCRIPT_DIR/k6-mix.js"
else
  echo "  k6 not installed — falling back to the zero-dep Node read smoke test."
  echo "  (Install k6 for the WebSocket ceiling + ramp-to-knee:"
  echo "     https://grafana.com/docs/k6/latest/set-up/install-k6/ )"
  echo ""
  # Staircase a few concurrency levels so you can eyeball the knee.
  for C in 50 200 500 1000; do
    echo "  ── $C concurrent workers ───────────────────────────────"
    node "$SCRIPT_DIR/quick-smoke.mjs" --url "$BASE_URL" -c "$C" -d 20 --ramp 5
  done
fi
