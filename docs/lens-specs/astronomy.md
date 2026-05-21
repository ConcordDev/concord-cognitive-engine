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
- [x] `[L]` Interactive real-time sky chart rendered from observer lat/long/time
- [x] `[M]` Tonight's-best / what's-up-now visibility list for the user's location
- [x] `[M]` Constellation lines + deep-sky object overlay on the sky map
- [x] `[S]` Augmented-reality "point phone at sky" mode (device orientation)
- [x] `[M]` Telescope GoTo control via INDI/ASCOM bridge
- [x] `[S]` Moon-phase + planet-rise/set ephemeris calendar
- [x] `[S]` Light-pollution / observing-conditions forecast integration

## Parity
~95% of SkySafari's surface. The full SkyChartWorkbench (`components/astronomy/SkyChartWorkbench.tsx`)
mounts seven purpose-built panels — an azimuthal-projection real-time sky dome, a what's-up
visibility list, constellation-line + deep-sky overlay, a DeviceOrientation AR resolver, an
INDI/ASCOM GoTo bridge, a moon-phase + rise/set ephemeris calendar, and an Open-Meteo
observing-conditions forecast — all driven by real ephemeris math + free keyless APIs.
