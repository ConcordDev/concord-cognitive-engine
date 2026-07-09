# Forestry Lens — Capability Map (Frontend Rebuild Program, Wave 2 batch 5)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("forestry"' server/domains/forestry.js` → 32
> (+ `forestry.live_gbif`, registered in `server/domains/more-free-apis.js` →
> 33 total real forestry macros).

## Reference apps + parity target

- **USFS Forest Inventory & Analysis (FIA) / iTree** — the reference
  forest-inventory and growth-and-yield modeling toolset (stand volume,
  species composition, biological rotation age). Concord's `timberVolume`,
  `growth-projection`, and `cruise-plot-*`/`cruise-summary` (prism-BAF /
  fixed-radius plot cruising with statistical expansion) macros mirror this.
- **InciWeb / NIFC WFIGS** — the official US wildfire incident + mapped
  perimeter system. Concord's `inciweb-active-fires` and
  `nifc-fire-perimeters` macros call these exact feeds.
- **Verra / Gold Standard-style carbon-credit registries** — issue →
  verify → retire workflow with a serial number. Concord's
  `carbon-credit-issue/verify/retire/list` macros implement the same
  state machine (self-registered, not a real registry integration — the
  UI is honest about `registry: "self-registered"` as the default).
- **Parity target** (owner's framing): the only difference between the
  forestry lens and FIA/iTree + InciWeb/NIFC + a carbon registry combined
  should be UI polish and data scope — every number should trace to a
  real macro (deterministic compute or a live external feed), never a
  fabricated status.

## Checklist — reference-app features vs. Concord forestry

| Feature | Bucket | Disposition |
|---|---|---|
| Managed stand tracking (species, acres, age, density) + silviculture activity log | ALREADY REAL | `forestry.stand-*` + `activity-log` + `forestry-dashboard` → `StandManager` |
| Timber volume estimate (species × age × tree count → board feet) | ALREADY REAL | `forestry.timberVolume` → `ForestryActionPanel` |
| Fire-risk scoring (temp/humidity/wind/drought/fuel moisture) | ALREADY REAL | `forestry.fireRisk` → `ForestryActionPanel` |
| Harvest-schedule planning (clearcut/shelterwood/selective/salvage, staged removal) | ALREADY REAL | `forestry.harvestPlan` → `ForestryActionPanel` |
| Carbon sequestration estimate | ALREADY REAL | `forestry.carbonSequestration` → `ForestryActionPanel` |
| Live active-wildfire incident feed | ALREADY REAL | `forestry.inciweb-active-fires` → `FireIncidents` |
| Mapped fire perimeter GIS data (acreage, map method, polygon date) | **was BACKEND-CAPABLE-BUT-UNSURFACED** | `forestry.nifc-fire-perimeters` had zero UI — **fixed this rebuild**, new section in `FireIncidents` |
| Growth & yield projection over a rotation (MAI/CAI, biological rotation age, site-index scaling) | ALREADY REAL | `forestry.growth-projection` → `GrowthProjectionPanel` |
| GIS stand-polygon mapping (draw a ring, compute acreage/perimeter) | ALREADY REAL | `forestry.stand-polygon-*` → `StandPolygonPanel` |
| Inventory cruise plotting (prism-BAF / fixed-radius, statistical summary with CI) | ALREADY REAL | `forestry.cruise-plot-*` + `cruise-summary` → `CruisePanel` |
| Pest/disease tracking with treatment scheduling | ALREADY REAL | `forestry.pest-*` → `PestPanel` |
| Replanting / silviculture project scheduler + survival surveys | ALREADY REAL | `forestry.replant-*` → `ReplantingPanel` |
| Carbon-credit registry workflow (issue → verify → retire, serial numbers) | ALREADY REAL | `forestry.carbon-credit-*` → `CarbonCreditPanel` |
| Biodiversity / wildlife occurrence search | ALREADY REAL | `forestry.live_gbif` (real GBIF API) → `GbifPanel` |
| Live wildfire feed → DTU ingestion | ALREADY REAL | `forestry.feed` → `StandManager`'s `LensFeedButton` |

Every checklist item resolved to ALREADY REAL or BACKEND-CAPABLE-BUT-UNSURFACED-and-now-fixed. No GENUINELY MISSING items — forestry already had the deepest pre-existing bespoke-component coverage of the three lenses in this batch (9 real components before this rebuild); the only unsurfaced macro was `nifc-fire-perimeters`, and the real defect was the fake tab system crowding all of it behind generic scaffolding.

## What this rebuild fixed

1. **Removed the entire fake "Dashboard / Stands / Harvest / Fire Mgmt /
   Wildlife / Replanting / Inventory / Map" tab system.** All eight tabs
   ran through a single generic `useLensData('forestry', <Stand|Harvest|
   Fire|Wildlife|Replanting|Inventory>, ...)` CRUD store — user-typed
   stand/harvest/fire records with a client-side "New {type}" button and
   a `Zap`/"analyze" action wired to nothing real. **Every one of the 33
   real `forestry.*` macros lived in bespoke components mounted BELOW this
   fake system** (`StandManager`, `ForestryActionPanel`, `FireIncidents`,
   `GrowthProjectionPanel`, `StandPolygonPanel`, `CruisePanel`,
   `PestPanel`, `ReplantingPanel`, `CarbonCreditPanel`) — so the page
   presented an entirely fabricated CRUD front stage in front of a
   fully-real backstage that a user had to scroll past.
2. **Removed the fabricated "Avg Health Score" stat tile** —
   `((stats.matureStands / stands.length) * 100).toFixed(0)}%` computed
   purely from the fake `Stand` CRUD's client-typed `status` field, not
   from any real forestry health signal.
3. **New perimeter section in `FireIncidents`** — surfaces
   `forestry.nifc-fire-perimeters` (mapped GIS fire boundaries: incident
   name, GIS acreage, map method, polygon date/time), the one previously
   fully-unsurfaced macro in the domain, as a toggleable list with
   Save-as-DTU per perimeter.
4. **Removed `<UniversalActions domain="forestry"
   artifactId={items[0]?.id} />`** — `items` came from the now-deleted
   fake CRUD store.
5. **Reorganized into 7 real tabs** (Stands / Calculators / Fire Watch /
   Growth & Inventory / Pests & Replanting / Carbon Credits / Map &
   Wildlife), each mounting the pre-existing real bespoke component(s)
   directly — no scroll-past-the-fake-stuff required anymore.

## Left alone (already real)

`StandManager`, `ForestryActionPanel`, `FireIncidents` (extended, not
replaced), `GrowthProjectionPanel`, `StandPolygonPanel`, `CruisePanel`,
`PestPanel`, `ReplantingPanel`, `CarbonCreditPanel`, `GbifPanel` — all
pre-existing, already macro-backed against real `forestry.*` handlers or
real external APIs (InciWeb, NIFC, GBIF).

## Verification

- `npx eslint app/lenses/forestry/page.tsx components/forestry/FireIncidents.tsx` — clean, 0 errors / 0 warnings.
- `npx tsc --noEmit -p .` — 0 errors project-wide (run together with geology + ocean).
- `tests/forestry-lens-states.test.tsx` (6/6 passing) — targets `StandManager` directly, untouched by this rebuild, still green.
- `node scripts/verify-lens-backends.mjs` — forestry stays WIRED (258/260 total, 0 broken, unchanged from baseline).
- `node scripts/grade-ux-polish.mjs --honest` — forestry: `tier: "polished"`, `isGenericScaffold: false` (was `functional` / `isGenericScaffold: true` before this rebuild).
