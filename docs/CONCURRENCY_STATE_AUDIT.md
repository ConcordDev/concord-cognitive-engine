# Concurrency Refactor — STATE-write audit for a multi-process macro cluster

**Status:** audit complete, execution not started. This is the map that makes
"run `server.js` as N cluster workers" a bounded project instead of a rewrite.

**Generated data:** `audit/concurrency/state-write-audit.json` (re-run
`node scripts/audit-state-writes.mjs`). 121 `STATE.<key>` names carry a mutation
inside an HTTP route or macro handler. This doc classifies every one of them
plus the non-`STATE` module-level mutable state on the request path.

**The goal is NOT full shared-memory.** It's: for each piece of mutable state,
pick exactly one of — (a) **DB-authoritative** (write-through on every request
mutation, in-memory copy is a bust-able cache), (b) **node-0-pinned** (the
request that mutates it is routed to the instance that owns the heartbeat),
(c) **sticky-routed** (by `userId` or session cookie), or (d) **derived**
(rebuilt on boot, never shared).

---

## 0. The single-loop reality this is fixing

One `node server.js` = one event loop. The auth cache (commit `983151ea5`) and
the DTU read sidecar (Phase 3) shaved per-request loop time; the read replica
(`engines/concord-read-router/`) takes the allowlisted GET catalog off the
writer. Neither parallelises `POST /api/lens/run` — the macro chokepoint still
runs on one loop. Running `server.js` as a `cluster` (or `pm2 instances: N`)
behind nginx is the only thing that does, and this audit is its blocker list.

---

## 1. Tier M — money / ledger (constitutional; do first)

The real economy is **DB-authoritative already**: `user_wallets` + `economy_ledger`,
summed via `CREDIT_ROW_PREDICATE` (`server/economy/balances.js`), mutated only
through `mintCoins` / `walletDebit` / `walletCredit`. Those paths are
cluster-safe as-is (SQLite is the single writer). The audit found **parallel
in-memory money stores** that are not:

| State | Site | Finding | Action |
|---|---|---|---|
| ~~`STATE.wallets`~~ | `/api/credits/*` | **✅ RESOLVED 2026-09-08.** `STATE.wallets` deleted entirely (0 refs). `/api/credits/wallet` + `/api/credits/balance` now read the real ledger-summed CC balance (`economy/balances.js#getBalance`, read-only, no per-process state). `/api/credits/earn` + `/api/credits/spend` are honest no-ops returning `{ok:false, error:"credits_not_mintable"}` — CC is earned only through real economy events. Free-mint surface closed, per-process incoherence closed. The one caller (a fake "Manual earn/spend" demo button in `concord-frontend/app/lenses/crypto/page.tsx:433,463`) should be removed in the frontend consolidation pass — its `catch` already swallows the `ok:false`. |
| `STATE.transactions` / `STATE.entitlements` / `STATE.listings` | `server.js:34786-34831` | Papers-era org marketplace, in-memory Maps. Superseded by the economic marketplace (`/api/economic/marketplace`, DB-backed) but routes still live. | Verify no money moves here; if dead, remove. Else write-through. |
| `STATE.marketplaceListings` | `server.js:43729` | In-memory Map, plugin-listing catalog. No balance impact but cluster-splits the catalog. | Write-through to a `marketplace_listings` table, or node-0-pin the submit route. |
| `STATE.bequests` | `server.js:52412` | In-memory Map, capped. Inheritance/bequest intents. | Write-through — a lost bequest is a lost asset transfer. |

**Rule going forward:** any request-path write to a `STATE.*` key whose value
represents currency, entitlement, or ownership MUST be accompanied by the
authoritative DB write in the same handler. Add a detector
(`money-state-hygiene`) that greps for `STATE.wallet`/`STATE.*balance*`
mutations without an adjacent `economy_ledger` / `mintCoins` call.

---

## 2. Tier U — per-user progression (sticky-route or write-through)

In-memory, **not persisted**, keyed by `userId`. A cluster splits each user's
state across nodes; a restart loses it.

