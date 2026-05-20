# atlas — Feature Completeness Spec

Rival app(s): Google Maps, Felt (2026)
Sources:
- https://maps.google.com/ (place search, directions, saved places, Lists, trips, Immersive Navigation, Ask Maps)
- Web search 2026-05-20: Google Maps 2026 update — Immersive Navigation (3D), Ask Maps (AI route assistant: add stops along a route, route tradeoffs)
- Live data: Nominatim (geocode), Overpass (POI), OSRM (routing)

## Features

### Search & geocode
- [x] Place search + reverse geocode (macro: atlas.geocode / nominatim-geocode / nominatim-reverse)
- [x] POI category browse via Overpass (macro: atlas.overpass-poi)
- [x] Region statistics (macro: atlas.regionStats)
- [x] Recent searches — list / record / clear (macro: atlas.recent-searches-*)

### Saved places & lists
- [x] Saved places CRUD (macro: atlas.places-list / places-save / places-update / places-delete)
- [x] Lists — create / add / remove / delete (macro: atlas.lists-*)

### Directions & trips
- [x] Turn-by-turn directions via OSRM (macro: atlas.directions)
- [x] Distance matrix (macro: atlas.distanceMatrix)
- [x] Route optimization (macro: atlas.routeOptimize)
- [x] Trips with ordered stops — create / add / remove / reorder / delete (macro: atlas.trips-*)
- [x] AI trip planner (macro: atlas.ai-trip-plan)
- [x] **Add a Stop (Ask Maps)** — route start→end, then suggest a chosen amenity near the route midpoint (macro: atlas.route-stops)

### Overview
- [x] Atlas dashboard summary — places / lists / trips / stops / by-category (macro: atlas.atlas-dashboard-summary)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Immersive Navigation (3D photoreal navigation) | photogrammetry tiles + a 3D renderer | turn-by-turn directions with GeoJSON route geometry; the `world` lens carries 3D rendering |
| Ask Maps live AI assistant | a multimodal routing model | `route-stops` covers the headline "add a stop along the route" intent; `ai-trip-plan` covers itinerary generation |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/atlas.js` clean. 30 macros.
- 2026-05-20: Tests — `tests/atlas-domain-parity.test.js` 14/14 green
  (saved places / lists / trips / directions / recent searches / AI trip
  plan / dashboard / route-stops validation + OSRM-route → Overpass-POI
  midpoint suggestion sorted nearest-first).
- 2026-05-20: Frontend — new `RouteStops` panel (start/end + amenity →
  stops near the route midpoint) mounted in the atlas lens page below
  MapsDirections. `npx tsc --noEmit` exit 0.
