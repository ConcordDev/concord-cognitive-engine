#!/usr/bin/env bash
# scripts/self-host-dry-run.sh — R7 self-host proof (OP3)
#
# Headless, CI-runnable version of the manual walkthrough in
# docs/SELF_HOST_VERIFICATION.md. Proves the full loop end-to-end against a
# THROWAWAY data directory (never touches a real DATA_DIR/DB_PATH):
#
#   fresh DB -> migrate -> boot -> smoke test -> write a marker record ->
#   backup -> SIMULATE TOTAL DATA LOSS (delete the live db files) ->
#   restore -> reboot -> smoke test again -> verify the marker survived.
#
# Every command below is the exact same command a human runs by hand in the
# doc — this script is not a separate, unverified path; it's that same path
# with assertions instead of eyeballing output. Exit 0 = every stage proved
# real. Exit 1 = it prints exactly which stage failed and why.
#
# Usage:
#   ./scripts/self-host-dry-run.sh              # full run, ~30-60s
#   ./scripts/self-host-dry-run.sh --keep        # don't delete the temp dir after (debugging)
#
# CI convention: matches the `census --ci` / `check-doc-claims-all.mjs --ci`
# shape already used elsewhere in this repo — a scripted proof of a "does
# self-hosting actually work" claim, not just a doc asserting it does.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/server"

KEEP=false
[ "${1:-}" = "--keep" ] && KEEP=true

if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; CYAN=''; NC=''
fi
info() { printf "${CYAN}[dry-run]${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[dry-run OK]${NC} %s\n" "$*"; }
fail() { printf "${RED}[dry-run FAIL]${NC} %s\n" "$*"; exit 1; }

# --- Throwaway workspace ---------------------------------------------------
TMPROOT="$(mktemp -d -t concord-selfhost-dryrun-XXXXXX)"
DATA_DIR="$TMPROOT/data"
mkdir -p "$DATA_DIR"
info "throwaway data dir: $DATA_DIR"

cleanup() {
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    info "stopping server (pid $SERVER_PID)"
    kill "$SERVER_PID" 2>/dev/null || true
    sleep 1
    kill -9 "$SERVER_PID" 2>/dev/null || true
  fi
  if [ "$KEEP" = false ]; then
    rm -rf "$TMPROOT"
  else
    info "kept workspace at $TMPROOT (--keep)"
  fi
}
trap cleanup EXIT

# --- Pick a free port (avoid colliding with anything real on 5050) --------
PORT="$(node -e "
  const net = require('net');
  const srv = net.createServer();
  srv.listen(0, '127.0.0.1', () => { console.log(srv.address().port); srv.close(); });
")"
info "using ephemeral port $PORT"

# --- Generate throwaway secrets (same idiom setup.sh uses for real ones) --
JWT_SECRET_VAL="$(openssl rand -hex 32)"
SESSION_SECRET_VAL="$(openssl rand -hex 32)"
ADMIN_PASSWORD_VAL="dryrun-$(openssl rand -hex 12)"

DB_PATH="$DATA_DIR/concord.db"

# --- Stage 1: migrate a FRESH db -------------------------------------------
info "stage 1/7 — migrations against a fresh empty DB"
( cd "$SERVER_DIR" && DB_PATH="$DB_PATH" DATA_DIR="$DATA_DIR" node migrate.js ) \
  > "$TMPROOT/migrate.log" 2>&1 \
  || fail "migrations did not apply cleanly — see $TMPROOT/migrate.log"
grep -q "migration(s) applied" "$TMPROOT/migrate.log" \
  || fail "migrate.js ran but didn't report success — see $TMPROOT/migrate.log"
ok "migrations applied"

# --- Stage 2: boot the server -----------------------------------------------
info "stage 2/7 — booting server on 127.0.0.1:$PORT"
(
  cd "$SERVER_DIR"
  PORT="$PORT" \
  DB_PATH="$DB_PATH" \
  DATA_DIR="$DATA_DIR" \
  CONCORD_NO_LISTEN=false \
  NODE_ENV=development \
  JWT_SECRET="$JWT_SECRET_VAL" \
  SESSION_SECRET="$SESSION_SECRET_VAL" \
  ADMIN_PASSWORD="$ADMIN_PASSWORD_VAL" \
  FRONTEND_URL="http://localhost:3000" \
  AUTH_MODE=public \
  LOG_LEVEL=warn \
  exec node server.js
) > "$TMPROOT/server-boot-1.log" 2>&1 &
SERVER_PID=$!

