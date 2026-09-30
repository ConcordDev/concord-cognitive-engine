#!/bin/bash
# Generic Concord gate runner (repo copy). Args: gate-name, command, workdir
GATE="$1"
CMD="$2"
WORKDIR="${3:-$(cd "$(dirname "$0")/../.." && pwd)}"

cd "$WORKDIR" || { echo "FATAL: cannot cd to $WORKDIR"; exit 1; }

OUT=$(eval "$CMD" 2>&1)
EXIT=$?

if [ $EXIT -ne 0 ]; then
  HEAD=$(echo "$OUT" | head -40)
  MSG="concord-gate RED: $GATE

exit=$EXIT
cmd: $CMD

$HEAD"
  if command -v hermes >/dev/null 2>&1; then
    hermes send -t telegram "$MSG" >/dev/null 2>&1 || echo "$MSG" >> ~/.hermes/logs/concord-gate-failures.log
  else
    echo "$MSG" >&2
  fi
  exit $EXIT
fi

echo "concord-gate GREEN: $GATE"
exit 0
