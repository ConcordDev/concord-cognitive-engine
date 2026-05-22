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
- [x] `[L]` Live ISS / satellite tracking — real-time position over a world map (`iss-track` + `iss-groundtrack`, wheretheiss.at, 5s refresh)
- [x] `[M]` Visible-pass predictions for the user's location (`iss-passes`, geometry over real ground-track data)
- [x] `[M]` 3D orbit visualization — render computed orbits in a globe view (`orbit-3d`, rotatable isometric globe)
- [x] `[M]` Launch countdown timers + webcast embeds + push reminders (`launch-countdown`, SpaceX + LL2, YouTube embed + Notification reminder)
- [x] `[S]` Rocket / vehicle detail pages (`rocket-detail`, resolves rocketId from SpaceX API)
- [x] `[M]` Sky map / planetarium view (`sky-map`, J2000 ephemeris planet positions on a horizon dome)
- [x] `[S]` Launch filtering by provider / orbit / location (`launches-filtered`, LL2 with facet dropdowns)
- [x] `[M]` APOD + NASA imagery feed (`apod`, free NASA API — keyless DEMO_KEY)

## Parity
~90% of the category. The launch-tracking spine, orbital-mechanics calculators, live ISS tracking, visible-pass prediction, 3D orbit + sky-map visualization, countdowns with webcasts and NASA imagery are all real. Surfaced in the Live Observatory deck (`components/space/SpaceObservatory.tsx`).
