#!/bin/bash
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$REPO/scripts/hermes-cron/concord-gate.sh" "depth-floor" "node scripts/grade-macro-depth.mjs --honest --ci" "$REPO"
