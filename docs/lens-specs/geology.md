# geology — Feature Completeness Spec

Rival app(s): USGS Earthquakes, Mindat (2026)
Sources:
- https://earthquake.usgs.gov/ (live earthquake feed, seismic hazard)
- https://www.mindat.org/ (mineral + locality database, field observations)

## Features

### Live data & calculators
- [x] Recent earthquakes — live USGS feed (macro: geology.recent-earthquakes)
- [x] USGS seismic hazard lookup (macro: geology.usgs-seismic-hazard)
- [x] Rock classification (macro: geology.rockClassify)
- [x] Mineral identification (macro: geology.mineralId)
- [x] Seismic risk scoring (macro: geology.seismicRisk)
- [x] Stratigraphic column builder (macro: geology.stratigraphicColumn)

### Field observation log (Mindat shape)
- [x] Log an observation — name, kind (rock/mineral/fossil/outcrop/structure/other), lat-lon, location, formation, notes, tags (macro: geology.observation-log)
- [x] List + filter by kind / tag / query (macro: geology.observation-list)
- [x] Update + delete observations (macro: geology.observation-update / observation-delete)
- [x] Field dashboard — totals, by-kind breakdown, geotagged count, distinct formations (macro: geology.field-dashboard)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| The full Mindat mineral database | a licensed mineralogy dataset | mineralId classifier + a personal field-observation log |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/geology.js` clean. 11 macros.
- 2026-05-20: Tests — `tests/space-geology-domain-parity.test.js` (geology half)
  green — observation-log + per-user scope, unknown-kind fallback, kind filter,
  update/delete, field-dashboard geotag count.
- 2026-05-20: Frontend — new `FieldLog` (kind-tagged observation journal with
  a dashboard) mounted in the geology lens page. `tsc` exit 0.
