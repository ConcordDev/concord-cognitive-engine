# Function Assurance — six gates, one per bug class

"Does 1.36M lines work?" is unfalsifiable; the **enumerable surface** (409 macro
domains · 9,323 macros · 3,037 routes · 257 lenses · 648 tables · 104 heartbeats ·
273 socket events) makes it computable: **function-coverage = every enumerable
unit passes an auto-derived gate.** Seven expeditions showed the bug mass collapses
to a few classes; each maps to one gate that derives its cases from the live
system (so it stays current with zero per-feature test-writing).

## Layer status

| Gate | Bug class | Status |
|---|---|---|
| **L0 — SQL-schema gate** | schema-drift (ghost tables / wrong columns — the dominant class) | ✅ **BUILT** — `scripts/audit/gates/schema-drift.mjs` (prepare()-everything against a live in-memory schema; catches ghost-tables + JOINs the high-confidence `verify-schema-drift.mjs` skips). **Drift driven to 0; wired into `audits.yml` as a floor-0 merge blocker.** |
| **L1 — reachability / dispatch** | built-but-unwired (#11, #T1) | 🟡 **mostly** — `verify-lens-backends.mjs` ✅, `wiring-gate.test.js` ✅ (now **green** — `seedRumor` wired), `macro-contract.js#validateRegistry` (Gate B) logs un-dispatched bus domains at boot. Remaining: the macro-dispatch *merge gate* + the ghost-fleet registration wire. |
| **L2 — auto-derived runtime smoke** | runtime-throw / write-500 (#R1/#R3/#R5, #R4/#R6) | 🟡 **EXISTS, extend** — `tests/behavior/lens-behavior-smoke.behavior.js` auto-derives one test per macro. Extensions: (1) an HTTP-route auto-walk asserting no 500/uncaught-throw; (2) the explicit **no-`fetch-failed`-mask** assertion (a 200 wrapping `{ok:false,source:'utility-brain'}` is a FAIL — use `macro-contract.js#isFallthroughMasking`). The #3/#27 dispatcher fix already converts the mask to an honest non-200. |
| **L3 — contract tests (load-bearing math)** | silent math regressions | ✅ **mostly** — royalty cascade / DTU-quality / refusal-strength pinned; `creator-dashboard-ledger.test.js` (this cycle) pins the double-sided ledger; add cross-world-potency curve as it surfaces. |
| **L4 — browser smoke** | frontend hydration / white-screens | ⬜ **BUILD + needs network** — Playwright sweep of `/lenses/*`; blocked here (chromium won't download in-sandbox). Runs on RunPod + a named SSE-capable tunnel. |
| **L5 — synthetic prod monitoring** | post-deploy drift (SSE buffering, journey breaks) | ⬜ **BUILD (light)** — reuse `first-cycle-journey.test.js` as a scheduled probe against the live site (incl. an SSE incremental-stream + heartbeat check); alert via the deployed Grafana. |

## Every expedition finding → its gate
Ghost tables/columns (R2–R3, V5–V32) → **L0** · ghost-fleet macros (#11) → **L1** ·
`seedRumor` (#T1) → **L1** · runtime throws (#R1/#R3/#R5) → **L2** · locked routers
(#R4/#R6) → **L2** · dtu.create non-persist (#32) → **L2+L3** · royalty/XP/fee math
→ **L3** · hydration → **L4** · #P1 prompt injection → **L2 + lint** · SSE
buffering → **L5**. Every observed class has exactly one gate — the method is
*complete* w.r.t. the surface the expeditions mapped.

## Operating principle
**Auto-derive, don't hand-write.** L0 reads the source's `db.prepare` literals +
the live schema; L1/L2 read the live `MACROS` map + route table + lens registry;
L3 is the only hand-written layer (small + stable); L4 reads `app/lenses/*`; L5
reuses authored journeys. A new lens/macro/route/table is covered the moment it
exists.

## Drive-to-zero (status)
1. **L0 + L2** retire schema-drift + runtime-throw (~80% of findings). L0 done
   (gate 0/0, CI-wired); L2 base exists, the route-walk + no-mask extension queued.
2. **L1** gates stay green as merge blockers — `seedRumor` red is now green.
3. **L4** on RunPod once the tunnel's up. **L5** wired to Grafana post-deploy.
The estimate becomes a green CI number that can't silently regress.
