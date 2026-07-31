#!/usr/bin/env bash
# scripts/launch-godot-client.sh — launches the native Godot client connected
# to Concord's /godot-ws gateway, as part of the SAME one-command bare-metal
# boot sequence as the backend/frontend (see startup.sh, and
# ecosystem.config.cjs's "concord-godot-client" pm2 app that runs this).
#
# Godot is a CLIENT here (docs/GODOT_INTEGRATION.md: "The Godot client ships
# as a native binary that connects to the Concord server over wss://") — it
# is NOT a server-side authoritative-physics sidecar that must run for
# Concord itself to work. This script exists so a box that boots Concord can
# also have a connected Godot instance ready without a second manual step,
# on either a workstation with a display or a headless compute box.
#
# CONCORD_LAUNCH_GODOT controls whether this actually launches anything:
#   auto (default) — launch only if a display is available ($DISPLAY or
#                     $WAYLAND_DISPLAY set). A headless GPU compute box (no
#                     monitor attached — e.g. the real A40 production
#                     target, see CLAUDE.md's GPU/CPU pinning audit)
#                     correctly does nothing.
#   1 / true / on   — force-launch even with no display, using --headless.
#                     Draws nothing (RasterizerDummy — see
#                     docs/GODOT_RUNTIME.md §6), but proves the
#                     engine/project/gateway/auth pipeline is genuinely live
#                     end-to-end: a real connectivity smoke test, not a
#                     rendering solution.
#   0 / false / off — never launch.
#
# This decision is made BEFORE any binary resolution/fetch below, on purpose:
# a headless box that's going to idle anyway (auto + no display) must never
# pay for a ~58MB engine download it's not going to use.
#
# Credentials: CONCORD_GODOT_API_KEY (preferred — long-lived, matches
# net/gateway_client.gd's api_key auth path) or CONCORD_GODOT_AUTH_TOKEN (a
# bearer token) must be set in .env for auth to succeed. This script does
# NOT auto-provision either — minting a service-account credential is an
# authz-relevant decision left to the operator, not something to default
# silently. Without one, this still launches (proving the engine/project are
# ready) but logs an honest warning rather than a fabricated "connected".
#
# CONCORD_GODOT_SPECTATOR=true — read-only spectator viewer milestone (R6):
# free-fly camera, no character body, no design/playtest authoring. Needs no
# script change here — world/boot.gd's own resolve_runtime_config reads it
# straight from the inherited environment, same as CONCORD_WORLD_ID below.
#
# Godot binary resolution honors an existing install before falling back to
# an auto-fetch (docs/GODOT_RUNTIME.md §5.2 point 3):
#   1. $GODOT_BIN, if set and executable
#   2. `godot` on PATH, only if its --version matches the project's pinned
#      major.minor (version skew silently opens a project built for a
#      different engine version — see that doc's §5.1 option (e) warning)
#   3. .godot-runtime/bin/godot, fetching it via `node scripts/fetch-godot.mjs`
#      first if it isn't already there — this is what makes "boot Concord"
#      alone sufficient; nobody has to remember a separate fetch step.
#      Gated by CONCORD_FETCH_GODOT (default 1), matching setup.sh/startup.sh's
#      own gate, and is itself non-fatal — a failed fetch idles honestly
#      rather than crash-looping.
#
# Once a binary is resolved, this also runs a real `--import` pass before the
# actual launch (idempotent — Godot's own import cache makes a repeat run
# cheap; see docs/GODOT_RUNTIME.md's own "never fold import into a --quit run"
# landmine for why this is a SEPARATE full pass, not combined with the launch
# below) so the very first real boot doesn't race a half-imported project.
#
# Run under pm2 (ecosystem.config.cjs's concord-godot-client app) so it is
# supervised the same way as backend/frontend/tunnel. When this script
# decides NOT to launch Godot, it sleeps indefinitely rather than exiting —
# pm2 then sees a stable "up" process instead of treating an intentional,
# correct no-op as a crash-loop.