| State | Site | Shape | Recommended |
|---|---|---|---|
| `STATE.gameProfiles` | `server.js:62396-62489` | `Map<userId, {xp, level, badges, streak, questsCompleted}>` | Write-through to a `game_profiles` table (small, obvious schema). It's read on nearly every gamified action — a table read per action is fine, or keep the Map as a cache with write-through. |
| `STATE.xpStore` | `server.js:67333` | `{}` object, per-user XP | Fold into `game_profiles` or its own table. |
| `STATE.mentorships` | `server.js:69506-69545` | **array capped at 50 globally** — already lossy on ONE node | Write-through to the existing `mentorships` table (migration 127). The in-memory array looks like a forgotten pre-DB relic. |
| `STATE.goals` | 11 helper-scoped sites | per-user goal list | Verify against `goals` domain persistence; likely already DB-backed and this is a cache. |
| `STATE.customPersonas` / `STATE.personas` | `server.js` (4+3 sites) | user-authored personas | `personas` domain is now DB-backed (`server/domains/personas.js`); confirm these Maps are caches, add cross-node bust. |
| `STATE.assessments` | 1 site | per-user assessment results | Review — small. |

**Interim (before write-through):** nginx `ip_hash` or a `userId`-derived
sticky cookie keeps a user on one node, making these correct-but-not-durable.
That's enough to turn the cluster on; durability is a follow-up per key.

---

## 3. Tier Q — queues drained by heartbeats (node-0-pin the enqueue)

Enqueued by a request, drained by a `registerHeartbeat` module. The heartbeat
runs on **exactly one** instance (`_startGovernorHeartbeat` guarded by
`NODE_APP_INSTANCE === '0'` — see §6). So the enqueue must land on node 0, or
the queue must move to Redis/DB.

| State | Site | Drained by |
|---|---|---|
| `STATE.queues.terminalRequests` | `server.js:14800` | terminal/agent heartbeat |
| `STATE.queues.macroProposals` | `server.js:43273` | macro-proposal review heartbeat |
| `STATE.queues.metaProposals` | `server.js:40554` | federation / meta-derivation |
| `STATE.queues.{synthesis,hypotheses,philosophy,wrapperJobs,panelProposals}` | STATE def `server.js:5880+` | various autogen heartbeats |
| `STATE.globalThread.councilQueue` | `server.js:84472-84480` | council deliberation heartbeat |
| `STATE.globalThread.acceptedContributions` | `server.js:84538` | council audit trail |
| `STATE.feedbackQueue` | 2 sites | feedback-processing heartbeat |
| `STATE._metaDerivationQueue` | 1 site | meta-derivation cron |
| `STATE.jobs` | `server.js` (5 sites) + STATE def | generic job runner |

**Recommended:** route the small set of "enqueue" endpoints
(`/api/council/submit`, `/api/marketplace/plugins/submit`, agent-terminal,
feedback) to node 0 via an nginx `location` block, OR move these queues to a
`pending_jobs` table (the `jobs` Map already has a table-shaped schema in its
comment). The table option also survives a node-0 restart.

---

## 4. Tier S — chat / session (sticky by session)

| State | Site | Note |
|---|---|---|
| `STATE.sessions` | `server.js` (7 sites) | `Map<sessionId, {messages[], styleVector}>` — conversation buffers |
| `STATE.styleVectors` | 8 sites | per-session style; regenerates, benign |
| `STATE._sessionRecordings` | 3 sites | session capture |
| `STATE.__resonanceHistory` | 4 sites | per-session resonance amp state |
| `_SESSION_ACTIVITY` (module-level) | grep | session activity tracker for rate/idle |
| `_macroRateLimits` (module-level) | grep | per-user macro rate limit windows |
| `_apiRateWindows` / `_apiUsage` (`STATE._*`) | 2+2 sites | API rate/usage accounting |

**Update 2026-09-09:** Redis write-behind landed for `_SESSION_ACTIVITY` and
`_macroRateLimits` via `server/lib/concurrency/shared-state.js` (fail-soft).
`STATE.sessions` chat buffers remain **sticky-required**. `STATE.qualia` /
`STATE.shadowDtus` stay per-node (derived/evictable).

