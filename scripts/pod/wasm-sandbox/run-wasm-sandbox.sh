#!/usr/bin/env bash
# Concord WASM code-exec sandbox launcher (Option B / wasmtime, no network). Installed at
# /opt/concord-wasm/run-wasm-sandbox.sh on the pod; called by pod-worker HANDLERS.exec.
#
# Layers (all must hold; escape suite 7/7 BLOCKED 2026-10-18):
#   - WASI capabilities: no env, no tcp/udp/http/network/DNS, no nn/tls; FS = fresh scratch preopened as guest "/" only
#   - guest limits: -W timeout (epoch interrupt) + -W max-memory-size
#   - host process: env -i (no host secrets), runs as nobody (setpriv), prlimit nproc/fsize/nofile/cpu,
#     plus a host SIGKILL wall-clock backstop (timeout -s KILL)
#   - stdout/stderr/stdin files live in a root-only dir the guest cannot see
#   - audit JSONL line per run (sha256 of code only; never raw code / secrets)
# Kill switch: touch /opt/concord-wasm/DISABLED  -> every run refused.
set -euo pipefail
BASE=/opt/concord-wasm
WASMTIME="$BASE/bin/wasmtime"
[ -x "$WASMTIME" ] || { echo '{"ok":false,"error":"wasmtime_missing"}'; exit 2; }
[ -e "$BASE/DISABLED" ] && { echo '{"ok":false,"error":"exec_disabled_on_pod"}'; exit 3; }

TIMEOUT_S=10
MEM_MB=64
AUDIT="${CONCORD_WASM_AUDIT:-/workspace/concord-pod/exec-audit.jsonl}"
ACTOR="-"; ROLE="-"; LANGUAGE="wasm"; CODE_SHA=""; STDIN_FILE="/dev/null"
MODULE=""; USER_ARGS=()
safe() { printf '%s' "$1" | tr -cd 'A-Za-z0-9_.:@-' | head -c 128; }

while [ $# -gt 0 ]; do
  case "$1" in
    --timeout) TIMEOUT_S="$2"; shift 2 ;;
    --mem-mb) MEM_MB="$2"; shift 2 ;;
    --audit) AUDIT="$2"; shift 2 ;;
    --actor) ACTOR="$(safe "$2")"; shift 2 ;;
    --role) ROLE="$(safe "$2")"; shift 2 ;;
    --language) LANGUAGE="$(safe "$2")"; shift 2 ;;
    --code-sha256) CODE_SHA="$(safe "$2")"; shift 2 ;;
    --stdin) STDIN_FILE="$2"; shift 2 ;;
    --) shift; MODULE="${1:-}"; shift || true; USER_ARGS=("$@"); break ;;
    -*) echo '{"ok":false,"error":"unknown_flag"}'; exit 2 ;;
    *) MODULE="$1"; shift; USER_ARGS=("$@"); break ;;
  esac
done
[ -n "$MODULE" ] && [ -f "$MODULE" ] || { echo '{"ok":false,"error":"missing_module"}'; exit 2; }
case "$TIMEOUT_S" in ''|*[!0-9]*) TIMEOUT_S=10 ;; esac
case "$MEM_MB" in ''|*[!0-9]*) MEM_MB=64 ;; esac
[ "$TIMEOUT_S" -lt 1 ] && TIMEOUT_S=1; [ "$TIMEOUT_S" -gt 30 ] && TIMEOUT_S=30
[ "$MEM_MB" -lt 8 ] && MEM_MB=8; [ "$MEM_MB" -gt 512 ] && MEM_MB=512

PRE=()
case "$MODULE" in *.cwasm) PRE=(--allow-precompiled) ;; esac

