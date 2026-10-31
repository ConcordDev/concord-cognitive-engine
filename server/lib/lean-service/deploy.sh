#!/usr/bin/env bash
# Copy the Lean check service to the pod and (re)start it. Run from the repo root on a machine that can SSH to the pod.
#   POD=root@194.68.245.147 PORT=22004 ./server/lib/lean-service/deploy.sh [--systemd]
# It does not touch tunnels or launchd. After it runs, the tunnel 127.0.0.1:11437 -> pod:11437 is added by the deploy lane.
set -euo pipefail
POD=${POD:-root@194.68.245.147}; PORT=${PORT:-22004}
SRC="$(cd "$(dirname "$0")" && pwd)"; DEST=/root/lean/lean-check-service
ssh -p "$PORT" "$POD" "mkdir -p $DEST"
scp -P "$PORT" "$SRC/service.mjs" "$SRC/policy.js" "$SRC/run.sh" "$SRC/lean-check.service" "$POD:$DEST/"
if [ "${1:-}" = "--systemd" ]; then
  ssh -p "$PORT" "$POD" "cp $DEST/lean-check.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now lean-check && systemctl restart lean-check"
else
  ssh -p "$PORT" "$POD" "chmod +x $DEST/run.sh && (test -f /root/lean/lean-check.pid && kill \$(cat /root/lean/lean-check.pid) 2>/dev/null || true) && rm -f /root/lean/lean-check.pid && $DEST/run.sh"
fi
ssh -p "$PORT" "$POD" "sleep 1; curl -s http://127.0.0.1:11437/health"; echo
