# emergency-services — Feature Completeness Spec

Rival app(s): CAD systems (Tyler, Central Square), PulsePoint (2026)
Sources:
- https://earthquake.usgs.gov/earthquakes/feed/ — USGS Earthquake Hazards Program (free, no key)

## Features

### Field calculators
- [x] Triage assessment (START protocol), dispatch optimization
- [x] Incident log analysis, resource readiness scoring

### Computer-aided-dispatch substrate (new)
- [x] Incidents — summary, kind, priority 1–5, location, status (macro: emergency-services.incident-create / incident-list / incident-status)
- [x] Units — name, kind, status, station (macro: emergency-services.unit-add / unit-list)
- [x] EMS dashboard — open incidents, available units, by-kind (macro: emergency-services.ems-dashboard)

### Live data & feed
- [x] Live seismic-event feed — USGS significant earthquakes ingested as DTUs (macro: emergency-services.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| 911 call-taking integration | a telephony / NG911 backend | manual incident creation |
| Live AVL unit GPS | hardware vehicle telematics | manual unit status |

## Verification log
- 2026-05-20: Backend — built from a 4-macro stub: kept 4 calculators, added a 6-macro CAD substrate + `feed` (USGS → DTUs). `node --check` clean.
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` emergency-services substrate + feed + calculator-intact cases green.
- 2026-05-20: Frontend — `LensFeedButton domain="emergency-services"` mounted in the lens page.
