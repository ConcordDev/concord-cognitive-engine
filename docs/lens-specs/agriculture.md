# agriculture — Feature Completeness Spec

Rival app(s): Climate FieldView, FarmLogs, Granular (2026)
Sources:
- https://api.worldbank.org/v2/ — World Bank Open Data (crop-yield indicators, free, no key)

## Features

### Farm-record substrate
- [x] Fields (canonical farm record) — crop, acreage, geo, soil
- [x] Scouting pins, crop rotation history, season planning
- [x] Yield + grain-storage tracking, agriculture dashboard
- (49 macros — full per-(domain,macro) inventory via `npm run cartograph:static`)

### Live data & feed
- [x] Live crop-yield feed — World Bank cereal-yield indicators ingested as DTUs (macro: agriculture.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Satellite NDVI imagery | a paid imagery provider | scouting pins + manual field records |
| Per-field real-time soil sensors | hardware IoT integration | manual soil + moisture records |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (World Bank crop yields → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` agriculture feed green; `tests/agriculture-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="agriculture"` mounted in the lens page.
