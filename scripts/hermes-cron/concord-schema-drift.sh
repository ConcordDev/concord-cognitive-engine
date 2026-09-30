#!/bin/bash
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$REPO/scripts/hermes-cron/concord-gate.sh" "schema-drift" "node scripts/verify-schema-drift.mjs --ci 0" "$REPO"