**Recommended:** socket.io already has `@socket.io/redis-adapter` wired
(`server.js:10240`). Add nginx sticky sessions (cookie or `ip_hash`) so a
chat/WebSocket client stays on one node — then `STATE.sessions` is correct
per-node. Rate limits (`_macroRateLimits`, `_apiRateWindows`) either move to
Redis (`INCR`+`EXPIRE`) or accept per-node limits at N× the configured rate
(usually fine — set the per-node limit to `configured / N`).

---

## 5. Tier E — emergent simulation (node-0-only; ~60 keys)

The large tail. `dreams`, `dreamState`, `episodes`, `battles`, `swarms`,
`physics`, `chemCompounds`, `chemReactions`, `worldModel`, `metabolismState`,
`causalEdges`, `timeCrystals`, `futures`, `gardens`, `simTimelines`,
`npcCurrentBehaviors`, `governors`, `metaLearning`, `experienceLearning`,
`knownPatterns`, `pathWeights`, `flywheelHistory`, `reflection`, `metacognition`,
`grounding`, `hypothesisEngine`, `explanations`, `debates`, `councilSessions`,
`councilProposals`, `councilVotes`, `delegatedTasks`, `cognitiveDigitalTwins`,
`personality`, `attention`, `sleeping`, `sovereignAlerts`, … .

These are **written primarily by `governorTick` / heartbeat modules**. The
request-path writes the audit found are almost all **admin / debug pokes**
(`/api/admin/*`, `/api/emergent/*`, dev inspection endpoints) — not
user-facing hot paths.

**Recommended:** the emergent simulation runs on **node 0 only** (same instance
as the heartbeat). Any endpoint that mutates a Tier-E key is either (a) already
admin-gated → add it to the node-0 nginx `location` block, or (b) a debug
endpoint that can be disabled in the cluster config. This is exactly the
`CONCORD_SHARD_WORLDS` / `world-shard-protocol.js` `PER_WORLD_WRITE_TABLES`
philosophy — the emergent sim is single-owner by design; formalise it.

`STATE.qualia` + `STATE.shadowDtus`: LRU-capped, recreated on next hook, already
documented as evictable. Per-node divergence is acceptable — they're derived
working sets, not source of truth.

---

## 6. Tier D — derived / cache (bust across nodes, or rebuild on boot)

| State | Strategy |
|---|---|
| `STATE.users` | DB-authoritative (`users` table). Already fronted by `_userCache` (5s TTL, commit `fdf1d5cee`-adjacent). Cross-node ban/role changes: the 5s TTL bounds staleness; for instant propagation add a Redis pub/sub `bust` channel calling `globalThis.__concordBustUserCache`. |
| `STATE.apiKeys` | DB-authoritative (`api_keys`). Same pattern — short TTL cache or Redis bust on revoke. |
| `STATE.orgs` | DB-authoritative (`orgs`). Cache. |
| `STATE.lensDomainIndex` | **Derived** from `lensArtifacts` — rebuild on boot, never share. |
| `STATE.globalIndex` (`byHash`/`byId`) | Derived DTU lookup index — rebuild from `dtu_store` on boot. |
| `STATE.dtus` | Phase 3: `dtu_store` write-through + Rust read sidecar. **Action:** verify each of the 36 `STATE.dtus.set` request-path sites the audit flagged actually calls `persistToSQLite` / `dtuStore.put` (the heuristic only checks ±60 lines). Most go through `createDTU` which does persist; confirm the exceptions. |
| `STATE.lensArtifacts` | `lens_artifacts` write-through exists; verify the 7 flagged sites. |
| `STATE.global` (`server.js:81378`) | The cross-org "published DTU" space (`pendingPublish`, `dtus`). DTUs themselves are in `dtu_store`; `STATE.global.dtus` is an index. Rebuild on boot or write-through the publish state. |

---

## 7. Non-`STATE` module-level state on the request path

