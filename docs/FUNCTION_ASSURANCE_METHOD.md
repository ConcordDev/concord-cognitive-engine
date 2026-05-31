# Function Assurance — a method to ensure the *entire* Concordia codebase functions (Spec)

## 0. The reframe (why this is even possible for 1.36M lines / one dev)

"Does everything work?" is unfalsifiable. But Concordia's surface is **enumerable**:
~409 macro domains · ~9,323 (domain,macro) pairs · ~3,037 HTTP routes · 257 lens dirs · 648 tables ·
~104 heartbeats · ~273 socket events. So "does everything function" becomes a *computable* question:

> **Function-coverage = every enumerable unit passes an auto-derived gate.**

Seven expeditions found that the bug mass collapses to a few *classes* (schema-drift, built-but-unwired,
runtime-throw, frontend-hydration, prompt-injection, stream-buffering). The method: **map each class to
one auto-derived CI gate that drives that class to zero — and stays current because it derives itself
from the live system, not from hand-written per-feature tests.** That last property is what makes it
maintainable by one person.

Architecture note: Concordia is a **monolith**, so the integration-heavy **test pyramid** (not the
trophy) is the right shape — the bugs live at boundaries (route↔macro↔DB), exactly where the gates sit.

---

## 1. The six layers (each = one bug class → one gate)

### L0 — SQL-schema gate  *(kills schema-drift: rounds 2–3, the R-cluster, ghost tables/columns)*
**Technique (documented):** *prepared-statement validation against the live schema* — boot a
fresh-migrated DB, walk every `db.prepare("…")` / `db.exec("…")` string literal in the source, `.prepare()`
each against the real schema, and fail CI on `no such table/column`.
- Catches: `user_wallets` ghost table, `economy_transactions`/`citations`/`world_events`/`city_presence`/
  `npc_relations` wrong names, the `creator_id`/`from_npc_id`/`lineage`/`meta` wrong columns — the single
  biggest finding class across all expeditions.
- Concordia status: **BUILD** (does not exist). ~40 lines: glob `db.(prepare|exec)(\`…\`)`, skip
  interpolated `${}` ones (flag separately), prepare against a fresh-migrated DB.
