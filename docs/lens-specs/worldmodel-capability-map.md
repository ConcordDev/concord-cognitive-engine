# worldmodel — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("worldmodel"' server/domains/worldmodel.js` → 27 (26 pre-existing + `wm_extract_from_dtu`, this pass)

## What this lens actually is

Not the 3D Concordia game world (`world`/`world-creator`). This is the AI's
internal digital-twin substrate: a per-user entity/relation graph with
forward-simulation and counterfactual comparison over it. Reference app +
parity target: **Palantir Foundry** (entity-graph world model + bounded
simulation) — the closest real analog; there's no consumer-app equivalent.

## Two parallel "worldmodel" backends — read this before touching either

`server.js` (`register("worldmodel", "status"/"create_entity"/"simulate"/
"counterfactual"/"extract_from_dtu"/…, …)`, 16 macros) and
`server/domains/worldmodel.js` (`registerLensAction("worldmodel", "wm_*"/…,
…)`, 27 macros) both register under the domain name `worldmodel`, but they
use **disjoint macro names** (`create_entity` vs `wm_create_entity`,
`status` vs `wm_status`, etc.) so there is no `LENS_ACTIONS`/`MACROS`
collision — both resolve correctly at `/api/lens/run`. They are not
interchangeable:

- **`server.js`'s system** (`STATE.worldModel`) is a single **global**
  entity/relation/simulation store (shared across all users), has a fixed
  `ENTITY_TYPES`/`RELATION_TYPES` enum, per-entity ownership gating on
  update/delete, and `extract_from_dtu` — auto-populates an entity from a
  DTU's title/tags/summary. **It is never called from the frontend** (the
  page exclusively uses the `wm_*` macros below) — confirmed by grep across
  `concord-frontend/`.
