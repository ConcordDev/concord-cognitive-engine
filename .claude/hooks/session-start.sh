#!/bin/bash
# SessionStart hook — install the `gh` CLI so Claude can fetch
# Actions workflow logs and artifacts directly (instead of guessing
# from rendered HTML, which is unreliable).
#
# Authentication: if GH_TOKEN or GITHUB_TOKEN is exported as a Claude
# Code environment secret for this repo, the hook authenticates it
# automatically. Without a token, gh is still installed but reads of
# rate-limited / private endpoints will fail — pass a token next time
# you want full access.
#
# Web-session-only: local devs already have gh installed and don't
# need this overhead.
set -euo pipefail

# Skip on local runs — Claude Code on the web sets CLAUDE_CODE_REMOTE=true.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# 1) Install gh if it's not already on PATH. apt is the durable choice:
#    the container image caches the install, so subsequent sessions in
#    the same container skip the apt-get fetch entirely.
#
# The container image ships with stale PPA configs (deadsnakes, ondrej/php)
# that 403 on `apt-get update` — but the base `gh` package is already in
# the local apt cache, so try install-without-update first. Only fall back
# to refreshing the index if the cached install fails.
if ! command -v gh > /dev/null 2>&1; then
  echo "[session-start] installing gh (GitHub CLI) via apt..."
  export DEBIAN_FRONTEND=noninteractive
  if ! apt-get install -y -qq --no-install-recommends gh 2>/dev/null; then
    echo "[session-start] cached install failed; refreshing apt index..."
    apt-get update -qq -o Acquire::AllowInsecureRepositories=true || true
    apt-get install -y -qq --no-install-recommends gh
  fi
fi

# 2) Authenticate if a token is exposed. gh prefers GH_TOKEN; fall back
#    to GITHUB_TOKEN. Both are conventional names for the secret.
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"
if [ -n "$TOKEN" ]; then
  # `gh auth login --with-token` reads the token from stdin and writes
  # it to gh's config dir. Idempotent — running twice is a no-op.
  if ! gh auth status > /dev/null 2>&1; then
    echo "[session-start] authenticating gh with provided token..."
    echo "$TOKEN" | gh auth login --with-token
  fi
else
  echo "[session-start] no GH_TOKEN / GITHUB_TOKEN found in env."
  echo "[session-start] gh is installed but rate-limited reads will fail."
  echo "[session-start] add GH_TOKEN as a Claude Code environment secret"
  echo "[session-start] to unlock full workflow-log / artifact access."
fi

echo "[session-start] gh ready: $(gh --version 2>&1 | head -1)"
