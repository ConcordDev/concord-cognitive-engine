# forestry — Feature Completeness Spec

Rival app(s): forest-management tools, InciWeb, NIFC (2026)
Sources:
- https://inciweb.wildfire.gov/ (active US wildfire incidents — live)
- https://www.nifc.gov/ (fire perimeters)
- forest stand-management / silviculture record-keeping

## Features

### Stand management
- [x] Track managed stands — species, acreage, age, density, geo (macro: forestry.stand-add)
- [x] List stands with derived tree-count estimate + total acreage (macro: forestry.stand-list)
- [x] Delete a stand (macro: forestry.stand-delete)
- [x] Log silviculture activities — planting / thinning / harvest / prescribed burn / survey / treatment (macro: forestry.activity-log)
- [x] Forestry dashboard — stands, acres, activities, by-species (macro: forestry.forestry-dashboard)

### Live data & calculators
- [x] Active wildfire feed — InciWeb incidents ingested as DTUs (macro: forestry.feed)
- [x] Active wildfires + perimeters (macro: forestry.inciweb-active-fires / nifc-fire-perimeters)
- [x] Timber volume estimate (macro: forestry.timberVolume)
- [x] Fire risk scoring (macro: forestry.fireRisk)
- [x] Harvest planning (macro: forestry.harvestPlan)
- [x] Carbon sequestration estimate (macro: forestry.carbonSequestration)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| GIS stand boundaries / mapping | a GIS layer engine | lat-lon point per stand + acreage; the `atlas` lens carries mapping |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/forestry.js` clean. 11 macros
  (6 calculators/live data + 4 stand-management substrate + 1 feed).
- 2026-05-20: Tests — `tests/forestry-stand-domain-parity.test.js` 6/6 green
  (stand CRUD + per-user scope + tree estimate + species fallback / activity
  log / dashboard by-species / InciWeb feed → DTUs / calculators intact).
- 2026-05-20: Frontend — new `StandManager` (stand list with activity logging,
  dashboard, live wildfire feed button) mounted in the forestry lens page.
  `npx tsc --noEmit` exit 0.