| Symbol | File | Strategy |
|---|---|---|
| `_llmQueue` | `server.js` | Per-node queue is fine — each node has its own concurrency budget. Total cluster concurrency = N × `LLM_CONCURRENCY`; retune down per node. |
| `_CONCURRENCY.limits` | `server.js` | Same — per-node. |
| `_breakers` (`_breakers.ollama` etc.) | `server.js` | Per-node circuit breakers are correct (each node observes its own upstream health). |
| `_userCache` (`LruMap`) | `server.js:~6310` | Per-node cache; add Redis bust channel for instant cross-node invalidation (see §6). |
| `getCurrentLagMs` / event-loop pressure | `server/lib/event-loop-pressure.js` | Per-node by definition — correct. |
| detector baselines, doc-claim caches | various | Read-only after boot — safe. |
| `workers/macro-pool.js` STATE snapshot | `workers/` | Already stale-by-design (2-min sync). Under a cluster, each node's pool syncs from that node's STATE. No new problem, same existing limitation. |

---

## 8. The heartbeat singleton (the one hard gate)

`_startGovernorHeartbeat()` (`server.js:~41522`, called at `server.js:~37656`)
schedules `governorTick()` on a 15s interval → `tickAllRegistered()` → 143
heartbeat modules. Running this on every cluster worker = N× the emergent work,
N× the DB write pressure, and races on every Tier-E and Tier-Q key.

**Required guard:**
```js
const IS_HEARTBEAT_NODE = !process.env.NODE_APP_INSTANCE || process.env.NODE_APP_INSTANCE === '0';
if (IS_HEARTBEAT_NODE) _startGovernorHeartbeat();
```
(`pm2` sets `NODE_APP_INSTANCE`; Node `cluster` sets `NODE_UNIQUE_ID` /
`cluster.worker.id` — pick the one the chosen launcher provides.) The
`CONCORD_READ_REPLICA` path already proves the "skip heartbeat on this instance"
plumbing works (commit `56c6e4ec7`).

Also singleton: migrations (`runMigrations` — node 0 only, others wait for the
schema), seeders (`content-seeder`, `skill-seeder` — node 0 only), the lore
interval (`server.js:~39923` — node 0 only), backup cron (already external).

---

## 9. Execution order (each step independently shippable)

1. **Resolve Tier M** — delete or DB-back `/api/credits/*`; verify `STATE.transactions`/`entitlements`/`listings` move no money. Add the `money-state-hygiene` detector. *(No clustering yet — this is a standalone correctness fix.)*
2. **Heartbeat + singleton guard** — `IS_HEARTBEAT_NODE` gate on `_startGovernorHeartbeat`, seeders, migrations-wait, lore interval. Test with two local instances, one with `NODE_APP_INSTANCE=1`, confirm it does zero emergent work.
3. **nginx routing tiers** — `location` blocks: node-0-pin for the ~8 Tier-Q enqueue endpoints + admin/emergent; sticky (`ip_hash` or cookie) for `/api/chat`, `/socket.io`, `/godot-ws`; round-robin for the rest.
4. **Redis for rate limits + user-cache bust** — `_macroRateLimits`, `_apiRateWindows` → Redis; add the `__concordBustUserCache` pub/sub channel.
5. **Tier U write-through** — `game_profiles` table + `STATE.gameProfiles`/`xpStore` write-through; fix `STATE.mentorships` to use its real table.
6. **Turn on `instances: 2`** — smallest cluster, watch for 1 week. `chaos-storm.mjs` before/after; the win is health-p95-under-load, not raw throughput.
7. **Scale to `instances: 3-4`** once 2 is stable on the A40 (9 vCPU — leave headroom for Ollama + frontend).

Steps 1-2 are the genuinely blocking ones. 3-4 make it correct. 5 makes it
durable. Everything is reversible by setting `instances: 1`.

---

## 10. What this is NOT

- Not a `server.js` split (orthogonal, deferred, marginal for perf).
- Not shared-memory STATE — no key becomes truly shared; each gets a strategy.
- Not the world-sim sharding (`CONCORD_SHARD_WORLDS`) — that's a different axis
  (per-world forks for sim load); this is HTTP-request load. They compose:
  world shards + an HTTP cluster + node-0 for cross-world infra.