SCRATCH=$(mktemp -d /tmp/concord-wasm.XXXXXX)   # guest "/" (nobody-owned)
PRIV=$(mktemp -d /tmp/concord-wasm-io.XXXXXX)   # root-only, outside the guest's view
trap 'rm -rf "$SCRATCH" "$PRIV"' EXIT
chown 65534:65534 "$SCRATCH"; chmod 700 "$SCRATCH" "$PRIV"
OUT="$PRIV/stdout.txt"; ERR="$PRIV/stderr.txt"
# The guest process runs as nobody: stage a caller-supplied module (e.g. a .wat written to a root-only
# temp dir by the pod worker) into a traverse-only dir so wasmtime can read it. Shared runtimes under
# $BASE/runtimes are already world-readable and used in place.
case "$MODULE" in
  "$BASE"/runtimes/*) ;;
  *) MODDIR=$(mktemp -d /tmp/concord-wasm-mod.XXXXXX); chmod 711 "$MODDIR"
     trap 'rm -rf "$SCRATCH" "$PRIV" "$MODDIR"' EXIT
     EXT="${MODULE##*.}"; cp "$MODULE" "$MODDIR/module.$EXT"; chmod 644 "$MODDIR/module.$EXT"
     ORIG_MODULE="$MODULE"; MODULE="$MODDIR/module.$EXT" ;;
esac
MAXMEM=$((MEM_MB * 1024 * 1024))
START_MS=$(date +%s%3N)

set +e
env -i PATH=/usr/bin:/bin LANG=C.UTF-8 HOME="$SCRATCH" \
  timeout -s KILL "$((TIMEOUT_S + 5))" \
  setpriv --reuid 65534 --regid 65534 --clear-groups \
  prlimit --nproc=256 --fsize=16777216 --nofile=256 --cpu="$((TIMEOUT_S + 2))" -- \
  "$WASMTIME" run "${PRE[@]}" \
    -W "timeout=${TIMEOUT_S}s" \
    -W "max-memory-size=${MAXMEM}" \
    -S inherit-env=n -S tcp=n -S udp=n -S http=n -S inherit-network=n \
    -S allow-ip-name-lookup=n -S nn=n -S tls=n \
    --dir="$SCRATCH::/" \
    "$MODULE" "${USER_ARGS[@]}" \
    <"$STDIN_FILE" >"$OUT" 2>"$ERR"
RC=$?
set -e

DUR=$(( $(date +%s%3N) - START_MS ))
TIMED_OUT=false
grep -qiE 'wasm trap: interrupt|epoch' "$ERR" 2>/dev/null && TIMED_OUT=true
{ [ "$RC" -eq 124 ] || [ "$RC" -eq 137 ]; } && TIMED_OUT=true
[ "$DUR" -ge $((TIMEOUT_S * 1000)) ] && [ "$RC" -ne 0 ] && TIMED_OUT=true
[ -n "$CODE_SHA" ] || CODE_SHA=$(sha256sum "${ORIG_MODULE:-$MODULE}" | awk '{print $1}')
BYTES_OUT=$(wc -c <"$OUT" | tr -d ' ')
OK=false; [ "$RC" -eq 0 ] && [ "$TIMED_OUT" = false ] && OK=true

mkdir -p "$(dirname "$AUDIT")" 2>/dev/null || true
printf '{"ts":"%s","actor":"%s","role":"%s","language":"%s","codeSha256":"%s","durationMs":%s,"exitCode":%s,"timedOut":%s,"bytesOut":%s}\n' \
  "$(date -Iseconds)" "$ACTOR" "$ROLE" "$LANGUAGE" "$CODE_SHA" "$DUR" "$RC" "$TIMED_OUT" "$BYTES_OUT" >>"$AUDIT" 2>/dev/null || true
chmod 600 "$AUDIT" 2>/dev/null || true

python3 - "$OUT" "$ERR" "$OK" "$RC" "$DUR" "$TIMED_OUT" "$CODE_SHA" <<'PY'
import json, sys
o, e, ok, rc, dur, to, sha = sys.argv[1:8]
rd = lambda p: open(p, 'rb').read(65536).decode('utf-8', 'replace')
print(json.dumps({"ok": ok == "true", "stdout": rd(o), "stderr": rd(e), "exitCode": int(rc),
                  "durationMs": int(dur), "timedOut": to == "true", "codeSha256": sha}))
PY
