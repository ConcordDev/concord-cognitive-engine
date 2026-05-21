# ocean — Feature Gap vs Windy / MarineTraffic

Category leader (2026): Windy.com + MarineTraffic (the consumer maritime/ocean tools). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/ocean.js` — 12 macros (wave/tidal/salinity/ecosystem compute, real NOAA Tides & Currents tide-prediction / water-level / station lookup, per-user surf/dive spot log + sessions, NWS marine-alert DTU feed); page also uses generic `/api/lens` artifact store for Vessels/Research/Marine/Ports.

## Has (verified in code)
- Real NOAA CO-OPS tide predictions (hi/lo), observed water level, station directory by state — `NoaaTidesPanel`, `TidePredictions`.
- Wave analysis (Beaufort, energy density, sea state), tidal sin-curve, salinity/halocline profile, marine ecosystem Shannon diversity.
- Surf/dive/fishing spot log with rated session history + dashboard; NWS active marine-alert ingestion as DTUs.
- Vessels/Research/Marine/Ports CRUD with map markers (Leaflet), depth-zone visualization, Wikipedia oceanography reference.

## Missing — buildable feature backlog
- [ ] `[M]` Live AIS vessel positions — pull free AIS feed (aisstream.io / aishub) instead of manual vessel CRUD.
- [ ] `[M]` Marine weather forecast overlay — Open-Meteo Marine API for wave height/period/swell forecast on the map.
- [ ] `[S]` Surf-spot conditions score — combine swell + wind + tide into a daily surf rating per saved spot.
- [ ] `[M]` Buoy data — NOAA NDBC real-time buoy observations (wave, wind, water temp) near a spot.
- [ ] `[S]` Tide alerts/reminders — notify on next high/low or favorable spot windows.
- [ ] `[M]` Sea surface temperature map layer — NOAA/NASA SST tiles.
- [ ] `[S]` Catch/dive logbook export — GPX/CSV export of sessions.

## Parity
~50% of Windy/MarineTraffic's feature surface. Strong on real tide data and a genuine spot logbook, but lacks live AIS tracking and marine forecasting — the two things those leaders are actually used for.