READY=false
for _ in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/ready" > /dev/null 2>&1; then READY=true; break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || fail "server process died during boot — see $TMPROOT/server-boot-1.log"
  sleep 1
done
[ "$READY" = true ] || fail "server never reported /ready within 30s — see $TMPROOT/server-boot-1.log"
ok "server booted and reported /ready"

# --- Stage 3: smoke test ----------------------------------------------------
info "stage 3/7 — smoke test (npm run smoke equivalent)"
bash "$SERVER_DIR/scripts/smoke.sh" "http://localhost:$PORT" > "$TMPROOT/smoke-1.log" 2>&1 \
  || fail "pre-backup smoke test failed — see $TMPROOT/smoke-1.log"
grep -qE "^Results: .* 0 failed" "$TMPROOT/smoke-1.log" \
  || fail "smoke test did not report a clean pass — see $TMPROOT/smoke-1.log"
ok "$(grep -E '^Results:' "$TMPROOT/smoke-1.log")"

# --- Stage 4: write an identifiable marker, then back up -------------------
info "stage 4/7 — write a marker record, then back up"
UA="Concord-Smoke/1.0"
MARKER_TITLE="dry-run-marker-$(date +%s)"
MARKER_RESP="$(curl -s -A "$UA" -X POST "http://localhost:$PORT/api/dtus/durable" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"$MARKER_TITLE\",\"body\":{\"content\":\"backup-restore integrity marker\"},\"tags\":[\"dry-run\"],\"visibility\":\"public\"}")"
MARKER_ID="$(node -e "try{const d=JSON.parse(process.argv[1]); console.log(d.dtu && d.dtu.id || d.id || '')}catch{console.log('')}" "$MARKER_RESP")"
[ -n "$MARKER_ID" ] || fail "could not create marker DTU — response: $MARKER_RESP"
ok "marker DTU created: $MARKER_ID ($MARKER_TITLE)"

# Settle window: on a server's FIRST-EVER boot against a brand-new DB, /ready
# can report true a couple seconds before content-seeder's async grounding-
# pack pass finishes committing (verified live: two consecutive boots of the
# identical DB with no backup/restore in between still show the count settle
# +2 between boot 1 and boot 2, then hold steady on boot 3 — this is a
# general first-boot-settling behavior, not a backup/restore defect). Give
# it a moment before treating the count as a stable baseline.
sleep 3

DTU_COUNT_BEFORE="$(node -e "
  const Database = require('$SERVER_DIR/node_modules/better-sqlite3');
  const db = new Database('$DB_PATH', { readonly: true });
  console.log(db.prepare('SELECT COUNT(*) c FROM dtus').get().c);
  db.close();
")"

DATA_DIR="$DATA_DIR" DB_PATH="$DB_PATH" bash "$PROJECT_ROOT/scripts/db-backup.sh" "$DATA_DIR/backups" > "$TMPROOT/backup.log" 2>&1 \
  || fail "db-backup.sh failed — see $TMPROOT/backup.log"
BACKUP_FILE="$(ls -t "$DATA_DIR/backups"/concord-backup-*.tar.gz 2>/dev/null | head -1)"
[ -n "$BACKUP_FILE" ] || fail "db-backup.sh reported success but no tarball found"
ok "backup written: $(basename "$BACKUP_FILE")"

# --- Stage 5: simulate total data loss --------------------------------------
info "stage 5/7 — simulating total data loss (stop server, delete live db files)"
kill "$SERVER_PID" 2>/dev/null || true
sleep 1
kill -0 "$SERVER_PID" 2>/dev/null && { kill -9 "$SERVER_PID" 2>/dev/null || true; sleep 1; }
unset SERVER_PID
rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"
[ -f "$DB_PATH" ] && fail "simulated data loss didn't actually remove the db file"
ok "live db files deleted — data loss simulated"

# --- Stage 6: restore --------------------------------------------------------
info "stage 6/7 — restoring from backup"
DATA_DIR="$DATA_DIR" bash "$PROJECT_ROOT/scripts/db-restore.sh" "$BACKUP_FILE" > "$TMPROOT/restore.log" 2>&1 \
  || fail "db-restore.sh failed — see $TMPROOT/restore.log"
