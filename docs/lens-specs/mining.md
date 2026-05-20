# mining — Feature Completeness Spec

Rival app(s): mine-management / MineHub, MSHA Mine Data Retrieval, USGS (2026)
Sources:
- https://datamine.msha.gov/ (MSHA open mine + violation data — live)
- mine-operations / safety record-keeping

## Features

### Mine-operations management
- [x] Track managed sites — kind, commodity, production tonnes, status (macro: mining.site-add)
- [x] List sites with derived incident count (macro: mining.site-list)
- [x] Update site status / production (macro: mining.site-update)
- [x] Delete a site (macro: mining.site-delete)
- [x] Log safety incidents — near_miss / minor / serious / fatal (macro: mining.incident-log)
- [x] Operations dashboard — sites, active, total production, serious incidents (macro: mining.mining-dashboard)

### Live data & calculators
- [x] MSHA mine + violation lookup (macro: mining.msha-* — ingested as DTUs)
- [x] Grade / blast / safety / resource calculators (MiningActionPanel)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| GIS pit / bench mapping | a GIS layer engine | lat-lon-free site records + the `atlas` lens carries mapping |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/mining.js` clean. Site
  substrate (6 macros) appended to the MSHA lookup domain.
- 2026-05-20: Tests — `tests/mining-site-domain-parity.test.js` 5/5 green
  (site CRUD + per-user scope + kind fallback / incident log / dashboard
  serious-incident aggregation).
- 2026-05-20: Frontend — new `MineSiteManager` (site list with incident
  logging + dashboard) mounted in the mining lens page. `npx tsc --noEmit`
  exit 0.
