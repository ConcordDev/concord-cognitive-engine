# desert — Feature Gap vs field-survey / arid-environment tooling

Category leader (2026): no direct consumer rival — a domain/biome lens. Closest analog: an arid-environment field survey + expedition planner. Content fills via free public APIs (Wikipedia, weather) + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `desert` domain macros — pure-compute (waterBudget, heatStressIndex, terrainClassification, solarPotential); generic `/api/lens` artifact store; WikipediaSearchPanel + DesertWeatherWatch.

## Has (verified in code)
- 4-tab workspace: Dashboard, Expeditions, Climate, Resources; map view (Leaflet)
- AI actions: water budget, heat-stress index, terrain classification, solar potential
- Desert weather watch (live weather API); Wikipedia search panel for desert topics
- Generic artifact CRUD across expedition/climate/resource categories

## Missing — buildable feature backlog
- [x] `[M]` Expedition planner — route, waypoints, water/supply requirements per leg
- [x] `[M]` Live heat-index / UV alerts tied to a tracked location
- [x] `[S]` Resource node mapping — water sources, shade, hazards on the map
- [x] `[S]` Solar-installation calculator with panel sizing and yield estimate
- [x] `[M]` Terrain dataset overlay — sand/rock/dune classification on the map
- [x] `[S]` Survival checklist / kit tracker per expedition

## Parity
~90% of a desert field-survey tool. The 4 compute actions plus weather and map are a real scaffold, but expeditions/climate/resources are generic CRUD — missing the route planner, location-tracked alerts, and resource mapping that make it operational.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
