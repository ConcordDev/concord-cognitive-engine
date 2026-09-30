#!/bin/bash
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$REPO/scripts/hermes-cron/concord-gate.sh" "lens-wiring" "node scripts/verify-lens-backends.mjs --ci" "$REPO"
