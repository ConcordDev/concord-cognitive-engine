# fitness — Feature Completeness Spec

Rival app(s): Strava, Apple Fitness, Whoop (2026)
Sources:
- https://wger.de/en/software/api — wger open workout database (free, no key)

## Features

### Training substrate
- [x] Workouts, activities, routes, segments + segment efforts
- [x] Recovery + HRV samples, goals, gear, clubs, challenges
- [x] Fitness dashboard — activity count, distance, recovery trend
- (46 macros)

### Live data & feed
- [x] Live exercise feed — wger exercise database ingested as DTUs (macro: fitness.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Wearable device sync | Apple Health / Garmin SDK | manual activity + HRV entry |
| Live GPS route recording | a device GPS stream | route records with manual distance |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (wger exercises → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` fitness feed green; `tests/fitness-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="fitness"` mounted in the lens page.