set -uo pipefail  # deliberately no -e: every branch below must reach its own
                  # logging + graceful idle/exec, never abort mid-decision.

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$SCRIPT_DIR"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [godot-client] $*"; }

PORT="${PORT:-5050}"
LAUNCH_MODE="${CONCORD_LAUNCH_GODOT:-auto}"
FETCH_GODOT="${CONCORD_FETCH_GODOT:-1}"

case "$LAUNCH_MODE" in
  0|false|off)
    log "CONCORD_LAUNCH_GODOT=$LAUNCH_MODE — Godot client launch disabled. Idling."
    exec sleep infinity
    ;;
esac

# ── Decide headless vs windowed vs idle FIRST (before touching the binary) ──
HEADLESS_ARGS=()
case "$LAUNCH_MODE" in
  1|true|on)
    log "CONCORD_LAUNCH_GODOT=$LAUNCH_MODE — forcing launch with no display assumed -> --headless (connectivity-only, draws nothing)."
    HEADLESS_ARGS=(--headless)
    ;;
  *)
    if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
      log "Display detected (DISPLAY=${DISPLAY:-<unset>} WAYLAND_DISPLAY=${WAYLAND_DISPLAY:-<unset>}) — launching windowed."
    else
      log "No display detected and CONCORD_LAUNCH_GODOT=auto — expected on a headless compute box (no monitor)."
      log "Set CONCORD_LAUNCH_GODOT=1 to force a headless connectivity-only launch instead. Idling."
      exec sleep infinity
    fi
    ;;
esac

