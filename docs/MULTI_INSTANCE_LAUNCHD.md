# Multi-instance launchd scaffold (no pm2 cluster)

**Status (2026-09-09):** scaffold + heartbeat guard landed. **Dutch override:**
dual-HTTP activating carefully on the 16 GB Mac with `--max-old-space-size=3072`
per process (not 8192). Auto-rollback to single instance if OOM/swap death.
A40 still preferred for headroom; Mac is honesty-constrained.

## Why

One Node event loop is the measured ceiling. Dual HTTP workers raise that
ceiling **if and only if** exactly one process runs the emergent tick. pm2
cluster is intentionally **not** used here (F0: no `pm2 stop`/`delete`; Mac
self-host is launchd).

## Guard (code)

`server/server.js`:

| Env | Effect |
|---|---|
| `NODE_APP_INSTANCE` unset or `0` | `IS_HEARTBEAT_NODE=true` — may run `startHeartbeat` + governor |
| `NODE_APP_INSTANCE=1` (or any non-`0`) | skips tick (`heartbeat_skipped_non_primary_instance`) |
| `CONCORD_DISABLE_HEARTBEAT=true` | always skip (HTTP-only / paired with heartbeat-only process) |
| `CONCORD_HEARTBEAT_ONLY=1` | run tick, bind **no** HTTP port |

Default (no vars) remains single-process, byte-identical to before.

Pinned by `server/tests/concurrency-process-modes.test.js`.

## Two shapes

### A) Dual HTTP (preferred next step when RAM allows)

1. Primary: `infra/launchd/com.concord.backend.plist.example` → `PORT=5050`,
   `NODE_APP_INSTANCE=0`, `CONCORD_DTU_SIDECAR=1`.
2. Worker: `infra/launchd/com.concord.backend-i1.plist.example` → `PORT=5051`,
   `NODE_APP_INSTANCE=1`, `CONCORD_DTU_SIDECAR=1`.
3. Point nginx / Cloudflare tunnel upstream at both ports (sticky sessions for
   socket.io when Redis adapter is live — see `docs/REDIS_STICKY_SESSIONS.md` +
   `infra/nginx/sticky-sessions.conf.example`).

### B) HTTP + heartbeat-only (Tier 1 D)

1. Every HTTP worker: `CONCORD_DISABLE_HEARTBEAT=true` + `CONCORD_DTU_SIDECAR=1`.
2. Sim: `infra/launchd/com.concord.heartbeat.plist.example` (`CONCORD_HEARTBEAT_ONLY=1`).
3. See `docs/CONCURRENCY_CEILING_AUDIT.md` §7.

Never run B's heartbeat plist **and** leave instance 0 with heartbeat enabled —
that double-runs the sim.

## Activation checklist (A40 preferred; Mac OK with 3072 heaps + rollback)

1. Confirm free RAM (≥16 GB free after Ollama + sidecar) and disk headroom.
2. Copy example plists → `~/Library/LaunchAgents/`, replace `PLACEHOLDER_*`.
   Pull secrets from existing `.env` / current backend plist — **do not paste
   tokens into the repo**.
3. Ensure `com.concord.dtu-sidecar` is running (`CONCORD_DTU_SIDECAR=1` on HTTP).
4. `launchctl bootstrap` / `kickstart` primary first, confirm `/health` +
   `governor_heartbeat_boot {ok:true}` on i0.
5. Start i1; confirm log `heartbeat_skipped_non_primary_instance` and `/health`
   on `:5051`.
6. Flip nginx upstream; watch health p95 + `concord_heartbeat_ticks_total`
   (must stay non-zero on exactly one process).

## Rollback

Unload i1 (and/or heartbeat) plists; leave a single backend with neither
`NODE_APP_INSTANCE` nor `CONCORD_DISABLE_HEARTBEAT` set. Instant.

## Still open (not this scaffold)

- STATE write-through: Tier S `_SESSION_ACTIVITY` + `_macroRateLimits` Redis
  write-behind landed (`server/lib/concurrency/shared-state.js`). Chat
  `STATE.sessions` still sticky-required.
- Redis for socket.io adapter (needs working `redis`/`@redis/client` install).
- Read-replica + read-router (RAM-gated; `engines/concord-read-router/RUNBOOK.md`).
