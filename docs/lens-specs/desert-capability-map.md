# desert — capability map (Frontend Rebuild Program, Wave 2 batch 5)

Reference apps: **field expedition-planning tools** for arid environments —
the water-budget/heat-index discipline in backcountry-desert survival
guidance (Backpacker/NOLS-style desert protocols: ~1 gal/person/day water
minimum, heat-index-not-just-thermometer risk assessment, terrain-type
navigation hazards) plus a real live-weather source (Open-Meteo), which the
lens already integrates. This supersedes `docs/lens-specs/desert.md` as the
rebuild-program capability-map artifact.

## Backend macro surface (verified via grep, 2026-07-09)

`server/domains/desert.js` (`registerLensAction`, 22 macros):

waterBudget, heatStressIndex, terrainClassification, solarPotential,
routeSave, routeList, routeDelete, routePreview, heatUvAlert, trackedAdd,
trackedDelete, trackedAlerts, nodeSave, nodeList, nodeDelete, nodesNearby,
solarInstall, terrainOverlay, kitSave, kitList, kitToggleItem, kitDelete.

## Pre-existing frontend depth (found BEFORE this rebuild)

`concord-frontend/components/desert/` already had 7 files / ~1,600 LOC of
real, macro-wired UI:

- `ExpeditionPlanner.tsx` — ordered-waypoint route planner with per-leg
  distance/time/water/food computed server-side and rendered on a Leaflet
  map (`routePreview`/`routeSave`/`routeList`/`routeDelete`).
- `HeatUvAlerts.tsx` — tracked-location live heat-index/UV alerts from
  Open-Meteo (`trackedAdd`/`trackedDelete`/`trackedAlerts`/`heatUvAlert`).
- `ResourceNodeMap.tsx` — map-pinned water/shade/hazard/supply-cache nodes
  with proximity query (`nodeSave`/`nodeList`/`nodeDelete`/`nodesNearby`).
- `SolarCalculator.tsx` — off-grid PV-array sizing by load or panel count
  (`solarInstall`).
- `TerrainOverlay.tsx` — multi-sample terrain-class survey with a map
  overlay of classified points (`terrainOverlay`).
- `SurvivalKit.tsx` — per-expedition survival-kit checklist, server-scaled
  to team size and trip length (`kitSave`/`kitList`/`kitToggleItem`/
  `kitDelete`).
- `DesertWeatherWatch.tsx` — real-world current desert conditions via
  Open-Meteo, Save-as-DTU.

Plus `WikipediaSearchPanel` (shared component, real Wikipedia REST search) for
desert-ecology reference lookups.

## What was actually wrong (genuinely broken/generic/fake)

1. **A 14-tab mode switcher with 8 fake tabs sat alongside the 6 real
   feature tabs.** `page.tsx` defined `MODE_TABS` with `Dashboard`,
   `Expeditions`, `Climate`, `Resources`, `Wildlife`, `Infrastructure`,
   `Hazards`, and `Map` — none of these backed by any desert macro. They ran
   on `useLensData('desert', currentType, …)`, the generic per-lens artifact
   store, producing fabricated lists with client-invented fields
   (`sandstormRisk`, `sustainability`, a freehand `status` string) that no
   backend macro ever computes.
   - `Expeditions` and `Climate` were straight **duplicates** of the real
     `Route Planner` and `Heat & UV` tabs — two different "expedition" lists
     and two different "climate" surfaces on one page, one real (macro-backed)
     and one fake (local CRUD demo).
   - `Wildlife` and `Infrastructure` had **zero backing macro of any kind** —
     server/domains/desert.js has no wildlife or infrastructure registration
     — yet rendered as if they were live tracked data, with a stat card
     mislabeled "Species Cataloged" that was actually counting `Resource`
     artifacts (desert resource *nodes*, not species). This is precisely the
     "zero demo content" violation CLAUDE.md calls out: a surface presenting
     fabricated data as live.
   - `Hazards` likewise had no backing macro.
   - `Dashboard`/`Map` duplicated real data (expedition counts, lat/lng
     markers) but through the fake store rather than the real one.
   **All 8 fake tabs removed** (~280 lines), along with the top-level
   `useLensData('desert', 'Expedition'|'Climate'|'Resource', …)` calls that
   fed them.
2. **Generic scaffold signature.** The page imported the `ManifestActionBar`
   + `AutoActionStrip` + `RecentMineCard` trio and rendered
   `<UniversalActions>` plus a misleadingly-commented "accessibility-only,
   never visually displayed" block that in fact rendered `RecentMineCard` +
   `AutoActionStrip` + `CrossLensRecentsPanel` visibly. `node
   scripts/grade-ux-polish.mjs --honest` confirmed the cap pre-change:
   `tier: "functional"`, `isGenericScaffold: true`, despite 79% bespoke LOC.
   **Removed.**
