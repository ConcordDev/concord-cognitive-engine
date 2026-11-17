# Rolling-Restart Design — Blue/Green Backend Swap

**Ticket:** IMM-27 (parent MST-W2-07) · **Gate:** ungated_plan_only — this document is the
deliverable. It proposes; it does not implement. Implementation is **MST-W4-18** and starts
only on Dutch's go.
**Premise base:** live main `f4f1f77ff610252fba82f35ec0b83da0829d53c6` (2026-11-17), read-only:
`ecosystem.config.cjs` (repo root) and `server/server.js` (96,125 lines) read first-hand.
**Branch:** `v1/rolling-restart-doc`.

---

## 1. The problem

Today the backend is **one process**: `ecosystem.config.cjs` runs `concord-backend`
(`server/server.js`) as a single pm2 app, `instances: 1`, `exec_mode: "fork"`, PORT 5050
(frontend: PORT 3000, also single-instance fork; a third app runs the Godot client).
Every deploy or restart is therefore a hard cut:

- the port closes while the process restarts (pm2 `restart_delay: 5000`, commented in the
  config as the grace "lets WAL checkpoint + port release" — the SQLite WAL is part of
  the restart cost);
- everything the process held in memory is rebuilt from scratch or lost (see §3);
- a bad build is discovered by users, because the new process is the only process.

A rolling restart replaces the hard cut with a **health-checked swap**: boot the new
build beside the old one, prove it is the intended build and healthy, move traffic,
drain the old one, then stop it. A bad candidate never receives traffic.

## 2. Proposed topology (blue/green over pm2, two ports behind nginx)

```
                    ┌── nginx upstream "concord_backend" ──┐
                    │   active:   127.0.0.1:5050 (blue)    │
   clients ──► nginx│   standby:  127.0.0.1:5051 (green)   │
                    └──────────────────────────────────────┘
   pm2: concord-backend-blue   (PORT 5050)
        concord-backend-green  (PORT 5051)
```

- Two pm2 apps generated from the same ecosystem entry, differing only in `PORT` and
  name. Exactly one is *active* (in the nginx upstream); the other is *standby*.
- nginx is the only traffic switch. pm2 never load-balances between the pair;
  `exec_mode` stays `fork`, `instances` stays 1 per colour. (pm2 cluster mode is
  explicitly **not** the design: it would run both colours live against the same
  in-memory state model — see §3 — which is the failure this design exists to avoid.)
- The frontend keeps its current single-instance shape in this design; its restart is a
  static-asset swap with no in-memory state of consequence. Folding the frontend into
  the same colour scheme is an open question for Dutch (§7), not assumed here.

## 3. The in-memory state inventory (the heart of the design)

`server/server.js` carries **166 state-shaped top-level declarations** (537 top-level
declarations in total; 279 `new Map(` and 481 `new Set(` occurrences across all depths).
They fall into six classes. Only classes A, B and D constrain the swap; the design rules
follow the table.

