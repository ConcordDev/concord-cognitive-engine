# aviation — Feature Completeness Spec

Rival app(s): ForeFlight, FlightAware, Garmin Pilot (2026)
Sources:
- https://api.aviationapi.com/ — airport / frequency / runway data (free, no key)
- https://opensky-network.org/ — live aircraft states (free, no key)

## Features

### Flight-ops substrate
- [x] Aircraft, logbook, flight plans, airport directory
- [x] Weight & balance, fuel planning, weather briefing, aviation calculators
- (42 macros)

### Live data & feed
- [x] Live aircraft feed — OpenSky live aircraft states ingested as DTUs (macro: aviation.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Certified moving-map navigation | an avionics-grade chart engine | airport directory + flight-plan records |

## Verification log
- 2026-05-20: `feed` macro verified (OpenSky → DTUs) by `tests/lens-feeds-domain-parity.test.js`.
- 2026-05-20: `tests/aviation-domain-parity.test.js` green.