3. **Four pure-compute macros had zero UI**: `waterBudget` (rainfall vs.
   evaporation balance for a survey area, arid classification, irrigation
   need), `heatStressIndex` (temperature/humidity/wind → heat-index risk
   grade with recommendations), `terrainClassification` (single-point
   elevation/soil/vegetation/slope → erg/hamada/reg/sabkha/playa
   classification + traversability), `solarPotential` (latitude/clear-days
   → regional solar-yield estimate) — no frontend reference to any of the
   four prior to this rebuild.

## Reference-parity checklist (desert field-expedition-planning shape)

The only difference from a professional desert field-ops toolkit should be
catalog/dataset scale (a real expedition's full waypoint/node history) and
live-sensor integration depth, nothing else in the planning workflow.

| Capability | Disposition | Where |
|---|---|---|
| Live current weather for a location | ALREADY REAL | `DesertWeatherWatch` (Open-Meteo) |
| Waypoint route planning with per-leg distance/time | ALREADY REAL | `ExpeditionPlanner` (`routePreview`) |
| Per-leg water/food logistics (terrain-scaled) | ALREADY REAL | `ExpeditionPlanner` (`routePreview`) |
| Saved/reusable routes | ALREADY REAL | `ExpeditionPlanner` (`routeSave`/`routeList`/`routeDelete`) |
| Live heat-index/UV alerts for tracked locations | ALREADY REAL | `HeatUvAlerts` (`trackedAdd`/`trackedAlerts`) |
| Ad-hoc heat/UV lookup for any point | ALREADY REAL | `HeatUvAlerts` (`heatUvAlert`) |
| Water/shade/hazard/supply-cache resource mapping | ALREADY REAL | `ResourceNodeMap` (`nodeSave`/`nodeList`) |
| Proximity query for nearby resources | ALREADY REAL | `ResourceNodeMap` (`nodesNearby`) |
| Off-grid solar-array sizing | ALREADY REAL | `SolarCalculator` (`solarInstall`) |
| Multi-sample terrain-class survey + map overlay | ALREADY REAL | `TerrainOverlay` (`terrainOverlay`) |
| Per-expedition survival-kit checklist | ALREADY REAL | `SurvivalKit` (`kitSave`/`kitToggleItem`) |
| Desert-ecology reference lookup | ALREADY REAL | `WikipediaSearchPanel` |
| Regional water-budget / aridity assessment | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `DesertFieldCalcPanel.tsx` (`waterBudget`) |
| One-shot heat-stress risk calculator | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `DesertFieldCalcPanel.tsx` (`heatStressIndex`) |
| Single-point terrain classification | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `DesertFieldCalcPanel.tsx` (`terrainClassification`) |
| Regional solar-potential estimate | WAS BACKEND-CAPABLE-BUT-UNSURFACED → **now surfaced** | new `DesertFieldCalcPanel.tsx` (`solarPotential`) |
| Wildlife tracking / species catalog | GENUINELY MISSING | Deferred — no wildlife macros exist server-side; the previous "Wildlife" tab was 100% fabricated (a stat card mislabeled "Species Cataloged" actually counted resource nodes) and has been removed rather than kept as a fake surface. A real build needs a new backend domain — out of scope for a UI-polish batch. |
| Infrastructure/hazard incident reporting | GENUINELY MISSING | Deferred — same as above; no backing macro, previously rendered via the same fake generic-CRUD store. Removed. |
| Offline map caching for no-signal fieldwork | GENUINELY MISSING | Deferred — would need a client-side tile-cache layer Concord doesn't have; out of scope for a UI-polish batch. |

Overall: this lens's **components/** directory was already close to
professional field-expedition-planning parity (7 files, all real, all
macro-wired). The defect was entirely in `page.tsx`'s outer tab shell: 8 fake
tabs (2 duplicating real functionality, 3 with zero backend at all) built on
a disconnected generic CRUD store, the generic scaffold trio, and four
unsurfaced calculators. Fixed all of it; the fake wildlife/infrastructure/
hazards surfaces were removed rather than preserved, per the zero-demo-content
invariant — a missing capability gets an honest disposition, not a fake UI.

## Verify gate

- `npx eslint app/lenses/desert/page.tsx components/desert/DesertFieldCalcPanel.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- No `desert`-specific vitest file exists in `concord-frontend/tests/` prior
  to or after this change (checked via `find ... -iname "*desert*.test.*"`) —
  noted rather than silently skipped.
- `node scripts/verify-lens-backends.mjs` — desert stays WIRED; total
  `{"WIRED":258,"NO-BACKEND-CALL":2}` unchanged.
- `node scripts/grade-ux-polish.mjs --honest` — desert: `tier: "polished"`,
  `isGenericScaffold: false` (was `functional` / `true`).
