# cooking — Feature Completeness Spec

Rival app(s): Paprika, Mealime, NYT Cooking (2026)
Sources:
- https://www.themealdb.com/api/ — TheMealDB recipe database (free, public test key)

## Features

### Recipe & meal-planning substrate
- [x] Recipes, collections, recipe import + scaling
- [x] Meal plan (per-day/slot), shopping list, pantry tracking
- [x] Cooking dashboard — planned meals, shopping progress, pantry count
- (31 macros)

### Live data & feed
- [x] Live recipe feed — TheMealDB recipes (ingredients + instructions) ingested as DTUs (macro: cooking.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Barcode pantry scanning | a device camera + barcode DB | manual pantry entry |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (TheMealDB recipes → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` cooking feed green; `tests/cooking-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="cooking"` mounted in the lens page.
