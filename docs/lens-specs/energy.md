# energy — Feature Completeness Spec

Rival app(s): Sense, Span, utility-provider apps (2026)
Sources:
- https://carbonintensity.org.uk/ — National Grid ESO Carbon Intensity API (free, no key)

## Features

### Energy-monitoring substrate
- [x] Devices, meter readings, solar production, tariff rates
- [x] Consumption goals, alerts, cost + solar-offset dashboard
- (24 macros)

### Live data & feed
- [x] Live grid carbon feed — GB grid carbon-intensity periods ingested as DTUs (macro: energy.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Real-time smart-meter telemetry | hardware metering integration | manual + scheduled meter readings |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (UK Carbon Intensity → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` energy feed green; `tests/energy-domain-parity.test.js` + `tests/energy-monitor-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="energy"` mounted in the lens page.