- **`server/domains/worldmodel.js`'s system** (`globalThis._concordSTATE
  .worldmodelLens`) is a **per-user** sandbox (`bucket(map, userIdOf(ctx))`)
  with free-form typed schemas, forward-simulation trajectories, scenario
  vs counterfactual comparison, snapshot diff/restore, and a scenario
  library. **This is the one the live page uses**, end to end.
- Neither store is in `server.js`'s `_serializeState()` allowlist nor in
  `lib/lens-state-persistence.js`'s `LENS_STATE_KEYS` — **both are
  in-memory only and do not survive a server restart.** This is a
  pre-existing characteristic of both systems (not something this pass
  introduced or fixed) and is consistent with how the lens is designed:
  bounded scenario sandboxing, not a system of record. Not flagged as a
  defect because nothing in the UI claims persistence-across-restart; noting
  it here so a future pass doesn't assume `saveStateDebounced()` calls in
  the `server.js` system actually persist `STATE.worldModel` — they don't.

The rebuild that shipped the `wm_*` system (`docs/lens-specs/worldmodel.md`,
dated 2026-05-21) deliberately did not extend the old global system —
its header comment says so explicitly. That was the right call for the
per-user CRUD/simulation surface. It left one real gap open, below.

## `node scripts/lens-unsurfaced.mjs --lens worldmodel`

```
worldmodel: 0/26 macros never referenced in the frontend
```

Read this number carefully: the detector only scans
`server/domains/worldmodel.js` for macro definitions — it has **no
visibility into `server.js`'s own 16 `register("worldmodel", …)` calls**,
so it silently can't flag them as unsurfaced. This is the false-negative
mode the task brief warns about ("careful: false negatives if the domain's
registered string differs from the directory name"). Cross-checked by hand:

```
grep -n 'register("worldmodel", "status"\|register("worldmodel", "create_entity"\|register("worldmodel", "extract_from_dtu"' server/server.js
```

confirms 16 additional macros registered directly in `server.js` under the
same domain, none referenced anywhere in `concord-frontend/`.

## Findings

### `extract_from_dtu` — genuinely missing (DEFINING feature, fixed)

Of the 16 unsurfaced `server.js` macros, 15 are the raw JSON-in/out surface
the 2026-05-21 rebuild superseded with real UI (status/CRUD/simulate/
counterfactual/snapshot — the `wm_*` system now covers all of that, with a
UI, and better). One macro stood apart: `extract_from_dtu`
(`server.js:65578`) — given a DTU, creates or reinforces an entity from its
title/tags/summary, the closest thing in the codebase to Foundry's defining
"ingest a document → populate the ontology" capability. It was wired to
*nothing* — not the old raw-JSON UI, not the new `wm_*` page. A digital-twin
lens whose only way to populate its graph is hand-typing entity names, next
to a category leader whose entire value proposition is *automatic*
ingestion, is exactly the "hard 20%" gap CLAUDE.md calls out: the CRUD 80%
(create/edit/relate/simulate/snapshot/compare) is real and well-built, but
the one feature that would make this read as Foundry-caliber rather than a
manual graph editor was absent.

**Triage: ENGINEERING.** No external data dependency — the platform's own
DTU corpus is the source, and the user already picks real DTUs through the
existing `DTUPickerModal` component used elsewhere in the app. Built this
pass rather than deferred again.

**Fix, built against the live per-user system (not the unused global one,
to avoid grounding new entities in a store the page never reads):**

1. `server/domains/worldmodel.js` — new `wm_extract_from_dtu` macro. Takes
   `{ dtuId, title, tags, summary }` (client-supplied, from a DTU the
   `DTUPickerModal` already fetched — server-side lookup of `ctx.state.dtus`
   was considered and rejected: personal-scope DTUs can live in
   `STATE.userUniverses` rather than the global `STATE.dtus` Map, so a
   server-side `.get(dtuId)` could silently 404 on a DTU the user can see;
   the client-supplied fields are exactly the real, already-fetched DTU
   data, not fabricated). Infers a coarse type from tags
   (person/organization/event/location/concept), and is idempotent two ways:
   re-extracting the same DTU into an existing entity just links new
   evidence (`attributes.sourceDtuIds`) instead of duplicating the node;
   extracting a second DTU with the same entity name merges evidence onto
   the existing entity rather than creating a same-named duplicate.
2. `app/lenses/worldmodel/page.tsx` — "Extract from DTU" button next to
   "Create entity" in the Entities tab, opens `DTUPickerModal` (the same
   component `CitePicker`/other lenses already use), calls the new macro on
   selection, and surfaces an honest inline confirmation ("Grounded new
   entity …" / "Linked this DTU as evidence for …"). Entity rows with
   `attributes.sourceDtuIds` now show a small DTU-count badge so
   DTU-grounded nodes are visually distinguished from hand-typed ones in
   the Entities list and (via shared `attributes`) the graph inspector.

## Left alone (already real, already wired)

Everything else: graph visualization (force-directed SVG, `graph` macro),
full entity CRUD + typed schemas (`wm_create_entity`/`update_entity_attrs`/
`define_entity_type`/`list_entity_types`), relation CRUD
(`create_relation_typed`/`update_relation`/`delete_relation`), forward
simulation with charted trajectories (`run_scenario` + `ChartKit`),
scenario-vs-counterfactual comparison (`compare_scenarios`, baseline/cf/
delta charts), snapshot capture/diff/restore (`capture_snapshot`/
`diff_snapshots`/`restore_snapshot`), a scenario library (`save_scenario`/
`list_scenarios`/re-run), live ingestion into entity attributes (`ingest`/
`ingest_log`), and the `WorldModelArxiv` companion panel (live arXiv
world-model research feed with save-as-DTU). All field shapes between the
page and the macro handlers were checked call-by-call this pass and match
exactly — no shape-mismatch defects found. `GraphCanvas.tsx` is a genuine
bespoke force-directed layout (drag, selection, spring/repulsion physics),
not generic scaffold.

## Verification

- `node --check server/domains/worldmodel.js` — OK.
- `cd server && npx eslint domains/worldmodel.js` — clean, 0 errors/warnings.
- `cd concord-frontend && npx eslint app/lenses/worldmodel/page.tsx` — clean, 0 errors/warnings.
- `cd server && node --test tests/worldmodel-domain-parity.test.js tests/worldmodel-lens-macros.test.js tests/depth/worldmodel-behavior.test.js` — 41/41 passing (0 fail), unaffected by the new macro.
- `cd concord-frontend && npx vitest run tests/worldmodel-lens-states.test.tsx` — 6/6 passing.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — worldmodel: `tier: "polished"`, `isGenericScaffold: false`.
- No `npx tsc --noEmit` per standing instruction (prior parallel batch OOM'd the container) — reviewed the new code by hand instead: `DTUPickerModal`'s `onSelect: (dtu: DTU) => void` and the new mutation's `(dtu: DTU) => …` signature line up; `WmEntity.attributes?: Record<string, any>` already permits the new `sourceDtuIds` field (file has `/* eslint-disable @typescript-eslint/no-explicit-any */` at the top, consistent with the rest of the file's existing `any` usage).
