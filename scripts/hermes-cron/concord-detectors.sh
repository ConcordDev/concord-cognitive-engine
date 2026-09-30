#!/bin/bash
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$REPO/scripts/hermes-cron/concord-gate.sh" "detectors" "cd server && node scripts/run-detectors.js --diff --ci" "$REPO"
