# Emergent-Module Reconciliation Audit (T2.4)

Reproducible via `node scripts/audit-emergent-wiring.mjs` (writes
`reports/emergent-wiring-audit.json`). Guarded in CI by
`server/tests/integration/emergent-wiring-audit.test.js` (fails if any orphan
reappears).

## What it checks

Layer 12 found several production-grade emergent engines that exported a cycle
handler but had **no heartbeat schedule** — they were dark forever
(drift-monitor, breakthrough-clusters, cnet-federation, hlr-engine). This audit
makes that class of bug machine-detectable.

For every `server/emergent/*.js` it finds exported cycle handlers
(`run*` / `tick*` / `sweep*` / `pump*` / `advance*` taking a context object) and
classifies the module:

| Class | Meaning |
|---|---|
| **WIRED** | Its handler name is referenced somewhere that can drive it — `server.js` (`registerHeartbeat` / `governorTick`), another emergent module (an orchestrator/scheduler), a route, or a domain macro. |
| **ENTITY-INLINE** | No top-level cycle handler; a per-entity module driven by `store.registerEmergent` (`decideBehavior`/`tick(entity)`), or a pure lib. |
| **ORPHAN** | Exports a cycle handler that **nothing** schedules. The bug. |

The reachability corpus is `server.js` + every *other* emergent module + all
routes + all domains (a handler can be legitimately driven on-demand from a
route, e.g. `advancePipeline`, `runScenario`).

## Result (2026-05-28, HEAD of `claude/game-plan-completion-2a0KH`)

```
191 files in server/emergent/
  WIRED          : 87
  ENTITY-INLINE  : 104
  ORPHAN         : 0
```

### Orphan found and fixed

- **`population-migration-cycle.js` → `runPopulationMigrationCycle`** — its own
  header declared it a *"Heartbeat … Frequency 30 ticks (~7.5 in-game
  minutes)"*, but it was **never `registerHeartbeat`'d**. Due
  `population_flow_events` (kingdom-decree migrations, refugee flows, voluntary
  NPC migration arrivals) silently never landed at their destination world.
  **Wired** in `server.js` at frequency 30, `scope: 'global'` (cross-world
  infrastructure), following the Layer-12 wire-the-unwired pattern.

### False positives the broadened corpus resolved

The first (server.js-only) pass flagged three handlers that are in fact
reachable on-demand, not via a heartbeat — confirming they are **not** orphans:

- `cross-lens-pipeline.js → advancePipeline` — stepped from
  `routes/emergent-features.js`.
- `scenario-engine.js → runScenario` — invoked from `emergent/index.js` +
  `routes/emergent-features.js`.
- `idle-behavior.js → runIdleBehavior` — invoked from `emergent/minor-agent.js`
  (whose scheduler is registered).

## Maintenance

When you add an emergent module with a `run*`/`tick*`/`sweep*` cycle handler,
either register it (`registerHeartbeat`) or invoke it from a route/orchestrator
— otherwise the CI guard fails. If a handler is intentionally reached by a path
the scanner can't see, add it to `ORPHAN_ALLOWLIST` in the script with a comment
explaining why.
