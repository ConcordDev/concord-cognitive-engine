#!/bin/zsh
# usage: locked-deploy.sh <label> "<PRs>"
# Waits for run.lock, fast-forwards prod to origin/main, then runs deploy-be.sh
# (stop primary + replica, APFS-clone the DB, start both, verify-live).
#
# Installed copy: ~/concord-wt/locked-deploy.sh (source of truth: this file).
# run.lock is ALWAYS released on exit (success, failure, Ctrl-C) by the EXIT
# trap, and only if this run still owns it.
#
# Env overrides (for dry runs / tests):
#   DRY_RUN=1      print launchctl/cp/git-merge instead of running them
#   LOCK_FILE=...  lock path (default ~/.zuko/quality/run.lock)
#   LIVE_DIR=...   prod tree (default the live concord-cognitive-engine)
#   DEPLOY_BE=...  backend deploy script (default ~/.zuko/usability-tmp/deploy/deploy-be.sh)
LABEL=${1:?label required}; PRS=${2:-}
L=${LOCK_FILE:-$HOME/.zuko/quality/run.lock}
R=${LIVE_DIR:-"/Users/dutch/concord vs code/concord-cognitive-engine"}
DEPLOY_BE=${DEPLOY_BE:-$HOME/.zuko/usability-tmp/deploy/deploy-be.sh}
DRY_RUN=${DRY_RUN:-0}
TOKEN="deploy-$LABEL-$$-$(date +%s)"
OWN=0
release_lock() {
  if [ "$OWN" = 1 ] && grep -q "token=$TOKEN" "$L" 2>/dev/null; then
    rm -f "$L" && echo "run.lock released $(date +%T)"
  fi
}
trap release_lock EXIT
trap 'echo "interrupted"; exit 130' INT TERM HUP

while true; do
  if ( set -C; echo "owner=$LABEL token=$TOKEN start=$(date '+%FT%T%z') phase=deploy-backend PRs=$PRS dry=$DRY_RUN" > "$L" ) 2>/dev/null; then OWN=1; break; fi
  echo "waiting $(date +%T) lock=$(cat "$L" 2>/dev/null)"; sleep 20
done
cd "$R" || exit 1
AVAIL=$(df -g ~ | tail -1 | awk '{print $4}'); echo "disk free ${AVAIL}G"
if [ "$AVAIL" -lt 8 ]; then echo "ABORT low disk (<8G)"; exit 2; fi
# Refuse to deploy over uncommitted code. Runtime-regenerated audit/
# artifacts are the only allowed dirt.
DIRTY=$(git status --porcelain --untracked-files=all | grep -v -E '^.. audit/' )
if [ -n "$DIRTY" ]; then
  echo "ABORT live tree has uncommitted changes (commit/PR them or stash them first):"
  echo "$DIRTY" | head -40; [ $(echo "$DIRTY" | wc -l) -gt 40 ] && echo "  ... $(echo "$DIRTY" | wc -l | tr -d ' ') total"
  exit 5
fi
PREV=$(git rev-parse HEAD); echo "PREV=$PREV"
if [ "$DRY_RUN" = 1 ]; then
  git fetch -q origin; echo "DRY_RUN would: git merge --ff-only origin/main ($(git rev-parse --short origin/main))"
else
  git fetch -q origin && git merge --ff-only origin/main || { echo "ABORT ff failed"; exit 3; }
fi
echo "NEW=$(git rev-parse HEAD)"
DRY_RUN=$DRY_RUN "$DEPLOY_BE" "$LABEL" "$PREV" "$PRS"
RC=$?
if [ "$RC" != 0 ]; then echo "DEPLOY_FAILED rc=$RC $(date '+%F %T %Z')"; exit $RC; fi
echo "DEPLOY_DONE $(date '+%F %T %Z')"
