# Absorbed Libs — Audit & Wire Decisions

Generated 2026-05-08 during Phase C of the v1 closeout. The 11 absorbed
libs from `claude/world-lens-core-pipeline-D6Ric` (extracted via
`novel-files-extract`) were all CommonJS (`module.exports = X`) and
landed in an ESM tree. Each had to be evaluated for keep/drop/merge
before wiring.

## Decision matrix

| Lib | LOC | Decision | Rationale |
|---|--:|---|---|
| `dtu-protocol.js` | 476 | **WIRE** | Fills a real gap. Concord has a DTU substrate but no formal envelope/hash spec. Canonical impl with content-hash determinism + append-only citations + semver versioning. Low risk (additive). |
| `concord-test.js` | 437 | **WIRE** | Novel — DTU physics testing (Jest-like API for structural simulation: seismic, wind, thermal, combined load). Engineering-domain DTUs (architecture, legal blueprints) get simulated validation. Doesn't duplicate anything. |
| `concord-moderate.js` | 445 | **WIRE** | Fills a gap. Concord has refusal-field for actions but no text-content moderation (block/flag policies, batch moderation, review queue). Pairs with the existing repair-cortex / drift-monitor for content drift. |
| `concord-observe.js` | 459 | **EVAL** | Overlaps with `prom counters + structuredLog + repair-cortex` but the auto-repair brain (pattern-matched diagnostics → fix suggestions) is novel. Future merge candidate; not blocking. |
| `cpm-manager.js` | 785 | **EVAL** | Overlaps with `plugin-loader + plugin-gallery` (migration 085) but the citation-mandatory invariant ("every install creates a citation record") aligns with our royalty cascade. Future merge candidate. |
| `concord-identity.js` | 655 | **DROP** | Mock identity layer with simulated OAuth 2.0. We have real auth (JWT + bcrypt + sessions). The "simulated" comment in the file header confirms it's a dev-time stand-in, not production code. |
| `concord-lens.js` | 518 | **DROP** | Knowledge-lens content authoring with a sections/data-sources/interactives model. Different mental model from our macro + lens-manifest pattern. Wiring would fork the lens authoring story. |
| `concord-procgen.js` | 570 | **DROP** | Name pools + procgen helpers. We have full content-seeder + npc-spawning + fauna-spawner. Name pools could be merged into existing seeders if needed; the rest duplicates. |
| `concord-sync.js` | 607 | **DROP** | "Simulated broadcast" — mock collaborative room/presence/locking. We have real socket.io fan-out + concord-mesh + realtime presence (`presence-stale-sweep` heartbeat). Superseded. |
| `brain-service.js` | 593 | **DROP** | "Actual Ollama integration is handled separately... This module provides routing logic, request tracking, pricing tiers, and **simulated inference**." Mock. We have real brain-router with all 4 brains + LLaVA wired. Superseded. |
| `component-registry.js` | 485 | **DROP** | Overlaps with our auto-generated `module-registry.js` (120-module dep graph) and the macro registration system. Adds nothing the registries don't already provide. |

## Wired now (this commit)

- `dtu-protocol.js` — converted to ESM, exposed via `lib/dtu-protocol.js`
  itself (re-export form). Used by a new `dtu.protocol_validate` macro
  + Tier-2 contract test pinning canonical hash determinism.
- `concord-test.js` — converted to ESM, kept in tree as
  `lib/concord-test.js` for follow-on `register("dtu_test", ...)` macro
  pass.
- `concord-moderate.js` — converted to ESM, kept in tree as
  `lib/concord-moderate.js` for follow-on `register("moderate", ...)`
  macro pass.

## Dropped (deleted from tree this commit)

`concord-identity.js`, `concord-lens.js`, `concord-procgen.js`,
`concord-sync.js`, `brain-service.js`, `component-registry.js`.

## Eval queue (kept dormant for now, decision deferred to follow-on)

- `concord-observe.js` — until we know if the auto-repair brain pattern
  matcher is novel-enough vs repair-cortex.
- `cpm-manager.js` — until we know if the citation-mandatory install
  invariant should fold into plugin-gallery or become its own surface.

## Convention going forward

When a future absorption pass lands more orphan libs, append a row to
the matrix above. Decision must be one of: **WIRE / EVAL / DROP** with
explicit rationale.
