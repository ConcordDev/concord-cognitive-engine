# space — Feature Gap vs NASA Eyes / Stellarium / Flightradar-for-launches

Category leader (2026): NASA's Eyes / Heavens-Above / Go4Liftoff. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `space` domain (12 macros). Pure-compute orbital mechanics + live SpaceX API + Launch Library 2 (TheSpaceDevs) + per-user launch watchlist + DTU feed ingest.

## Has (verified in code)
- Orbit calculator (period, velocity, LEO/MEO/GEO classification, escape velocity)
- Delta-V budget analyzer, launch-window estimator, reentry corridor analysis
- Live upcoming launches: SpaceX r-spacex API + universal Launch Library 2 (all providers)
- Personal launch watchlist (track/untrack/mark-watched, days-until sorting)
- Launch feed ingest as visible DTUs

## Missing — buildable feature backlog
- [ ] `[L]` Live ISS / satellite tracking — real-time position over a world map (TLE from Celestrak, free)
- [ ] `[M]` Visible-pass predictions for the user's location (Heavens-Above's core feature)
- [ ] `[M]` 3D orbit visualization — render computed orbits in a globe view
- [ ] `[M]` Launch countdown timers + webcast embeds + push reminders
- [ ] `[S]` Rocket / vehicle detail pages (resolve rocketId from SpaceX API)
- [ ] `[M]` Sky map / planetarium view (planet positions, constellations)
- [ ] `[S]` Launch filtering by provider / orbit / location
- [ ] `[M]` APOD + NASA imagery feed (free NASA API)

## Parity
~50% of the category. The launch-tracking spine (two live APIs, watchlist, feed) and orbital-mechanics calculators are real, but there is no live satellite tracking, no visible-pass prediction, and no 3D/sky visualization.
