#!/bin/bash
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$REPO/scripts/hermes-cron/concord-gate.sh" "doc-drift" "node scripts/check-doc-claims-all.mjs --ci" "$REPO"