| Class | What it is | Named members (line refs at premise head) | Swap rule |
|---|---|---|---|
| **0 — Static config & constants** | Identical in every instance; never mutated at runtime | `INPUT_LIMITS` (3327), `COOKIE_CONFIG` (8193), `RATE_LIMIT_CONFIG` (77851), `PG_CONFIG` (62270), `REDIS_CONFIG` (62344), `SSO_CONFIG` (64513), `MIGRATIONS` (77922), `OPENAPI_SPEC` (47985), the keyword/stopword/rule tables | No constraint. |
| **A — Durable working set** | The platform's data, held in Maps in memory, persisted to SQLite/files and reloaded at boot | `STATE` (6449 — dtus, shadowDtus, wrappers, layers, personas, users, orgs, apiKeys, jobs, sources, listings, entitlements, transactions, papers, organs, notifications, lensArtifacts, …), `DATABASES` (63536), `ATTACHMENTS` (20570), `SHARE_LINKS` (25431), `REMINDERS` (64340), `RSS_FEEDS` (63728), `WEBHOOK_SUBSCRIPTIONS` (64662), `ENTITIES` (68390), `DAILY_NOTES` (63643), derived: `GRAPH_INDEX` (49732), `SEARCH_INDEX` (46663) | **One writer only.** The standby boots with state loaded but must not accept writes and must not run the state savers. See Rule 1. |
| **B — Auth & session state** | Who is signed in, what is revoked | `_TOKEN_BLACKLIST` (7797 — in-memory Map is primary/synchronous, write-through to Redis if connected and SQLite if available), `_SESSION_ACTIVITY` (7736), `STATE.sessions`, `_selfTokens` (29087), `_LOCKER_KEYS` (8075) | Revocations must survive the swap: the candidate must hydrate the blacklist from the durable tier (SQLite/Redis) before it takes traffic. See Rule 2. |
| **C — Rebuildable caches** | Pure derivatives; loss costs a warm-up, never correctness | `CACHE` (60579), `_LING_CACHE` (6193), `_uvCache` (19826), `_VIEWER_LOC_CACHE` (19791), `_globalQueryCache` (51804), `_voiceExemplarCache` (13093), `_PATTERN_HISTORY` (5277), `PREDICTION_STATE` (57623), `MORNING_BRIEF_CACHE` (73796), `_chatMemory` (29349), `_rehydrationCache` (19505) | No constraint. The candidate warms its own caches. |
| **D — Coordination, per-process by construction** | Correct only inside one process | `_IDEMPOTENCY` (10520 — Map, 5-min TTL, 10k cap), `_SLIDING_WINDOW` (10459), `_manifestRateState` (43609), `_gatherCooldown` (61635), `_councilSubmitTracker` (92844), `_CONCURRENCY` (10422), `_mutexQueue` (4035), `BREAKERS` (3421) / `circuitBreakers` (77624), `_activeTimers` (3429), `_staggerRegistry` (3440), `shutdownCallbacks` (3428), `REALTIME` (10699) + socket.io rooms, `_federationReplayState` (44784 — replay nonces), `STATE.jobs` scheduler | The overlap window is where these bite. See Rules 3–5. |
| **E — Telemetry & ephemeral logs** | Counters and ring buffers; loss is a gap in a graph, not an incident | `METRICS` (9490), `_LATENCY` (10567), `_HEALTH_RING` (60713), `_webVitals` (60894), `_perfTelemetry` (43947), `_recentErrors` (51883), `AUDIT_LOG` fallback array (8229), `ACTIVITY_LOG` (25497), `THOUGHT_TIMELINE` (25961), `_archiveEmbedStats` (2524), `REPAIR_STATE` (73037), `_brainHealthFailures` (72686) | Accepted loss, stated: metrics/audit-fallback buffers reset at the swap. (Audit's durable tier is `AuditDB`, 7436 — class A behaviour.) |

### The five rules the table forces

1. **Single-writer rule (Class A).** Both colours load the same durable state at boot.
   If both accepted writes — or both ran the debounced state savers — the copies would
   diverge and the loser's saver could overwrite the winner's newer data. The standby
   therefore runs in a **write-quiesced mode**: it serves `/health` and `/ready`, loads
   state, and does not take traffic, run savers, or execute scheduled work until it is
   promoted. Promotion and demotion are explicit steps in the swap (§4), never a side
   effect of booting. *The mechanism for write-quiesce (env flag vs. control endpoint)
   is an implementation decision for MST-W4-18; this design requires the property, not
   the mechanism.*
2. **Revocation-hydration rule (Class B).** A token revoked seconds before the swap
   must stay revoked after it. The blacklist's durable write-through (SQLite/Redis)
   already exists; the candidate's readiness check must include hydrating it, and the
   swap's health gate (§4, step 3) must not pass a candidate that skipped hydration.
3. **Idempotency window (Class D).** `_IDEMPOTENCY` is per-process with a 5-minute
   TTL. A client retry carrying the same `Idempotency-Key` that lands on the other
   colour during the overlap can re-execute once. The blast radius is bounded (one
   retry, inside the overlap, inside 5 minutes) and is **accepted and stated**, with
   the mitigation that the overlap is kept short and the old colour drains before it
   stops (§4, step 5). Moving idempotency to the durable tier is out of scope here;
   it is named as follow-up work, not silently assumed.
4. **Rate-window doubling (Class D).** Sliding-window and cooldown limiters are
   per-process, so during the overlap the effective limit is the sum of both colours'.
   Bounded, brief, and accepted; the alternative (shared limiter state) is the same
   out-of-scope follow-up as Rule 3.
5. **Scheduler & socket rule (Class D).** Scheduled/background work (`STATE.jobs`,
   `_activeTimers`) runs on the active colour only — the standby's timers stay disarmed
   until promotion, or every timed job fires twice. Socket.io is per-process (loaded in
   `tryInitWebSockets`, ~L11154; no cross-process adapter exists): rooms and presence
   live and die with their instance. Clients connected to the draining colour keep
   their session until drain completes, then reconnect to the new colour and rejoin;
   the design does not promise zero reconnects, it promises no *data* loss across them.

## 4. The swap, step by step (health-checked)

Precondition: a new build is on disk in its own tree; the active colour is serving.

1. **Boot the standby colour** with the new build (`PORT` = the standby port,
   write-quiesced per Rule 1, timers disarmed per Rule 5). The old colour is untouched.
2. **Wait for process health:** poll the standby port's `GET /health` until it returns
   200. `/health` and `/ready` already exist and are public, gate-exempt paths
   (server.js L4015, L8360, L9456).
3. **Verify the build, not just the pulse:** `GET /health` returns `buildSha` —
   `server/lib/build-sha.js` resolves it once at boot (`CONCORD_BUILD_SHA` env →
   `git rev-parse HEAD` → fail-soft null). The swap proceeds only if `buildSha`
   **equals the target sha of the build being deployed**. A candidate that booted the
   wrong tree, or cannot name its sha, fails here and never receives traffic. (This is
   the same primitive the lens walker's sha gate uses.)
4. **Readiness, not just health:** poll `GET /ready` until 200 — the candidate has
   loaded state and hydrated revocations (Rule 2). Health without readiness is not
   promotable.
5. **Flip and drain:** point the nginx upstream at the candidate's port and reload
   nginx (graceful reload; existing connections finish on the old colour). The old
   colour stops taking *new* connections, finishes in-flight requests and socket
   sessions, runs its final state save and WAL checkpoint, and only then is stopped
   via pm2. Drain timeout: if the old colour has not drained inside the window
   MST-W4-18 sets, it is stopped anyway and the loss is the Class E buffers plus
   socket reconnects — never Class A data, because the candidate already holds the
   durable state and the old colour's savers were the only writer until the flip.
6. **Confirm and swap the colours:** the promoted instance is now blue; the stopped
   slot becomes the standby for the next deploy. Record the swap (from-sha, to-sha,
   health/readiness evidence) in the deploy log.

**Rollback** is the same procedure run backwards at any point before step 5's stop:
before the flip, rollback is "stop the candidate" (zero user impact); after the flip
but before the old colour stops, rollback is "flip nginx back" (the old colour still
holds live state and never stopped serving its in-flight work); after the old colour
has stopped, rollback is a fresh swap to a standby booted on the previous build.

## 5. What the operator sees

- One command conceptually — "deploy" — that runs §4 and prints each gate as it
  passes: standby booted · `/health` 200 · `buildSha` matches target · `/ready` 200 ·
  flipped · drained · stopped. Any gate failing stops the sequence with the candidate
  still dark and the active colour untouched, and says which gate failed.
- The deploy record names both shas, so "what is prod running" is always answerable
  from `/health`'s `buildSha` on the active port — the same answer the walker checks.

## 6. What changes, and what does not (doc-entry gate)

- **Changes under this design (at implementation, MST-W4-18):** `ecosystem.config.cjs`
  gains the second backend app (standby port); an nginx upstream fronts the backend
  port pair; a swap script/runbook executes §4. Route + handler shape: **no route
  changes** — the design consumes the existing `GET /health` (with `buildSha`) and
  `GET /ready` contracts exactly as they stand.
- **Side effects, stated:** Class E buffers reset per swap; socket clients reconnect
  once per swap; the bounded idempotency and rate-window overlaps of Rules 3–4 exist
  during the drain window.
- **Does not change:** payments/money paths (untouched, and money stays OFF); the
  frontend's deployment in this step; `server.js` itself — this design never splits
  the monolith and requires no server.js edit to describe; prod config beyond the
  ecosystem/nginx additions named above, and only at implementation time on Dutch's go.

## 7. Open questions for Dutch (decisions this doc needs, not assumptions)

1. **Write-quiesce mechanism** (Rule 1): env flag at boot, or a control endpoint the
   swap script calls? The flag is simpler; the endpoint is observable. MST-W4-18
   should not start until this is picked.
2. **Standby port choice:** 5051 is proposed; any port free on the host works. Confirm
   no other service owns it on the prod host.
3. **Frontend in scope?** This design leaves the frontend single-instance. If deploys
   should be atomic across frontend+backend, the frontend joins the colour scheme —
   a small addition, but a different promise.
4. **Drain timeout value:** how long the old colour may hold the swap before it is
   stopped with Class E loss. Proposed default for MST-W4-18 to tune: 120 s.
5. **Blacklist hydration check** (Rule 2): readiness must prove hydration happened —
   count comparison against the durable tier, or a canary revocation round-trip?
   The canary is stronger; the count is cheaper.

## 8. Gate legs recorded for this ticket

- **Behaviour test — N/A, with reason:** plan-only ticket (gate `ungated_plan_only`);
  there is no behaviour to reproduce. The design's factual claims are instead pinned to
  the premise reads cited inline (file, line, head sha), each checkable against the
  tree at `f4f1f77ff`.
- **Adversarial tests — N/A, with reason:** no code ships. The design's failure cases
  are handled as design content: wrong-build candidate (§4 step 3), unready candidate
  (step 4), drain overrun (step 5), rollback at each stage (§4).
- **ULW recipe — N/A, with reason:** non-lens ticket; the master row's walker hook is
  "Non-lens; none." The swap steps in §4 are written to be replayable by the
  implementation's own runbook tests under MST-W4-18.
- **Doc entry — this document is the doc entry:** what changes (§6), the route +
  handler shape consumed (§4 steps 2–4), what the operator sees (§5), side effects (§6).
