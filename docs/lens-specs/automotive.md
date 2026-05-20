# automotive — Feature Completeness Spec

Rival app(s): CARFAX Car Care, Drivvo, FIXD (2026)
Sources:
- https://www.nhtsa.gov/nhtsa-datasets-and-apis — NHTSA recalls + vPIC (free, no key)

## Features

### Garage substrate
- [x] Vehicles, service records, fuel log, expense tracking
- [x] Maintenance schedules, VIN decode, recall lookup, automotive calculators
- (33 macros)

### Live data & feed
- [x] Live recall feed — NHTSA vehicle recalls ingested as DTUs (macro: automotive.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| OBD-II live telemetry | a Bluetooth OBD dongle | manual service + fuel records |

## Verification log
- 2026-05-20: `feed` macro verified (NHTSA recalls → DTUs) by `tests/lens-feeds-domain-parity.test.js`.
- 2026-05-20: `tests/automotive-domain-parity.test.js` green.
