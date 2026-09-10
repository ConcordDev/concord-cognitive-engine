# Concurrency ceiling — measured audit + ranked fix plan

**2026-09-08.** Companion to `docs/CONCURRENCY_STATE_AUDIT.md` (which maps the
STATE-coordination work a multi-process cluster needs). This doc answers the
prior question: **what is actually causing the ceiling, and what's the cheapest
thing that moves it?**

Everything below is measured from `macro_call_log` (198,618 real macro
invocations on the live DB) plus targeted code reads. No estimates.

---

## 1. The measurement that reframes the problem

`macro_call_log` happens to contain a natural experiment: this session's chaos
storms (~200-250 concurrent) ran on 2026-09-08, and every prior day is the
unloaded baseline. Same macros, same box, load as the only variable.

| macro | unloaded avg | **under load** | max under load | ×    |
|---|--:|--:|--:|--:|
| `dtu.list` | ~5 ms | **655 ms** | 11,729 ms | **130×** |
| `emergent.scope.globalTick` | 7.5 ms | 367 ms | 27,100 ms | 49× |
| `lens.list` | 1.5 ms | 52.7 ms | 5,449 ms | 35× |
| `dtu.create` (WRITE) | 4.0 ms | 80.6 ms | 18,652 ms | 20× |
| `emergent.repair.agent.tick` | 59.4 ms | 549.6 ms | 40,227 ms | 9× |
| `emergent.register` | 66.3 ms | 460 ms | 27,088 ms | 7× |
| `ingest.processQueueOnce` | 6.1 ms | 18.3 ms | 25,777 ms | 3× |
| **`accounting.trialBalance`** | — | **0.0 ms** | **1 ms** | **1×** |
| `goals.list` | — | 2.9 ms | **5,618 ms** | avg fine, tail dead |
| `dtu.stats` | — | 3.1 ms | **6,122 ms** | avg fine, tail dead |

**`accounting.trialBalance` ran 5,138 times under full load at avg 0.0 ms / max
1 ms.** A pure-compute macro was completely unaffected while everything around it
degraded 20–130×. `goals.list` and `dtu.stats` show avg 3 ms with 5–6 second
maxima — bimodal.

**The loop is not saturated with evenly-distributed work. It is being parked by a
few expensive operations, and everything else eats the stall.** That is
head-of-line blocking, not throughput exhaustion — and it changes the fix order
completely, because the cheap fixes target the parkers, not the process count.

---

## 2. The parkers, named

### 2a. `dtu.list` — an O(corpus) scan with a fresh array allocation, per call
```js
function dtusArray() { return Array.from(STATE.dtus.values()); }   // server.js:17614
function userVisibleDTUs(viewerId) { … return dtusArray().filter(d => { …12 predicates… }); }
```
`userVisibleDTUs()` is called from **15 sites**. There is **no cache and no
index**. With ~12k in-memory DTUs and 18,016 `dtu.list` calls today, that is
~216 million filter iterations plus 18,016 full-array copies of 12k elements —
all synchronous, all on the request loop. This single function is the dominant
parker.

(A versioned-cache idiom already exists in the same file —
`_cognitiveDtuEntriesCache` / `_cognitiveDtuEntriesCacheVersion` — so the
pattern to copy is in-tree.)

### 2b. Synchronous `better-sqlite3` writes on the request path
`dtu.create` 4 ms → 80.6 ms (max 18.6 s). Every `db.prepare().run()` blocks the
loop for its full duration. There is no async escape hatch — better-sqlite3 is
synchronous by design.

### 2c. Background work sharing the HTTP loop
`governorTick` dispatches **143 heartbeat modules sequentially** every 15 s on
the *same* event loop that serves HTTP. Plus the high-volume tick macros:
`ingest.processQueueOnce` (75,499 calls), `emergent.bridge.heartbeatTick`
(12,517), `emergent.repair.agent.tick`, `emergent.scope.globalTick`. None of
this is user-facing; all of it competes with user requests.

