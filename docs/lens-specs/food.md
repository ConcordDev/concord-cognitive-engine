# food — Feature Completeness Spec

Rival app(s): Yelp, OpenTable, Toast (restaurant ops) (2026)
Sources:
- https://world.openfoodfacts.org/data — Open Food Facts open product database (free, no key)

## Features

### Food substrate
- [x] Restaurant directory — businesses, reviews, photos, tips, check-ins
- [x] Collections, reservations, waitlist; restaurant ops (recipe scaling, plate costing, pour cost, menu analysis)
- [x] Pantry, meal plans, nutrition log, grocery list, food-discovery dashboard
- (52 macros)

### Live data & feed
- [x] Live food-product feed — Open Food Facts products ingested as DTUs (macro: food.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| POS / payment processing | a payments processor licence | the `accounting` + `wallet` lenses carry transactions |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (Open Food Facts → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` food feed green; `tests/food-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="food"` mounted in the lens page.
