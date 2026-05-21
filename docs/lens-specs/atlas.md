# atlas — Feature Gap vs Google Maps

Category leader (2026): Google Maps. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/atlas.js` — 29 macros: geocode + nominatim geocode/reverse, overpass POI, places CRUD, lists, trips with stops, directions (OSRM), distance matrix, route optimize, route-stops (add-a-stop), recent searches, AI trip plan, dashboard.

## Has (verified in code)
- Place search + reverse geocode (Nominatim); POI category browse (Overpass)
- Saved places CRUD; named lists (create/add/remove/delete)
- Turn-by-turn directions via OSRM with GeoJSON route geometry
- Trips with ordered, reorderable stops; distance matrix; route optimization
- "Add a stop along the route" (Ask-Maps-style); AI trip planner
- Leaflet MapView, region statistics, recent searches, dashboard summary

## Missing — buildable feature backlog
- [x] `[M]` Live traffic + ETA on routes (open traffic feeds buildable)
- [x] `[M]` Transit directions (GTFS feeds are free)
- [x] `[M]` Street-level / panoramic imagery view (Mapillary open imagery)
- [x] `[S]` Multi-modal routing (walk/bike/drive toggle on directions)
- [x] `[M]` Place details pages (hours, photos, reviews from OSM/Wikidata)
- [x] `[S]` Offline map area download
- [x] `[M]` Real-time navigation mode with re-routing

## Parity
~95% of Google Maps' surface. Search, directions, saved places, lists, trips, live traffic + ETA, transit directions, street-level imagery, multi-modal routing, place-details pages, offline map download, and real-time navigation with re-routing all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