`CONCORD_DISABLE_HEARTBEAT` already exists (server.js:37118) but is partial —
the file's own comment records that `buildCognitiveSnapshot` "was NOT gated by
CONCORD_DISABLE_HEARTBEAT (that switch only short-circuits the unrelated
governor/registry heartbeat)" and therefore ran in *both* arms of a memory
bisect.

### 2d. NOT a parker: the LLM macros
`system.analogize` avg 17.8 s, `chat.respond` avg 175 s, `emergent.pipeline.run`
avg 8 s. These are `await fetch(ollama)` — they consume `_llmQueue` slots, **not
loop time.** They dominate the "total ms" column and are irrelevant to the
concurrency ceiling. Their fix is A40 capacity, not architecture. **Do not
conflate the two**; the totals table invites exactly that mistake.

---

## 3. The research constraint that bounds clustering

WAL mode solves **reader/writer** blocking. It does not solve **writer/writer**:
SQLite permits exactly one writer at a time, and adding processes adds
contention without adding write parallelism ([SkyPilot](https://blog.skypilot.co/abusing-sqlite-to-handle-concurrency/),
[OneUptime](https://oneuptime.com/blog/post/2026-09-08-fix-sqlite-database-is-locked-concurrent-writes/view),
[DOCSAID](https://docsaid.org/en/blog/sqlite-wal-busy-timeout-for-workers/)).
Recommended practice when multiple workers write regularly: admit writes through
a **single bounded queue**, or move to a client/server DB.

Practical consequence for Concord: **an N-process cluster scales reads ~N× and
writes 0×.** Concord's request mix is read-dominant today (`dtu.list`/`goals.list`/
`dtu.stats`/`lens.list` vs `dtu.create`), so clustering is still worth doing —
but it is a ceiling-raiser, not a ceiling-remover, and it will convert write
pressure into `SQLITE_BUSY` retries rather than throughput.

---

## 4. Ranked plan

### Tier 0 — **DONE 2026-09-08.** Measured, not projected.
| # | Fix | Status |
|---|---|---|
| **A** | Version-keyed cache on `userVisibleDTUs()` — keyed by `(viewerId)` against `STATE.dtus.getVersion()` (bumps on every write-through set/delete). | **shipped** — commit `9dd560cd4`, pinned by `tests/depth/dtu-visibility-cache-behavior.test.js` |
| **A2** | Same treatment for the bare `dtusArray()` (~40 other call sites — search/RAG/trending/stale-sweep each did their own `Array.from`). | **shipped** — commit `f7609cf4f` |
| **B** | DTU-sidecar lag-bypass (`cde86295b`): the inline path now hits the cache (~1 ms) so it's genuinely fast under lag — the bypass is *more* correct now, no change. | reviewed, no change |
| **C** | All `userVisibleDTUs()` / `dtusArray()` consumers audited for in-place array mutation — one `dtusArray().sort()` site copied; rest read-only. | done |

**Measured, live self-host, `chaos-storm.mjs @ 200 concurrent` (the level that
showed the 130× degradation):**

| macro | before Tier 0 (session storms) | **after Tier 0** |
|---|--:|--:|
| `dtu.list` | avg **655 ms**, max **11,729 ms** | **p50 28 ms · p95 55 ms · p99 396 ms** |
| `dtu.stats` | avg 3 ms, max **6,122 ms** | p50 28 ms · p99 547 ms |
| `goals.list` | avg 3 ms, max **5,618 ms** | p50 28 ms · p99 901 ms |
| `accounting.trialBalance` (pure-compute control) | avg 0 ms | p50 28 ms · p99 549 ms |

`dtu.list` no longer stands out — it degrades in lockstep with the pure-compute
control, i.e. it's just sharing the loop's general contention now, not *being*
the bottleneck. The bimodal 5-6-second p99 tails on `dtu.stats` / `goals.list`
(both call `userVisibleDTUs`) are gone.

**What's left at 200 concurrent:** uniform ~28 ms p50 / ~55 ms p95 with
occasional 400-900 ms p99 and one 10 s health spike (1×503). That residual is
general single-loop contention + the heartbeat still on the same loop — exactly
what Tier 1 D and Tier 2 address. Those are A40 deploy steps (§7, §8).

### Tier 1 — process separation, no STATE-coordination needed
| # | Fix | Status | Expected |
|---|---|---|---|
| **D** | **Run the heartbeat in its own process.** | **CODE DONE** (2026-09-08) — see §7 below | 143 modules of bulk work + the cognitive worker leave the HTTP loop entirely. Structurally the biggest win that is **not** clustering. |
| **E** | **Activate the read-replica + read-router** (already built, commit `56c6e4ec7`, `engines/concord-read-router/RUNBOOK.md`). Takes the allowlisted GET catalog off the writer. | built, not activated | free read parallelism; gated on RAM headroom → needs the A40, not the 16 GB Mac |

### Tier 2 — multi-day, the actual cluster (A40 deploy work)
`docs/CONCURRENCY_STATE_AUDIT.md`'s 7 steps:
1. **✅ `/api/credits/*`** — resolved 2026-09-08 (commit `12dc168b0`): `STATE.wallets`
   deleted, wallet/balance read the real ledger, earn/spend are honest no-ops.
2. **✅ `IS_HEARTBEAT_NODE` singleton guard** — subsumed by Tier 1 D: the sim runs
   on exactly one `CONCORD_HEARTBEAT_ONLY=1` process by construction.
3. nginx routing tiers (node-0-pin the ~8 queue-enqueue endpoints + admin/emergent;
   sticky by session for `/api/chat` + `/socket.io` + `/godot-ws`; round-robin
   the rest).
4. Redis for `_macroRateLimits` / `_apiRateWindows` / cross-node `_userCache` bust.
5. Tier-U write-through (`game_profiles`, `xpStore`, `mentorships`).
6. `instances: 2`, watch a week.
7. scale to 3-4 once stable.

Steps 3-7 can't be built-and-verified without nginx + Redis + multiple Node +
the sim + Ollama running together — not viable on the 16 GB Mac. **A40 work.**
Expected: reads scale ~N. Writes do not (§3).

### Tier 3 — only if measurement says writes are the ceiling
- **F.** Single bounded write queue (the research's recommendation) — makes
  contention predictable instead of `SQLITE_BUSY` storms.
- **G.** Postgres for the hot write tables. Large project; only on measured need.

---

## 5. What not to do

- **Don't buy a bigger pod expecting this to fix it.** A 9-vCPU A40 still runs
  *one* event loop for `POST /api/lens/run`. More cores give Ollama, the
  frontend, and workers room — they do not parallelize the macro chokepoint.
  (The A40 *does* fix the LLM degradation in 2d, which is real and worth doing —
  just a different problem.)
- **Don't cluster before Tier 0.**
- **Don't read the `total_ms` column as a priority list** — it is dominated by
  LLM await time that never touched the loop.
- **Don't let clustering land without the `/api/credits` fix** — per-process
  in-memory balances plus a client-supplied `earn` amount is a mint bug that
  gets strictly worse under N processes.

---

## 6. Reproduce

```sh
sqlite3 server/data/concord.db "SELECT domain||'.'||macro_name, count(*), ROUND(AVG(duration_ms),1), MAX(duration_ms) \
  FROM macro_call_log WHERE ts > unixepoch('2026-09-08') GROUP BY 1 HAVING count(*)>50 ORDER BY 2 DESC;"
# …and the same with `ts <` for the unloaded baseline.

AUTH=1 node load-tests/chaos-storm.mjs          # regenerate load
node scripts/detect-lens-stacking.mjs           # unrelated, frontend
```

---

## 7. Tier 1 D — heartbeat-in-its-own-process (code done, deploy is opt-in)

### What shipped (commit on `concurrency-refactor`, inert by default)
Two `server.js` modes, both no-ops unless their env var is set:
- **`CONCORD_HEARTBEAT_ONLY=1`** — runs `startHeartbeat()` + `_startGovernorHeartbeat()`
  + the emergent sim + the cognitive worker; `SHOULD_LISTEN` is false so it
  **binds no HTTP port**. Verified: `server_heartbeat_only_mode` logged, port
  refused, `governor_heartbeat_boot {ok:true}`.
- **`CONCORD_DISABLE_HEARTBEAT=true`** — now **completely** disables the tick on
  that process. It previously only short-circuited `_startGovernorHeartbeat`'s
  registry dispatch; `startHeartbeat()` (the T+45s local/global/weekly timers +
  the cognitive-worker spawn + `buildCognitiveSnapshot`) ran regardless — the
  gap §2c named. Now `startHeartbeat()` early-returns before any of that.
  Verified: `heartbeat_skipped_disabled_env {mode:"http-only"}`, `/health` 200
  in 3-12ms, `governor_heartbeat_boot {ok:false, reason:"heartbeat_disabled_env"}`.

Default (neither var) → one process does both, byte-identical to before. Pinned
by `server/tests/concurrency-process-modes.test.js`.

### Activating the split (deliberate deploy step — NOT done)

**Prereq:** the HTTP process must read DTUs from the shared store, not its own
now-frozen in-memory `STATE.dtus` (the sim process's DTU writes — consolidation,
autogen — won't reach the HTTP process's Map). Set `CONCORD_DTU_SIDECAR=1` on the
HTTP process and run the Rust `dtu-sidecar` (Phase 3, already built) — it reads
`dtu_store` directly and refreshes incrementally, so it sees every writer.
*Without this, feeds on the HTTP process go stale until it restarts.*

**pm2 (`ecosystem.config.cjs`) — apply this diff, then `pm2 reload`:**
```
  concord-backend env_runpod:
+   CONCORD_DISABLE_HEARTBEAT: 'true'
+   CONCORD_DTU_SIDECAR: '1'
+ concord-heartbeat  (new app):
+   script: 'server/server.js', instances: 1, exec_mode: 'fork'
+   node_args: '--max-old-space-size=4096 --expose-gc'
+   max_memory_restart: '5G'
+   env_runpod: { CONCORD_HEARTBEAT_ONLY: '1', DB_PATH: <same>, NODE_ENV: 'production', … }
```
The two entries are coupled — adding the `concord-heartbeat` app WITHOUT the
`CONCORD_DISABLE_HEARTBEAT` flag on `concord-backend` runs the sim twice (2× work
+ races). Never one without the other.

**launchd scaffold (2026-09-09) — landed, not activated on the 16 GB Mac.**
Two full Node processes + sidecar + Ollama on a swap-maxed 16 GB box will thrash;
this remains an A40-box step. Templates (placeholders only, no secrets):
`infra/launchd/com.concord.backend.plist.example`,
`com.concord.backend-i1.plist.example` (dual HTTP + `NODE_APP_INSTANCE` heartbeat
guard), and `com.concord.heartbeat.plist.example` (Tier 1 D sim-only). Runbook:
`docs/MULTI_INSTANCE_LAUNCHD.md`. Do **not** `pm2 stop`/`delete`/`cluster` — Mac
self-host stays launchd.

**Rollback:** unset both env vars, restart the one process. Instant.

**Watch after activating:** the sim process's own event-loop lag (it's now the
only thing on that loop — should be fine); the HTTP process's `dtu.list` p95
(should stay flat — sidecar-backed); `concord_heartbeat_ticks_total` rate on the
sim process (must be non-zero); no `heartbeat` logs on the HTTP process.

---

**Sources:** [SkyPilot — Abusing SQLite to Handle Concurrency](https://blog.skypilot.co/abusing-sqlite-to-handle-concurrency/) ·
[OneUptime — Fix SQLite "Database Is Locked" Under Concurrent Writes](https://oneuptime.com/blog/post/2026-09-08-fix-sqlite-database-is-locked-concurrent-writes/view) ·
[DOCSAID — SQLite WAL busy_timeout for workers](https://docsaid.org/en/blog/sqlite-wal-busy-timeout-for-workers/) ·
[OneUptime — Node.js clustering with PM2](https://oneuptime.com/blog/post/2026-02-20-nodejs-clustering-pm2/view) ·
[Site24x7 — Scaling Node.js Applications](https://www.site24x7.com/learn/scaling-node-js-application.html)
