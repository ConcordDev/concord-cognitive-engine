# Incident Response Guide

Quick reference for the most common failure modes. Detailed runbooks for each scenario live in `docs/operations/runbooks/`.

---

## Severity Definitions

| Severity | Definition |
|---|---|
| P1 | Service completely unavailable to all users |
| P2 | Core feature degraded or unavailable to a subset of users |
| P3 | Non-critical feature degraded; workaround exists |

---

## Runbook 1: Server Won't Start

**Symptoms:** `node server.js` exits immediately or fails to bind; health endpoint unreachable.

**Check order:**

1. **Migrations run?** Run `node migrate.js` — it is idempotent and safe to re-run. Missing schema causes an immediate crash.
2. **DATA_DIR writable?**
   ```bash
   ls -ld $DATA_DIR          # confirm directory exists
   touch $DATA_DIR/.write-test && rm $DATA_DIR/.write-test
   ```
3. **Port already in use?**
   ```bash
   lsof -i :5050             # identify the process holding the port
   ```
4. **Check logs:** Review `server.log` or container stdout for the stack trace — the error message is almost always definitive.

**Resolution:** Fix the identified cause, then restart `node server.js`.

---

## Runbook 2: Auth Failures (401 Everywhere)

**Symptoms:** All authenticated requests return 401; users cannot log in or API keys are rejected.

**Check order:**

1. **JWT_SECRET set?**
   ```bash
   echo $JWT_SECRET           # must be non-empty and ≥32 chars
   ```
   If the secret changed between restarts, all existing tokens are invalidated — users must log in again.

2. **Token expiry?** Default token lifetime is 7 days. Check the `iat`/`exp` fields in the JWT payload (base64-decode the middle segment).

3. **Admin password mismatch?** If `ADMIN_PASSWORD` changed after the admin account was created, the stored hash no longer matches.
   - Reset admin: `node scripts/reset-admin.js`

**Resolution:**
- Restart the server with the correct `JWT_SECRET`.
- If the admin account is locked out, run `node scripts/reset-admin.js` and re-set `ADMIN_PASSWORD`.

---

## Runbook 3: Brain/AI Features Returning Errors

**Symptoms:** Endpoints that call the reasoning models return 5xx or structured error objects; other endpoints work normally.

**Severity:** P3 — the server degrades gracefully and returns a structured error rather than crashing. This is not a critical outage.

**Check order:**

1. **Ollama running?**
   ```bash
   curl http://localhost:11434/api/tags
   ```
   If this fails, start Ollama: `ollama serve`

2. **Required model pulled?**
   ```bash
   ollama list                         # check available models
   ollama pull llama3                  # pull if missing
   ```

3. **BRAIN_*_URL env vars correct?**
   ```bash
   echo $BRAIN_CONSCIOUS_URL     # port 11434
   echo $BRAIN_SUBCONSCIOUS_URL  # port 11435
   echo $BRAIN_UTILITY_URL       # port 11436
   echo $BRAIN_REPAIR_URL        # port 11437
   echo $BRAIN_VISION_URL        # port 11438 (LLaVA vision)
   ```
   Each should point to a reachable Ollama instance. Unset variables fall back to `$OLLAMA_HOST`. Concord runs five Ollama brains (four cognitive + one vision).

**Resolution:** Start/fix Ollama, pull the required model, correct env vars, and restart the server.

---

## Runbook 4: High Memory Usage

**Symptoms:** Server process RSS grows over time; OOM kills or slow responses.

**Check order:**

1. **DTU map size:**
   ```bash
   curl http://localhost:5050/health | jq '.dtuCount'
   ```
   A very large `dtuCount` indicates the in-memory `STATE.dtus` Map has grown unbounded.

2. **Feed-manager polling interval:** Default is 300 seconds. If it was accidentally lowered, feeds accumulate state faster. Check server config or environment.

3. **WebSocket connection count:** Leaked sockets (clients that disconnected without cleanup) hold references. Check the health endpoint or server metrics for `wsConnections`.

**Resolution:** Restarting the server is safe — SQLite is the source of truth and all in-memory state is rebuilt from disk on startup. Schedule a restart during a low-traffic window.

---

## Runbook 5: Database Locked or Corrupt

**Symptoms:** SQLite errors in logs (`SQLITE_BUSY`, `database is locked`, or `database disk image is malformed`).

**Check order:**

1. **Multiple processes sharing DATA_DIR?** Only one server process should open the database at a time. Check for stale lock files:
   ```bash
   ls -la $DATA_DIR/           # look for concord.db-shm, concord.db-wal
   fuser $DATA_DIR/concord.db  # identify all processes with the file open
   ```

2. **WAL mode enabled?** The database is initialized in WAL mode by `migrate.js`. If a manual `PRAGMA journal_mode=DELETE` was run, revert it:
   ```bash
   sqlite3 $DATA_DIR/concord.db "PRAGMA journal_mode=WAL;"
   ```

3. **Integrity check:**
   ```bash
   sqlite3 $DATA_DIR/concord.db "PRAGMA integrity_check;"
   ```
   Output of `ok` means the database is healthy. Any other output indicates corruption.

**Resolution:**

- **Locked:** Stop all server instances, remove stale WAL/SHM files if the owning process is gone, restart one server instance.
- **Corrupt:** Stop all instances, restore from the most recent backup, replay any WAL-captured changes if available, restart.
- If no backup exists, open an incident and escalate — data recovery from a corrupt SQLite file requires manual intervention.

---

## Escalation Contacts

Document your team's on-call rotation and escalation path here. The runbooks above are intended to resolve the majority of incidents without escalation.
