#!/bin/bash
# Forward the pod's 127.0.0.1:7870 to this machine's 127.0.0.1:7870.
# Usage: tunnel.sh <host> <port>   (e.g. tunnel.sh 69.30.85.131 22025)
exec ssh -N -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -i ~/.ssh/id_ed25519 \
  -L 127.0.0.1:7870:127.0.0.1:7870 -p "${2:?port}" "root@${1:?host}"