# ── Resolve the Godot binary, fetching it automatically if none is found ───
GODOT_PROJECT_VERSION="$(grep -m1 'config/features' world-lens-godot/project.godot | grep -oE '4\.[0-9]+' | head -1)"
# Full expected version string (e.g. "4.4.stable.official.4c311cbee") for the
# STRICT check below — pulled from fetch-godot.mjs's PINNED map, the single
# source of truth, so this script never carries its own duplicate/driftable
# copy of the pin. Empty if the derived project version has no pinned entry.
# Plain text-match (not an import) so this works regardless of Node's ESM/
# CJS mode in the caller's environment.
GODOT_PROJECT_VERSION_STRING="$(node -e "
  const fs = require('fs');
  const src = fs.readFileSync('$SCRIPT_DIR/scripts/fetch-godot.mjs', 'utf8');
  const m = src.match(/\"${GODOT_PROJECT_VERSION}-stable\":\s*\{[^}]*versionString:\s*\"([^\"]+)\"/);
  if (m) process.stdout.write(m[1]);
" 2>/dev/null || true)"

resolve_godot_bin() {
  if [ -n "${GODOT_BIN:-}" ] && [ -x "${GODOT_BIN}" ]; then
    echo "$GODOT_BIN"; return 0
  fi
  if command -v godot &>/dev/null; then
    local raw v_major_minor v_full ok=0
    raw="$(godot --version 2>/dev/null)"
    v_major_minor="$(echo "$raw" | grep -oE '4\.[0-9]+' | head -1)"
    v_full="$(echo "$raw" | head -1 | tr -d '\n')"
    # FIXED (audit 2026-07-27): this used to compare ONLY major.minor
    # ("4.4"), which accepts a 4.4.1 patch release or a Mono/.NET build of
    # 4.4 in place of the checksum-verified standard binary fetch-godot.mjs
    # installs — a real gap between this script's guarantee and that
    # script's. When a full pinned version string is available for the
    # project's derived version, require an EXACT match against it (not
    # just a prefix — a Mono build's version string differs from the
    # standard one even at the same numeric version). Falls back to the
    # weaker major.minor check only when no pin is on record for this
    # version (e.g. local dev ahead of the pinned release), with a loud
    # note that verification is weaker in that case.
    if [ -n "$GODOT_PROJECT_VERSION_STRING" ]; then
      [ "$v_full" = "$GODOT_PROJECT_VERSION_STRING" ] && ok=1
    elif [ -n "$v_major_minor" ] && [ "$v_major_minor" = "$GODOT_PROJECT_VERSION" ]; then
      ok=1
      log "NOTE: no pinned full version string on record for $GODOT_PROJECT_VERSION-stable — accepted 'godot' on PATH by major.minor only ($v_major_minor). This does not reject a patch release or a Mono/.NET build."
    fi
    if [ "$ok" = "1" ]; then
      command -v godot; return 0
    fi
    log "NOTE: found 'godot' on PATH but its version ('$v_full') doesn't match the project's pinned build — skipping it (docs/GODOT_RUNTIME.md warns version skew silently opens the wrong project)."
  fi
  if [ -x "$SCRIPT_DIR/.godot-runtime/bin/godot" ]; then
    echo "$SCRIPT_DIR/.godot-runtime/bin/godot"; return 0
  fi
  return 1
}

GD="$(resolve_godot_bin)"
if [ -z "$GD" ]; then
  if [ "$FETCH_GODOT" = "1" ]; then
    log "No Godot engine binary found — fetching one now (node scripts/fetch-godot.mjs)..."
    if node scripts/fetch-godot.mjs; then
      GD="$(resolve_godot_bin)"
    else
      log "WARNING: Godot engine fetch failed. Retry manually with: node scripts/fetch-godot.mjs"
      log "         Idling until the next restart (pm2 will retry this script)."
      exec sleep infinity
    fi
  else
    log "No Godot engine binary found and CONCORD_FETCH_GODOT=0 — not fetching. Idling."
    exec sleep infinity
  fi
fi
if [ -z "$GD" ]; then
  log "WARNING: fetch reported success but no usable binary was found afterward — idling until the next restart."
  exec sleep infinity
fi
log "Using Godot binary: $GD ($("$GD" --version 2>/dev/null | head -1))"

# ── Import pass (idempotent) — avoids racing a half-imported project on the
# very first real boot. A SEPARATE full pass, never folded into the launch
# below (docs/GODOT_RUNTIME.md's own landmine: --quit/--quit-after during
# import leaves .godot/imported/ half-written).
log "Running project import (idempotent; fast if already up to date)..."
if ! "$GD" --headless --path world-lens-godot --import >/tmp/concord-godot-import.log 2>&1; then
  log "WARNING: project import reported a non-zero exit — continuing anyway; see /tmp/concord-godot-import.log. The real launch below will surface any genuine failure honestly."
fi

# ── Wait for the Concord backend to be healthy before connecting ───────────
log "Waiting for Concord backend on port $PORT..."
RETRIES=60
while [ $RETRIES -gt 0 ]; do
  if curl -sf "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    log "Backend healthy — proceeding."
    break
  fi
  RETRIES=$((RETRIES - 1))
  sleep 3
done
if [ "$RETRIES" -eq 0 ]; then
  log "WARNING: backend never became healthy within the wait window — launching anyway; GatewayClient auto-reconnects once it is up (see net/gateway_client.gd's backoff loop)."
fi

# ── Credentials — honest, never auto-provisioned ────────────────────────────
export CONCORD_GATEWAY_URL="${CONCORD_GATEWAY_URL:-ws://127.0.0.1:${PORT}/godot-ws}"
if [ -z "${CONCORD_GODOT_API_KEY:-}" ] && [ -z "${CONCORD_GODOT_AUTH_TOKEN:-}" ]; then
  log "WARNING: neither CONCORD_GODOT_API_KEY nor CONCORD_GODOT_AUTH_TOKEN is set in the environment."
  log "         The client will connect but auth will fail (server replies auth:error, code 4401)."
  log "         Create an API key in the app and set CONCORD_GODOT_API_KEY in .env, then restart this app."
fi

log "Launching Godot (gateway=${CONCORD_GATEWAY_URL}, world=${CONCORD_WORLD_ID:-concordia-hub}, spectator=${CONCORD_GODOT_SPECTATOR:-false})..."
exec "$GD" "${HEADLESS_ARGS[@]}" --path world-lens-godot
