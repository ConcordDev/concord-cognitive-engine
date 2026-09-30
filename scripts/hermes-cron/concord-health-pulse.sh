#!/bin/bash
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
exec "$REPO/scripts/hermes-cron/concord-gate.sh" "health-pulse" "curl -fsS http://127.0.0.1:5050/health || echo 'server unreachable'" "$REPO"
