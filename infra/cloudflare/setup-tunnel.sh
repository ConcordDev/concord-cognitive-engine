#!/usr/bin/env bash
# Concord — Cloudflare Tunnel one-shot setup helper.
#
# Two modes. Pick TOKEN_MODE if you've created the tunnel in the
# Cloudflare Zero Trust dashboard and just need to set the token env;
# pick CONFIG_FILE_MODE if you want explicit ingress rules.
#
# Usage:
#   bash infra/cloudflare/setup-tunnel.sh
#
# This script never makes destructive changes. It writes/edits .env
# and prints next steps. You always run docker compose yourself.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${REPO_ROOT}/.env"
CF_DIR="${REPO_ROOT}/infra/cloudflare"

color() { printf "\033[%sm%s\033[0m" "$1" "$2"; }
info()  { echo -e "$(color 36 '──')  $*"; }
warn()  { echo -e "$(color 33 '!')  $*"; }
ok()    { echo -e "$(color 32 '✓')  $*"; }
err()   { echo -e "$(color 31 '✗')  $*" >&2; }

cat <<'BANNER'
╭─────────────────────────────────────────────────────────────────────╮
│  Concord — Cloudflare Tunnel setup                                  │
│                                                                     │
│  Routes a public domain to your Concord backend on RunPod (or any   │
│  GPU box) without opening inbound ports. Tunnel runs as a sidecar.  │
╰─────────────────────────────────────────────────────────────────────╯
BANNER

# ── Mode selection ─────────────────────────────────────────────────────────
echo ""
info "Pick a mode:"
echo "  1) TOKEN MODE      (recommended — single env var, no config files)"
echo "  2) CONFIG-FILE MODE (explicit ingress rules + credentials JSON)"
echo ""
read -r -p "Mode [1/2]: " MODE
echo ""

case "$MODE" in
  1) MODE="token" ;;
  2) MODE="config" ;;
  *) err "Unknown mode '$MODE' — pick 1 or 2"; exit 1 ;;
esac

# ── TOKEN MODE ─────────────────────────────────────────────────────────────
if [ "$MODE" = "token" ]; then
  cat <<'STEPS'
TOKEN MODE — what to do in Cloudflare's dashboard first:

  1. Open https://one.dash.cloudflare.com/  (Zero Trust)
  2. Networks → Tunnels → Create a tunnel
  3. Pick "Cloudflared" connector
  4. Name it (e.g. "concord-runpod"), Save
  5. On the next screen, copy the LONG token string (starts with "ey...")
     — that's your CF_TUNNEL_TOKEN.
  6. Click "Next", then on the "Public Hostnames" tab add a route:
       Subdomain: concord
       Domain:    <your-domain>.com
       Service:   HTTP   http://concord-backend:5050
     Add a second route for socket.io if your client uses real-time:
       Subdomain: concord
       Domain:    <your-domain>.com
       Path:      /socket.io/.*
       Service:   HTTP   http://concord-backend:5050
  7. Save.

STEPS

  read -r -p "Paste your CF_TUNNEL_TOKEN: " CF_TOKEN
  if [ -z "$CF_TOKEN" ]; then
    err "Token cannot be empty"
    exit 1
  fi

  # Append (or replace) CF_TUNNEL_TOKEN in .env
  if [ -f "$ENV_FILE" ] && grep -q "^CF_TUNNEL_TOKEN=" "$ENV_FILE"; then
    # Replace existing line
    sed -i.bak "s|^CF_TUNNEL_TOKEN=.*|CF_TUNNEL_TOKEN=${CF_TOKEN}|" "$ENV_FILE"
    rm -f "${ENV_FILE}.bak"
    ok "Updated CF_TUNNEL_TOKEN in $ENV_FILE"
  else
    {
      echo ""
      echo "# Cloudflare Tunnel (added by setup-tunnel.sh)"
      echo "CF_TUNNEL_TOKEN=${CF_TOKEN}"
    } >> "$ENV_FILE"
    ok "Appended CF_TUNNEL_TOKEN to $ENV_FILE"
  fi

  echo ""
  ok "Token mode configured."
  cat <<'NEXT'

Now run:

  docker compose \
    -f docker-compose.yml \
    -f infra/cloudflare/docker-compose.cloudflared.yml \
    up -d

Verify the tunnel:

  docker logs -f concord-cloudflared

You should see "Registered tunnel connection" within ~5 seconds.
Then visit https://concord.<your-domain>.com — it should show your
Concord landing page.

NEXT
  exit 0
fi

# ── CONFIG-FILE MODE ───────────────────────────────────────────────────────
if [ "$MODE" = "config" ]; then
  cat <<'STEPS'
CONFIG-FILE MODE — what to do first:

  1. Install cloudflared locally (one-time, on a machine with a browser):
       brew install cloudflared    # macOS
       # or download from https://github.com/cloudflare/cloudflared/releases

  2. Authenticate cloudflared and create the tunnel:
       cloudflared tunnel login                   # opens browser
       cloudflared tunnel create concord-runpod
     This prints a TUNNEL_UUID and writes ~/.cloudflared/<UUID>.json

  3. Route DNS:
       cloudflared tunnel route dns concord-runpod concord.<your-domain>.com

  4. Copy the credentials JSON into this repo:
       cp ~/.cloudflared/<UUID>.json infra/cloudflare/credentials.json

STEPS

  read -r -p "Path to your <UUID>.json file: " CREDS_PATH
  if [ ! -f "$CREDS_PATH" ]; then
    err "File not found: $CREDS_PATH"
    exit 1
  fi
  TUNNEL_UUID=$(basename "$CREDS_PATH" | sed 's/\.json$//')
  if [ -z "$TUNNEL_UUID" ]; then
    err "Couldn't infer tunnel UUID from filename"
    exit 1
  fi
  cp "$CREDS_PATH" "${CF_DIR}/credentials.json"
  chmod 600 "${CF_DIR}/credentials.json"
  ok "Credentials installed at ${CF_DIR}/credentials.json"

  read -r -p "Public hostname (e.g. concord.example.com): " HOSTNAME_INPUT
  if [ -z "$HOSTNAME_INPUT" ]; then
    err "Hostname cannot be empty"
    exit 1
  fi

  TARGET_CONFIG="${CF_DIR}/cloudflared.yml"
  cp "${CF_DIR}/cloudflared.yml.example" "$TARGET_CONFIG"
  # Replace placeholders.
  sed -i.bak "s|<TUNNEL_UUID>|${TUNNEL_UUID}|g; s|concord.<YOUR_DOMAIN>|${HOSTNAME_INPUT}|g" "$TARGET_CONFIG"
  rm -f "${TARGET_CONFIG}.bak"
  ok "Config written to $TARGET_CONFIG"

  cat <<NEXT

Now uncomment the CONFIG-FILE MODE block in
infra/cloudflare/docker-compose.cloudflared.yml (and comment out the
TOKEN MODE command line), then run:

  docker compose \\
    -f docker-compose.yml \\
    -f infra/cloudflare/docker-compose.cloudflared.yml \\
    up -d

Verify:

  docker logs -f concord-cloudflared
  curl -I https://${HOSTNAME_INPUT}

NEXT
  exit 0
fi
