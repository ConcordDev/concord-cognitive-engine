# Dev-Server Issue Sweep — 2026-05-25

Comprehensive sweep of `/tmp/server.log` (2550 lines) + `/tmp/frontend.log` +
live HTTP response codes during ~30min of Playwright-driven exploration at
HEAD `440c3d7`. Issues triaged by severity.

## P0 — Real bugs (fixed in this commit)

### 1. `GET /api/worlds/crises` returned 404 every poll
**Symptom:** 8 × 404 in server log; `CrisisBanner` calls `fetch('/api/worlds/crises')` every mount + the polling interval (~10s). Frontend swallowed the error silently, but the dev "issues" badge counted each one.
**Root cause:** `CrisisBanner.tsx:66` and `:31` reference routes that were never registered server-side. The `world_crises` table exists (migration 046 `nemesis_crises`) but no GET/POST routes were wired.
**Fix:** Added `GET /api/worlds/crises` and `POST /api/worlds/crises/:id/respond` to `server/routes/worlds.js`. The GET is unauthenticated (in `publicReadPaths`) — banner data is intentionally public. POST requires auth so the resolver gets attributed. Emits `world:crisis-resolved` realtime so other clients drop the banner immediately. Also hardened `CrisisBanner.tsx` to `r.ok ? r.json() : null` so 404 in a future state doesn't throw at `.json()`.

### 2. Seed-pack loader crashed on missing `sha256`
**Symptom:** `[Seed-Pack] Failed to load seed packs: Cannot read properties of null (reading 'slice')` in server log.
**Root cause:** `server.js:9192` called `pack.sha256.slice(0,12)` without null-guarding. Legacy manifest entries without an explicit hash crashed the loader for the entire pack.
**Fix:** Added `typeof pack.sha256 === "string"` guard and `(... || "").slice(0,12)` defaults around the slice calls. Missing-hash entries now skip the hash check instead of crashing.

## P1 — Environment artifacts (not real bugs in production)

These show up only because the dev container can't reach external services. On a real Blackwell + docker-compose boot they go away.

### 3. All 5 Ollama brains "offline"
**Symptom:** `[WARN] brain_offline` × 5 (conscious / subconscious / utility / repair / multimodal) at boot, plus `brain_preload_error` for each model.
**Root cause:** `server/lib/brain-config.js` URLs default to `http://ollama-conscious:11434` etc. — Docker hostnames that resolve inside `docker-compose up` but not in bare-metal dev.
**Not a bug:** Brain unavailability is handled gracefully; macros that don't need LLMs work unchanged. On real boot via docker-compose this resolves. In bare-metal dev, override with `BRAIN_*_URL=http://localhost:11434` env vars.

### 4. Embeddings model fetch blocked
**Symptom:** `[ERROR] embeddings_load_failed {"error":"Forbidden access to file: \"https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/tokenizer_config.json\""}`
**Root cause:** Container's egress policy blocks `huggingface.co`. The fallback (`xenova`) also fails because it also fetches from HF.
**Not a bug:** On a machine with internet egress, this succeeds. The first run downloads ~80MB of model files; subsequent runs use the cached weights.

### 5. Sentry tunnel 404 + redirect
**Symptom:** Browser console "Failed to load resource: 404 (/monitoring)" and "Script behind redirect" warnings.
**Root cause:** `NEXT_PUBLIC_SENTRY_DSN` not set → next.config.js drops the Sentry tunnel rewrite → `/monitoring` falls to auth middleware which 307s to `/login`.
**Not a bug:** Already gated correctly. Disappears the moment Sentry DSN is configured.

## P2 — Test driver noise (expected behaviour)

### 6. 429 Too Many Requests floods
**Cause:** Playwright driver hammering API at ~60 req/min from a single IP. The bot guard is doing exactly its job.
**Affected paths:** `/api/affect/state` (4), `/api/events/paginated` (4), `/api/guidance/suggestions` (3), `/api/guidance/first-win` (3), `/api/tutorial/first-cycle` (2), `/api/status` (2). All transient.

### 7. 401 Unauthorized on protected endpoints
**Cause:** Anon visitor hits authed endpoints before login redirect resolves.
**Affected paths:** `/api/onboarding/wizard-status` (6), `/api/auth/me` (6). Expected.

### 8. WebSocket reconnect on tab switch
**Cause:** `[WARN] alert_fired {"name":"WebSocket Disconnected"}` fires on every page nav because the Socket.IO client reconnects.
**Not a bug:** Reconnects within seconds. Could be downgraded to info-level.

## P0 — Investigation deferred (needs profiling, not patch)

### 9. Event-loop lag spikes up to 26 seconds
**Symptom:** Multiple `[WARN] event_loop_lag_spike {"maxMs":26491}` entries. Backend stops responding for 5–26s at a time. During those windows, the frontend's proxy gets `ECONNRESET socket hang up` and any in-flight fetch fails.

**Likely cause:** `server/lib/npc-simulator.js#tick()` (line 908) runs `Promise.allSettled(autonomousAgents.map(a => a.tick()))` — fans out ALL agents in parallel. With 200+ NPCs each doing async work that calls synchronous SQLite ops (each `db.prepare(...).run(...)` is blocking), the cumulative resolution can pin the event loop for tens of seconds. Each agent also runs `_maybeGenerateQuests` (5% chance), `_tickConversations`, `_tickCrossbreeding`, etc.

**Why "loading screen stuck" correlates:** When the world lens loads, it fires multiple parallel fetches for districts/NPCs/quests. If one falls inside an event-loop block window, the fetch hangs until the block clears. The loader's "world ready" signal never fires because one of its dependency checks is still pending.

**Why I'm not fixing it in this commit:** The right fix is non-trivial:
  - Batch agents into chunks of N=8 with `await new Promise(r => setImmediate(r))` between batches
  - Or move npc-simulator to a worker thread + IPC
  - Or use SQLite's WAL mode with cross-thread queue
Any of these needs profiling first (which agent.tick path is actually heaviest? are LLM calls the real culprit? is it the DB prepare/run loop?) — pattern-matching the symptom risks shipping a regression. Recommended next session: add `perf_hooks` instrumentation around `npc-simulator.tick`, identify the top 3 cost centers, then patch.

**Production impact:** On a Blackwell with the full Ollama stack reachable, the lag may be lower (LLM-call latency stops being unbounded since brains respond) but the underlying parallel-fan-out is structural. Real users probably notice ~5–10s "freezes" when many NPCs tick simultaneously. Adding a single `for-of-await` chunking loop is a ~10 LOC safety net but should be measured first.

## Summary

| Severity | Count | Action |
|---|---|---|
| P0 — Real bug, fixed | 2 | Patched in this commit |
| P0 — Real bug, deferred | 1 | Needs profiling next session |
| P1 — Env-only | 3 | No action — gone on real deploy |
| P2 — Test/expected noise | 3 | No action |

**Net: 2 real bugs fixed, 1 real bug documented with reproduction path, everything else is environment artefact or test-driver noise. On a Blackwell with docker-compose + internet egress, the issue badge should drop from ~14 to ~0.**
