# astronomy — Feature Completeness Spec

Rival app(s): SkySafari, Stellarium, NASA app (2026)
Sources:
- https://api.nasa.gov/ — NASA APOD (free, DEMO_KEY)
- https://wheretheiss.at/ — ISS position (free, no key)

## Features

### Sky-watch substrate
- [x] Observation log, target list, equipment, sky-watch sessions
- [x] ISS pass prediction, planet visibility, astronomy calculators
- (32 macros)

### Live data & feed
- [x] Live astronomy feed — NASA Astronomy Picture of the Day ingested as DTUs (macro: astronomy.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Telescope GoTo control | a hardware mount driver (ASCOM/INDI) | target list + session log |

## Verification log
- 2026-05-20: `feed` macro verified (NASA APOD → DTUs) by `tests/lens-feeds-domain-parity.test.js`.
- 2026-05-20: `tests/astronomy-domain-parity.test.js` + `tests/astronomy-skywatch-domain-parity.test.js` green.
