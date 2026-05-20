# landscaping — Feature Completeness Spec

Rival app(s): iScape, Gardenize, PlantNet (2026)
Sources:
- https://www.gbif.org/developer/species — GBIF backbone taxonomy (free, no key)
- https://trefle.io/ — Trefle plant database (optional, free key via `TREFLE_API_KEY`)

## Features

### Garden-management substrate (new)
- [x] Garden beds — name, size, sun exposure, soil type (macro: landscaping.bed-add / bed-list / bed-delete)
- [x] Plantings per bed — plant, quantity, planted date, status (macro: landscaping.planting-add)
- [x] Care log — water / fertilize / prune / weed / mulch / pest-treat / harvest (macro: landscaping.care-log)
- [x] Landscaping dashboard — beds, total sqft, plantings, care events (macro: landscaping.landscaping-dashboard)

### Calculators & plant lookup
- [x] Plant selection, irrigation calc, seasonal plan, material estimate
- [x] Trefle plant search + detail (key-gated)

### Live data & feed
- [x] Live plant species feed — GBIF plant species ingested as DTUs (macro: landscaping.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| AR yard visualization | a device camera + AR engine | bed records with size + the `atlas` lens for layout |

## Verification log
- 2026-05-20: Backend — `node --check` clean. Added garden-bed substrate (6 macros) + `feed` (GBIF → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` landscaping substrate + feed green; `tests/landscaping-materials-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="landscaping"` mounted in the lens page.