grep -q "SUCCESS: Database restored" "$TMPROOT/restore.log" \
  || fail "db-restore.sh ran but didn't report success — see $TMPROOT/restore.log"
[ -f "$DB_PATH" ] || fail "restore reported success but $DB_PATH is still missing"
ok "restore reported success"

# --- Stage 7: reboot + verify integrity -------------------------------------
info "stage 7/7 — reboot against the restored DB and verify"
(
  cd "$SERVER_DIR"
  PORT="$PORT" \
  DB_PATH="$DB_PATH" \
  DATA_DIR="$DATA_DIR" \
  CONCORD_NO_LISTEN=false \
  NODE_ENV=development \
  JWT_SECRET="$JWT_SECRET_VAL" \
  SESSION_SECRET="$SESSION_SECRET_VAL" \
  ADMIN_PASSWORD="$ADMIN_PASSWORD_VAL" \
  FRONTEND_URL="http://localhost:3000" \
  AUTH_MODE=public \
  LOG_LEVEL=warn \
  exec node server.js
) > "$TMPROOT/server-boot-2.log" 2>&1 &
SERVER_PID=$!

READY=false
for _ in $(seq 1 30); do
  if curl -sf "http://localhost:$PORT/ready" > /dev/null 2>&1; then READY=true; break; fi
  kill -0 "$SERVER_PID" 2>/dev/null || fail "server process died rebooting post-restore — see $TMPROOT/server-boot-2.log"
  sleep 1
done
[ "$READY" = true ] || fail "post-restore server never reported /ready within 30s — see $TMPROOT/server-boot-2.log"
ok "post-restore server booted and reported /ready"

# IMPORTANT: check row-count/marker integrity BEFORE running smoke again —
# smoke.sh itself writes new rows (it's exercising the write paths), so
# running it first would make "count unchanged" fail for the wrong reason
# (new legitimate writes, not data loss). Integrity first, liveness second.
DTU_COUNT_AFTER="$(node -e "
  const Database = require('$SERVER_DIR/node_modules/better-sqlite3');
  const db = new Database('$DB_PATH', { readonly: true });
  console.log(db.prepare('SELECT COUNT(*) c FROM dtus').get().c);
  db.close();
")"

# The real backup/restore invariant is "no data loss" (count did not drop
# and the marker row survived) — not "byte-identical row count." A restored
# server's own boot-time seeding can still legitimately add rows the same
# way any reboot can (see the settle-window comment above); that is
# forward progress, not corruption. A DECREASE, by contrast, is exactly
# what a real data-loss bug would look like.
[ "$DTU_COUNT_AFTER" -ge "$DTU_COUNT_BEFORE" ] \
  || fail "DTU row count DROPPED across backup/restore: before=$DTU_COUNT_BEFORE after=$DTU_COUNT_AFTER — real data loss"

MARKER_SURVIVED="$(node -e "
  const Database = require('$SERVER_DIR/node_modules/better-sqlite3');
  const db = new Database('$DB_PATH', { readonly: true });
  const row = db.prepare('SELECT id FROM dtus WHERE id = ?').get('$MARKER_ID');
  db.close();
  console.log(row ? 'yes' : 'no');
")"
[ "$MARKER_SURVIVED" = "yes" ] || fail "marker DTU $MARKER_ID did not survive the backup/restore cycle"
ok "marker DTU survived restore; row count did not drop ($DTU_COUNT_BEFORE -> $DTU_COUNT_AFTER)"

# Liveness check LAST, after integrity is already proven — a fresh write
# here is expected and fine, it's just no longer part of the count check.
bash "$SERVER_DIR/scripts/smoke.sh" "http://localhost:$PORT" > "$TMPROOT/smoke-2.log" 2>&1 \
  || fail "post-restore smoke test failed — see $TMPROOT/smoke-2.log"
grep -qE "^Results: .* 0 failed" "$TMPROOT/smoke-2.log" \
  || fail "post-restore smoke test did not report a clean pass — see $TMPROOT/smoke-2.log"
ok "post-restore $(grep -E '^Results:' "$TMPROOT/smoke-2.log")"

echo ""
ok "ALL 7 STAGES PASSED — self-host backup/restore path is real and verified."
exit 0
