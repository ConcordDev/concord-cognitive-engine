# ocean — Feature Completeness Spec

Rival app(s): Windy, NOAA Tides, Surfline / dive-log apps (2026)
Sources:
- https://tidesandcurrents.noaa.gov/ (NOAA tide + water-level + station API — live)
- Surfline / dive-log apps (saved spots + session logs)

## Features

### Live ocean data
- [x] NOAA tide predictions + water level + station lookup (macro: ocean.noaa-tide-prediction / noaa-water-level / noaa-stations)
- [x] Wave analysis (macro: ocean.waveAnalysis)
- [x] Tidal prediction calculator (macro: ocean.tidalPrediction)
- [x] Salinity profile (macro: ocean.salinityProfile)
- [x] Marine ecosystem health (macro: ocean.marineEcosystem)

### Spot log (surf / dive / fishing tracker)
- [x] Save ocean spots — name, kind (surf/dive/fishing/swim), lat-lon, NOAA station, notes (macro: ocean.spot-add)
- [x] List + filter spots by kind, with session counts (macro: ocean.spot-list)
- [x] Delete a spot — cascades its sessions (macro: ocean.spot-delete)
- [x] Log a session — date, wave height, water temp, conditions, 1-5 rating (macro: ocean.session-log)
- [x] List + delete sessions, filterable by spot (macro: ocean.session-list / session-delete)
- [x] Ocean dashboard — spots, sessions, by-kind, average rating (macro: ocean.ocean-dashboard)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Live forecast overlays (Windy-style wind/swell maps) | a meteorological tile service | NOAA tide/water-level live data + a personal session log capturing observed conditions |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/ocean.js` clean. 13 macros
  (7 live data/analysis + 6 spot-log substrate).
- 2026-05-20: Tests — `tests/ocean-spotlog-domain-parity.test.js` 8/8 green
  (spot CRUD + per-user scope + kind fallback + cascade-delete / session log +
  unknown-spot reject + delete / dashboard avg rating + by-kind / analysis
  macros intact).
- 2026-05-20: Frontend — new `SpotLog` (spot list by kind, per-spot session
  logging with wave/temp/rating) mounted in the ocean lens page.
  `npx tsc --noEmit` exit 0.
