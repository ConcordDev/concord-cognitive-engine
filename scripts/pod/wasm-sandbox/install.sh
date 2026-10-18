#!/usr/bin/env bash
# Idempotent pod installer for the Concord WASM code-exec sandbox (PR-10). Run as root on the pod.
# Container disk (/opt) is wiped when the pod is reset — re-run this from the volume copy:
#   bash /workspace/concord-pod/wasm-sandbox/install.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
BASE=/opt/concord-wasm
WASMTIME_VERSION=v49.0.3
PY_URL="https://github.com/vmware-labs/webassembly-language-runtimes/releases/download/python%2F3.12.0%2B20231211-040d5a6/python-3.12.0.wasm"
PY_SHA=e5dc5a398b07b54ea8fdb503bf68fb583d533f10ec3f930963e02b9505f7a763
mkdir -p "$BASE/bin" "$BASE/runtimes" "$BASE/escape-tests"
if ! "$BASE/bin/wasmtime" --version 2>/dev/null | grep -q "${WASMTIME_VERSION#v}"; then
  if [ ! -x /root/.wasmtime/bin/wasmtime ] || ! /root/.wasmtime/bin/wasmtime --version | grep -q "${WASMTIME_VERSION#v}"; then
    curl -sSf https://wasmtime.dev/install.sh | bash -s -- --version "$WASMTIME_VERSION"
  fi
  install -m 755 /root/.wasmtime/bin/wasmtime "$BASE/bin/wasmtime"   # /root is 0700; nobody must exec it
fi
ln -sfn "$BASE/bin/wasmtime" "$BASE/wasmtime"
PY="$BASE/runtimes/python-3.12.0.wasm"
if [ "$(sha256sum "$PY" 2>/dev/null | awk '{print $1}')" != "$PY_SHA" ]; then
  curl -sSfL -o "$PY.tmp" "$PY_URL"
  [ "$(sha256sum "$PY.tmp" | awk '{print $1}')" = "$PY_SHA" ] || { echo "python.wasm sha mismatch"; rm -f "$PY.tmp"; exit 1; }
  mv "$PY.tmp" "$PY"
fi
# precompile with the same engine flags the launcher uses (-W timeout => epoch interruption)
"$BASE/bin/wasmtime" compile -W epoch-interruption=y -o "$BASE/runtimes/python-3.12.0.cwasm" "$PY"
chmod 644 "$BASE/runtimes/"*
install -m 755 "$SRC/run-wasm-sandbox.sh" "$BASE/run-wasm-sandbox.sh"
cp "$SRC/escape-tests/"* "$BASE/escape-tests/"; chmod 755 "$BASE/escape-tests/"*.sh "$BASE/escape-tests/"*.py
python3 "$BASE/escape-tests/run-all.py" /tmp/concord-wasm-escape-results.json
echo "concord-wasm installed: $("$BASE/bin/wasmtime" --version)"
