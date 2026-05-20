# environment — Feature Completeness Spec

Rival app(s): Watch Duty, AirVisual, Windy (2026)
Sources:
- https://api.weather.gov/ — NWS active alerts (free, no key)
- https://www.epa.gov/developers — EPA Envirofacts (free, no key)

## Features

### Environmental-monitoring substrate
- [x] Air-quality tracking, hazard watch, conservation logs
- [x] Carbon footprint, water-quality, environmental calculators
- (33 macros)

### Live data & feed
- [x] Live hazard feed — NWS severe weather alerts ingested as DTUs (macro: environment.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Personal air-quality sensor | hardware IoT integration | NWS alert feed + manual readings |

## Verification log
- 2026-05-20: `feed` macro verified (NWS severe alerts → DTUs) by `tests/lens-feeds-domain-parity.test.js`.
- 2026-05-20: `tests/environment-domain-parity.test.js` green.
