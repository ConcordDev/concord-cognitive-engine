# travel — Feature Completeness Spec

Rival app(s): TripIt, Google Travel, Hopper (2026)
Sources:
- https://restcountries.com/ — REST Countries API (free, no key)

## Features

### Trip substrate
- [x] Trips, itinerary, places + place reviews, bookings
- [x] Price watches, budgets, travel documents, checklists
- [x] Travel dashboard — next trip, price watches, saved places, total booked
- (37 macros)

### Live data & feed
- [x] Live country-guide feed — REST Countries profiles ingested as DTUs (macro: travel.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Live flight / hotel pricing | a GDS or aggregator licence | manual booking records + price watches |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (REST Countries → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` travel feed green; `tests/travel-domain-parity.test.js` + `tests/travel-trips-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="travel"` mounted in the lens page.
