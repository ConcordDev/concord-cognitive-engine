#!/bin/zsh
# usage: deploy-be.sh <label> <prev-sha> "<PRs>"  — called by locked-deploy.sh after the ff pull.
# Installed copy: ~/.zuko/usability-tmp/deploy/deploy-be.sh (source of truth: this file).
#
# 1. bootout the primary (com.concord.backend, :5050) and wait for ITS pid to exit
#    (the old pgrep on the server.js path also matched the replica, so the wait
#    always ran the full 60 s and never meant "primary gone").
# 2. bootout the read replica (com.concord.backend-i1, :5051) so nothing has the
#    DB open while it is APFS-cloned — the backup is a consistent snapshot.
# 3. clone the DB, write SUMMARY.md.
# 4. bootstrap the primary, wait for /health 200, then bootstrap the replica
#    (after, so two cold boots don't compete for memory) and wait for :5051.
# 5. verify-live.sh.
# DRY_RUN=1 prints the launchctl/cp commands instead of running them.
set -u
LABEL=$1; PREV=$2; PRS=$3
DRY_RUN=${DRY_RUN:-0}
LIVE=${LIVE_DIR:-"/Users/dutch/concord vs code/concord-cognitive-engine"}
cd "$LIVE" || exit 1
NEW=$(git rev-parse HEAD)
UIDN=$(id -u)
PRIMARY=com.concord.backend; REPLICA=com.concord.backend-i1
PRIMARY_PLIST=~/Library/LaunchAgents/$PRIMARY.plist; REPLICA_PLIST=~/Library/LaunchAgents/$REPLICA.plist
run() { if [ "$DRY_RUN" = 1 ]; then echo "DRY_RUN would: $*"; else "$@"; fi; }
svc_pid() { launchctl print gui/$UIDN/$1 2>/dev/null | awk '/^\tpid = /{print $3; exit}'; }
# Wait until pid $1 has exited (max $2 s). Prints the result.
wait_gone() {
  local pid=$1 max=$2 name=$3 i
  if [ -z "$pid" ] || [ "$DRY_RUN" = 1 ]; then echo "$name gone $(date +%T) (pid=${pid:-none})"; return 0; fi
  for i in $(seq 1 $max); do kill -0 $pid 2>/dev/null || { echo "$name gone $(date +%T) pid=$pid after ${i}s"; return 0; }; sleep 1; done
  echo "WARN $name pid=$pid still alive after ${max}s"; return 1
}
wait_health() {
  local port=$1 max=$2 c=000 i
  [ "$DRY_RUN" = 1 ] && { echo "DRY_RUN would wait for :$port/health"; return 0; }
  for i in $(seq 1 $max); do c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://localhost:$port/health); [ "$c" = 200 ] && break; sleep 2; done
  echo ":$port health=$c $(date +%T)"; [ "$c" = 200 ]
}
TS=$(date +%Y%m%d-%H%M); DIR=~/concord/backups/$TS-deploy-$LABEL
[ "$DRY_RUN" = 1 ] && DIR=/tmp/dryrun-$TS-deploy-$LABEL
mkdir -p $DIR/db

PPID_=$(svc_pid $PRIMARY); RPID=$(svc_pid $REPLICA)
echo "bootout primary $(date +%T) pid=${PPID_:-none}"; run launchctl bootout gui/$UIDN/$PRIMARY 2>/dev/null
wait_gone "$PPID_" 90 primary || { echo "ABORT primary did not exit; not cloning a DB that is still open for writes. Bring it back: launchctl bootstrap gui/$UIDN $PRIMARY_PLIST"; exit 6; }
REPLICA_WAS_UP=0
if [ -n "$RPID" ]; then
  REPLICA_WAS_UP=1
  echo "bootout replica $(date +%T) pid=$RPID"; run launchctl bootout gui/$UIDN/$REPLICA 2>/dev/null
  wait_gone "$RPID" 60 replica || echo "WARN replica still up during clone (read-only, continuing)"
fi
# From here on the replica must come back even if the clone or primary fails.
restart_replica() {
  [ "$REPLICA_WAS_UP" = 1 ] || return 0
  if [ "$DRY_RUN" = 1 ]; then [ -n "${_DRY_REPLICA_DONE:-}" ] || { _DRY_REPLICA_DONE=1; echo "bootstrap replica $(date +%T)"; run launchctl bootstrap gui/$UIDN $REPLICA_PLIST; }; return 0; fi
  if [ -z "$(svc_pid $REPLICA)" ]; then
    echo "bootstrap replica $(date +%T)"; run launchctl bootstrap gui/$UIDN $REPLICA_PLIST
    wait_health 5051 60 || echo "WARN replica :5051 not healthy yet (check backend-i1.log)"
  fi
}
trap restart_replica EXIT
if [ "$DRY_RUN" = 1 ]; then echo "DRY_RUN would: cp -c server/data/concord.db* $DIR/db/"
else cp -c server/data/concord.db* $DIR/db/ && echo "db clone ok" || echo "WARN db clone FAILED"; fi
echo "# Deploy $LABEL — $TS ET — backend $PREV -> $NEW; PRs: $PRS
DB cloned with primary AND replica stopped.
Rollback backend: zsh: cd \"$LIVE\" && git reset --keep $PREV && launchctl bootout gui/$UIDN/$PRIMARY; wait for its pid to exit; launchctl bootstrap gui/$UIDN $PRIMARY_PLIST && launchctl kickstart -k gui/$UIDN/$REPLICA
DB: cp -c db/concord.db* server/data/ while BOTH are stopped, only if needed (code-only change; DB not touched)." > $DIR/SUMMARY.md
LOGOFF=$(stat -f %z ~/concord/logs/backend.log 2>/dev/null || echo 0)
echo "bootstrap primary $(date +%T)"; run launchctl bootstrap gui/$UIDN $PRIMARY_PLIST
wait_health 5050 90
echo "DIR=$DIR"
restart_replica
if [ "$DRY_RUN" = 1 ]; then echo "DRY_RUN would: verify-live.sh $LOGOFF"; exit 0; fi
# HTTP 200 is not "users can use it" — verify chat, brains, saves, embeddings.
~/.zuko/usability-tmp/deploy/verify-live.sh "$LOGOFF" | tee -a $DIR/SUMMARY.md
VRC=${pipestatus[1]}
if [ "$VRC" != 0 ]; then
  echo "DEPLOY_VERIFY_FAILED — prod is up but not healthy. Rollback: see $DIR/SUMMARY.md"
  exit 4
fi
