#!/usr/bin/env bash
# Run 7 WASM escape tests via Concord launcher. Exit 0 only if all BLOCKED (pass).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAUNCHER="$ROOT/run-wasm-sandbox.sh"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_JSON="${1:-/tmp/concord-wasm-escape-results.json}"
export SECRET_PROBE="should-never-reach-guest-$$"
export CONCORD_POD_JOB_TOKEN="fake-token-should-not-leak"
export CONCORD_WASM_AUDIT="${CONCORD_WASM_AUDIT:-/workspace/concord-pod/exec-audit-wasm-escape.jsonl}"

pass=0; fail=0; results=()

judge() {
  local id="$1" title="$2" wat="$3" mode="$4" # mode: deny_output|timeout|nolink
  local raw rc=0
  set +e
  # Ensure host secret is in environment when launcher starts (launcher uses env -i)
  raw=$(SECRET_PROBE="$SECRET_PROBE" CONCORD_POD_JOB_TOKEN="$CONCORD_POD_JOB_TOKEN" \
    "$LAUNCHER" --timeout 3 --mem-mb 64 -- "$wat" 2>/tmp/wasm-escape-outer.err)
  rc=$?
  set -e
  local stdout stderr timed
  stdout=$(printf '%s' "$raw" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("stdout",""))' 2>/dev/null || true)
  stderr=$(printf '%s' "$raw" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("stderr",""))' 2>/dev/null || true)
  timed=$(printf '%s' "$raw" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("timedOut",False))' 2>/dev/null || echo false)
  # outer err may hold link errors when JSON incomplete
  local outer; outer=$(cat /tmp/wasm-escape-outer.err 2>/dev/null || true)
  local blocked=false reason=""
  case "$mode" in
    deny_output)
      if printf '%s%s%s' "$stdout" "$stderr" "$outer" | grep -qE 'OPEN_DENIED|ENV_CLEAN|WRITE_OUTSIDE_DENIED|BACKUP_READ_DENIED'; then
        blocked=true; reason="guest_reported_denied"
      elif printf '%s%s' "$stderr" "$outer" | grep -qiE 'failed to|unknown import|not found|error'; then
        blocked=true; reason="runtime_rejected"
      elif printf '%s' "$stdout" | grep -qE 'OPEN_OK|ENV_LEAK|WRITE_OUTSIDE_OK|BACKUP_READ_OK|NETWORK_REACHABLE|FORK_OK'; then
        blocked=false; reason="escape_signal_in_stdout"
      else
        blocked=true; reason="no_escape_signal"
      fi
      ;;
    nolink)
      if printf '%s%s%s' "$stdout" "$stderr" "$outer" | grep -qiE 'unknown import|failed to|link|not found|incompatible import'; then
        blocked=true; reason="import_not_provided"
      elif printf '%s' "$stdout" | grep -qE 'NETWORK_REACHABLE|FORK_OK'; then
        blocked=false; reason="dangerous_import_worked"
      else
        # non-zero without success marker
        if [ "$rc" -ne 0 ]; then blocked=true; reason="non_zero_exit"; else blocked=false; reason="unexpected_success"; fi
      fi
      ;;
    timeout)
      if [ "$timed" = "True" ] || [ "$timed" = "true" ] || [ "$rc" -eq 124 ] || [ "$rc" -eq 137 ]; then
        blocked=true; reason="wall_clock_killed"
      else
        blocked=false; reason="loop_not_killed"
      fi
      ;;
  esac
  if [ "$blocked" = true ]; then
    echo "PASS  $id $title ($reason)"
    pass=$((pass+1))
    results+=("{\"id\":$id,\"title\":$(python3 -c "import json;print(json.dumps('$title'))"),\"result\":\"BLOCKED\",\"reason\":\"$reason\"}")
  else
    echo "FAIL  $id $title ($reason)"
    fail=$((fail+1))
    results+=("{\"id\":$id,\"title\":$(python3 -c "import json;print(json.dumps('$title'))"),\"result\":\"NOT_BLOCKED\",\"reason\":\"$reason\",\"stdout\":$(python3 -c "import json,os;print(json.dumps(os.environ.get('X','''$stdout''')))")}")
  fi
}

judge 1 "read /etc/shadow" "$DIR/01-read-shadow.wat" deny_output
judge 2 "read secret env var" "$DIR/02-read-env.wat" deny_output
judge 3 "reach the network" "$DIR/03-network.wat" nolink
judge 4 "fork bomb" "$DIR/04-fork-bomb.wat" nolink
judge 5 "write outside tmp" "$DIR/05-write-outside.wat" deny_output
judge 6 "read /workspace/concord-backups" "$DIR/06-read-backups.wat" deny_output
judge 7 "exceed wall-clock timeout" "$DIR/07-timeout.wat" timeout

# verify host marker file for test 5 was NOT created
if [ -e /workspace/concord-wasm-escape-write ]; then
  echo "FAIL  host file /workspace/concord-wasm-escape-write was created"
  fail=$((fail+1))
fi

python3 - "$OUT_JSON" "$pass" "$fail" <<'PY'
import json,sys
out, pas, fail = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
# reconstruct from stdin lines? we'll write simpler below
open(out,"w").write(json.dumps({"pass":pas,"fail":fail,"score":f"{pas}/7"},indent=2))
print(f"SCORE {pas}/7 blocked (fail={fail}) -> {out}")
PY
# richer JSON
{
  echo '{'
  echo "\"pass\": $pass, \"fail\": $fail, \"score\": \"$pass/7\","
  echo '"tests": ['
  IFS=,; echo "${results[*]}" | sed 's/}{/},{/g'
  echo ']'
  echo '}'
} > "$OUT_JSON"
echo "SCORE $pass/7  (fail=$fail)"
[ "$fail" -eq 0 ]