- Handles the 167 dynamic `${}` queries by **listing them for manual review** (can't statically prepare).

### L1 — reachability / dispatch gate  *(kills built-but-unwired: round-1 #11, round-7 #T1 seedRumor)*
Three sub-gates, all auto-derived:
- **Macro dispatch:** for every registered `(domain,macro)`, assert `MACROS.get(d).get(m)` resolves
  (not LLM-fallthrough). Catches the ghost-fleet (quest/agents/research/religion/city).
- **Lens backend:** `verify-lens-backends.mjs` — **already exists** (255 WIRED / 2 by-design). Keep as gate.
- **Built-but-unwired:** `wiring-gate.test.js` — **already exists** (currently RED on `seedRumor`). Keep
  green as a merge gate.
- Plus **macro telemetry** (`_macroTelemetry`, already in `runMacro`): anything not fired in 30 days is
  flagged dead — reachability proven by *use*, not static parse.

### L2 — auto-derived runtime smoke  *(kills runtime-throw: round-1 throws, round-2 write-500s, evo-asset 500)*
The function floor: exercise **every** unit with synthetic input and assert the no-crash contract.
- Concordia status: **EXTEND.** `tests/behavior/lens-behavior-smoke.behavior.js` **already** auto-derives
  one test per `(domain,macro)` from the live MACROS map. Two extensions:
  1. Add the **HTTP-route** equivalent: auto-walk the route table, POST/GET each with synthetic input,
     assert no `500` / no uncaught throw (the round-2 POST-sweep, made permanent).
  2. Assert the **"no fetch-failed / no macro_uncaught_throw"** contract explicitly (a 200 wrapping
     `{ok:false,"fetch failed"}` is a FAIL, not a pass — catches the dead-macro mask).

### L3 — contract tests for load-bearing logic  *(kills silent math regressions)*
Pin the constitutional math: royalty cascade (halving/floor/cap), XP curve, fees, glyph algebra,
refusal strength-gating, cross-world potency.
- Concordia status: **MOSTLY EXISTS** (royalty, dtu-quality, refusal already pinned). Add the
  cross-world-potency curve + the wager-fee edge (round-4 #L1) as the gaps surface.

### L4 — browser smoke  *(kills frontend runtime: hydration, white-screens, failed fetches)*
Playwright sweep every `/lenses/*`: assert no `console.error`, no `pageerror`, no failed `requestfailed`,
and that the primary content renders (not a white-screen / error boundary).
- Concordia status: **BUILD** + **needs network** (RunPod, not this sandbox — chromium won't download
  here). See the frontend-runtime runbook (RunPod + `npx playwright install --with-deps chromium` +
  a named, SSE-capable Cloudflare tunnel).
- Catches: the hydration sites (`Date.now()`/`new Date()` rendered raw), the white-screen class, and any
  lens whose backend is dead (L1) showing as a broken render.

### L5 — synthetic production monitoring  *(catches post-deploy drift the build can't)*
Continuously exercise real journeys against prod: the onboarding cook→eat→fight→commune loop, a chat
stream (assert SSE actually streams incrementally + the heartbeat — catches the round's SSE buffering),
a marketplace purchase + royalty payout, a world enter + NPC dialogue.
- Concordia status: **BUILD** (light). Reuse the e2e journey tests (`first-cycle-journey.test.js`) as the
  synthetic-probe script; run on a schedule against the live site; alert on failure (Prometheus/Grafana
  already deployed).

---

## 2. The mapping — every expedition finding → the gate that would have caught it

| Finding class (expedition) | Gate |
|---|---|
| Ghost tables / wrong columns (R2–R3, R-cluster, V5–V32) | **L0** SQL-schema gate |
| Spell-license `dtu_citations` crash (#30), `lineage`/`meta` inserts (#R9/#R10) | **L0** |
| Ghost-fleet dead macros — quest/agents/research (#11) | **L1** macro-dispatch |
| `seedRumor` built-but-unwired (#T1) | **L1** wiring-gate (exists, keep green) |
| Dead `/lenses/{quests,agents,…}` | **L1** lens-backend + **L4** browser |
| Runtime throws — goals.propose, explore.run, evo-asset 500 (#R1/#R3/#R5) | **L2** runtime smoke |
| Locked routers — film-studio/billing 401 (#R4/#R6) | **L2** route smoke |
| dtu.create non-persist (#32), consolidation crash (#15/#20) | **L2** + **L3** |
| Royalty / XP / fee math | **L3** contract |
| Hydration `Date.now()` in render | **L4** browser |
| #P1 prompt injection (dialogue choice) | **L2** (input-validation assertion) + lint rule |
| SSE buffering / 100s drop | **L5** synthetic (streaming probe) |

Every class an expedition found maps to exactly one gate. That's the proof the method is *complete*
w.r.t. the observed bug surface.

---

## 3. The operating principle: auto-derive, don't hand-write

The reason this scales to 1.36M lines / one dev: **every gate derives its cases from the live system**,
so it grows automatically with the code.
- L0 reads the source's `db.prepare` literals + the live schema.
- L1/L2 read the live `MACROS` map + the route table + the lens registry.
- L3 is the only hand-written layer (load-bearing math is small + stable).
- L4 reads `app/lenses/*`.
- L5 reuses authored e2e journeys.

No "write a test per feature." A new lens/macro/route/table is covered the moment it exists.

---

## 4. Drive-to-zero loop (how to operationalize)

1. **Land L0 + extend L2** first — highest leverage; together they retire schema-drift + runtime-throw,
   which is ~80% of every expedition's findings, in one CI run that *also counts the exact remainder*.
2. Keep **L1** gates (wiring + lens-backend) **green as merge blockers** — `seedRumor` is the current red.
3. Run **L4** on RunPod once the tunnel's up (the one thing the sandbox can't do).
4. Wire **L5** to the existing Grafana for post-deploy.
5. **The number replaces the estimate:** my "80–180 more bugs" guess becomes an *exact* count the first
   time L0+L2 run — and every fix drives it down visibly. The gates are also the regression wall: once a
   class hits zero, it can't silently return.

---

## 5. Verdict

You don't ensure 1.36M lines "work" by reading them — you make the **enumerable surface** prove itself
through **auto-derived gates**, one per bug class. Concordia already has three of the six (behavior-smoke,
wiring-gate, lens-backend verifier) — they just need the **L0 SQL-schema gate** + the **L2 route-smoke
extension** to close the dominant classes, plus **L4 browser** (RunPod) and **L5 synthetic** for the
surfaces the sandbox can't reach. Build those and "does everything function?" stops being a worry and
becomes a **green number in CI** that can't regress.

**Sources:** [test pyramid vs trophy](https://www.baytechconsulting.com/blog/test-pyramid-vs-testing-trophy-whats-the-difference) ·
[testing pyramid for teams](https://semaphore.io/blog/testing-pyramid) ·
[schema drift detection in CI](https://www.liquibase.com/blog/database-drift) ·
[prepared-statement validation](https://dev.mysql.com/worklog/task/?id=4165) ·
[contract testing DB queries](https://medium.com/@continuousconfidence/confident-testing-contract-testing-database-queries-d427759d6159) ·
[validate queries against actual schema](https://schemasmith.com/guides/database-schema-drift.html)
