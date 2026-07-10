# Manufacturing Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("manufacturing"' server/domains/manufacturing.js
```
→ **34** macros in `server/domains/manufacturing.js` (807 lines): 4 legacy
compute-on-supplied-data macros (`scheduleOptimize`, `bomCost`,
`oeeCalculate`, `safetyRate`), a real MES parity surface (`oee-status`,
`work-orders`, `spc-chart` — each honestly empty-by-design until a real
MES/SCADA/ERP feed is wired, per their own `source:"empty"` responses), 8
MES features backed by real in-memory state (digital work instructions,
IoT/machine state, finite-capacity scheduling, lot traceability, andon,
NCR/CAPA, preventive maintenance, WIP inventory — 22 macros total), and 4
more compute-on-supplied-data work-order tools (`advanceStep`,
`defectAnalysis`, `generateTraveler`, `logDowntime`).

## Frontend surface (8 files, 2,317 LOC per `grade-ux-polish.mjs`)

`concord-frontend/app/lenses/manufacturing/page.tsx` (259 LOC) +
`concord-frontend/components/manufacturing/{ManufacturingActionPanel,
ManufacturingFeed,OEEDashboard,QualitySPC,ShopFloorSuite,
WorkOrderBoard,ShopFloorToolsPanel}.tsx`.

`ShopFloorSuite.tsx` (1,017 LOC, header comment: "Every value rendered
comes from a real macro call — no seed/mock data") alone wires all 22 MES
feature macros across 8 tabs (work instructions, machine/IoT, Gantt
scheduling, lot traceability, andon, NCR/CAPA, maintenance, WIP
inventory). `OEEDashboard`/`WorkOrderBoard`/`QualitySPC` each wire one
real read macro (`oee-status`/`work-orders`/`spc-chart`).
`ManufacturingActionPanel.tsx` wires the 4 legacy compute macros
(`oeeCalculate`/`bomCost`/`safetyRate`/`scheduleOptimize`) via structured
number inputs + JSON-paste for the array-shaped ones (BOM components,
safety incidents, work-order list) — its own header comment notes field
names are aligned exactly to the real handler contract, no fabricated
fields. Before this pass, **30 of 34 macros already had real, wired UI**.

## The defect: the same fabricated parallel generic-CRUD dashboard pattern
## as `logistics`, plus 4 unsurfaced work-order tools

`app/lenses/manufacturing/page.tsx` had the identical defect shape found
in `logistics` this same wave:

1. A real MES system: `OEEDashboard` / `WorkOrderBoard` / `QualitySPC` /
   `ShopFloorSuite` (all wired to real macros) + `ManufacturingActionPanel`
   / `ManufacturingFeed` (always mounted below).
2. A fabricated one: a `MODE_TABS` nav with 7 tabs (`dashboard` /
   `work_orders` / `bom` / `quality` / `scheduling` / `machines` /
   `safety`) driving ~1,850 lines of `render*()` functions reading from
   `useLensData('manufacturing', currentType, {...})` — a generic artifact
   CRUD store (`GET/POST/PUT/DELETE /api/lens/manufacturing`) with **no
   relationship to any of the 34 real `manufacturing.*` macros**. `SEED`
   was empty for every artifact type and `BOM_TREE` was a dead empty
   constant.

Same dead-button consequence as logistics: a "Domain Actions" strip
(`scheduleOptimize` / `bomCost` / `oeeCalculate` / `safetyRate` /
`defectAnalysis`) was wired through `useRunArtifact('manufacturing')
.mutateAsync({ id: targetId, action })` where `targetId` came from the
same empty generic-CRUD `filtered[0]?.id` — dead on a fresh install, and
field-shape-mismatched even with a fake artifact present (e.g.
`defectAnalysis` reads `artifact.data.defects`, but a fake "SafetyItem"
artifact has fields like `type`/`severity`/`date` at the top level, never
a `defects` array).

Separately: `advanceStep`, `defectAnalysis`, `generateTraveler`, and
`logDowntime` had **no real UI at all** beyond that same dead strip —
confirmed by cross-referencing the full macro list against every
`lensRun`/`run(` call site in `ShopFloorSuite.tsx`,
`ManufacturingActionPanel.tsx`, `OEEDashboard.tsx`, `QualitySPC.tsx`, and
`WorkOrderBoard.tsx` (30 of 34 accounted for; these 4 were not).

## What changed

1. **Removed the fabricated generic-CRUD system** — `SEED`, `ArtifactType`,
   `BOM_TREE`/`calcBOMCost` (dead, empty constant), `useLensData`/
   `useRunArtifact` usage, `STATUS_COLORS`/`WO_STATUSES`/
   `computeDashboardMetrics`, the editor modal (`fieldConfig`/
   `formFields`), and all seven `render*()` fake-dashboard functions —
   roughly 1,900 lines of fabricated CRUD UI backed by nothing.
2. **Reduced `MODE_TABS` to 5 tabs, each mounting a real, already-existing
   or newly-built macro-backed component**: `oeeBoard` → `OEEDashboard`,
   `woBoard` → `WorkOrderBoard`, `spc` → `QualitySPC`, `shopFloor` →
   `ShopFloorSuite`, `tools` → new `ShopFloorToolsPanel`.
3. **Wired the KPI strip to real live data** — `oee-status` (machine
   count + running count), `work-orders` (order count), `andon-board`
   (open/critical alert counts), `ncr-list` (open NCR count), aggregated
   client-side via `Promise.all` (there's no single
   `manufacturing.dashboard-summary` macro the way `logistics` has one).
4. **Built `components/manufacturing/ShopFloorToolsPanel.tsx`** (new,
   ~330 LOC) — fixes the dead-button/field-shape bug for the 4 previously
   unsurfaced work-order tools with real structured forms (not JSON
   paste, unlike the pre-existing `ManufacturingActionPanel` convention —
   these four take small enough inputs — comma-separated step lists,
   defect type/severity rows, machine/reason/duration fields — that a
   real form is both possible and clearly better UX than JSON):
   - **Advance routing step**: work-order title + comma-separated step
     names + current step index → `advanceStep`.
   - **Defect analysis**: add/remove defect type+severity rows + units
     inspected → `defectAnalysis`.
   - **Generate routing traveler**: part number + quantity + comma-
     separated steps → `generateTraveler` (renders the real monospace
     traveler text the macro returns).
   - **Log machine downtime**: machine + reason + duration + planned
     shift minutes → `logDowntime`.
   All four call `lensRun` directly with no persisted artifact (per the
   `/api/lens/run` virtual-artifact-from-input-body pattern), so they
   work immediately on a fresh install.

## Macro → UI classification (post-fix)

- **DESIGNED (34 of 34):** every macro now has a dedicated, bespoke,
  wired UI entry point — `ShopFloorSuite` (22), `OEEDashboard`/
  `WorkOrderBoard`/`QualitySPC` (3), `ManufacturingActionPanel` (4),
  `ShopFloorToolsPanel` (4, newly wired this pass). None reached only
  through a generic action array.

## Confirmed real and left alone, with reason

- `manufacturing.oee-status` / `work-orders` / `spc-chart` correctly
  return `{ source: "empty", notes: "..." }` until a real MES/SCADA/ERP
  feed is wired (OPC-UA, MQTT Sparkplug B, MTConnect, or an ERP webhook)
  — this is the honest behavior per the domain file's own "everything
  must be real" comment, not a defect. `OEEDashboard`/`WorkOrderBoard`/
  `QualitySPC` already render this as a real empty state.
- `ManufacturingActionPanel`'s JSON-paste inputs for BOM components /
  safety incidents / work-order lists were left as-is (not rebuilt into
  structured forms this pass) — these are genuinely variable-shaped
  nested arrays (a BOM has an arbitrary number of components, each with
  its own fields) where a JSON editor is a defensible, already-documented
  power-user affordance (the file's own comment explains the field
  mapping is exact, not fabricated), and rebuilding it was out of scope
  for a defect-fix pass whose primary target was the fabricated-CRUD
  duplication and the 4 fully-unsurfaced macros.

## Verification

- `node --check server/domains/manufacturing.js` → OK (backend untouched
  this pass; checked defensively since input shapes were audited).
- `cd server && node --test tests/depth/manufacturing-behavior.test.js
  tests/depth/manufacturing-workorder-behavior.test.js
  tests/manufacturing-domain-parity.test.js
  tests/manufacturing-lens-macros.test.js` → **53/53 passing**,
  unmodified.
- `cd concord-frontend && npx eslint app/lenses/manufacturing/page.tsx
  components/manufacturing/*.tsx` → clean, 0 errors/warnings.
- `cd concord-frontend && npx tsc --noEmit -p .` → 0 errors referencing
  `manufacturing`.
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,
  "NO-BACKEND-CALL":2}` total 260 (unchanged; manufacturing was already
  WIRED and remains so).
- `node scripts/grade-ux-polish.mjs --honest` → manufacturing: `tier:
  "polished"`, `isGenericScaffold: false`, `bespokeRatio: 0.888`,
  `pillarsPresent: 5`.
