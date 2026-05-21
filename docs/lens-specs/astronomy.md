# astronomy — Feature Gap vs SkySafari / Stellarium

Category leader (2026): SkySafari / Stellarium. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/astronomy.js` — 31 macros: celestialPosition, planObservation, lightTravelTime, orbitalMechanics, APOD, ISS location, near-earth-objects, targets CRUD, observation log, sessions, equipment, wishlist, events, catalog import, dashboard, feed.

## Has (verified in code)
- Celestial object catalog (star/planet/moon/asteroid/comet/galaxy/nebula) with RA/dec/magnitude
- Observation log, target list, sky-watch sessions, equipment registry, wishlist
- Celestial-position + light-travel-time + orbital-mechanics calculators
- ISS pass prediction + live ISS location; near-earth-objects tracking
- NASA APOD live feed; SpaceflightNews + UpcomingLaunches panels
- AstronomySkySection sky-map; NasaExplorer; event tracking; dashboard

## Missing — buildable feature backlog
- [ ] `[L]` Interactive real-time sky chart rendered from observer lat/long/time
- [ ] `[M]` Tonight's-best / what's-up-now visibility list for the user's location
- [ ] `[M]` Constellation lines + deep-sky object overlay on the sky map
- [ ] `[S]` Augmented-reality "point phone at sky" mode (device orientation)
- [ ] `[M]` Telescope GoTo control via INDI/ASCOM bridge
- [ ] `[S]` Moon-phase + planet-rise/set ephemeris calendar
- [ ] `[S]` Light-pollution / observing-conditions forecast integration

## Parity
~55% of SkySafari's surface. Strong observation-logging and live-data substrate (ISS, APOD, NEOs), but the defining feature — an interactive real-time rendered sky chart — is the major gap.
