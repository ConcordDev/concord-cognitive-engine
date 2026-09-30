#!/bin/bash
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$REPO/scripts/hermes-cron/concord-gate.sh" "ux-polish" "node scripts/grade-ux-polish.mjs --honest --ci" "$REPO"
