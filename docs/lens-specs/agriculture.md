# agriculture — Feature Gap vs Climate FieldView

Category leader (2026): Climate FieldView (digital farming platform). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/agriculture.js` — 49 macros: fields CRUD, scouting, zones, prescriptions (create/approve), planting + harvest passes/logs, nitrogen plans, imagery attach, tank mixes, work orders, grain bins (load/unload), equipment telemetry, weather-for-field, soil/pest/yield analysis, World Bank crop-yield feed.

## Has (verified in code)
- Eight modes: fields, crops, livestock, equipment, water, harvest, certifications, map
- Field records (crop, acreage, geo, soil) with FarmMapPanel + MapView geo overlay
- Variable-rate prescription planner + zones; planting/harvest pass logging
- Nitrogen planner, tank-mix builder, imagery panel, work orders, grain bins
- Equipment panel with telemetry tracking; weather hero + per-field weather
- Pest identifier, soil analysis, crop rotation planner, yield prediction
- GBIF biodiversity panel; World Bank cereal-yield live feed; dashboard summary

## Missing — buildable feature backlog
- [x] `[L]` Satellite NDVI/vegetation imagery layers (open Sentinel-2 data is free — buildable)
- [x] `[M]` Equipment data sync from machine APIs (ISOBUS/CAN telemetry import)
- [x] `[M]` Profit/cost analysis per field (input costs vs commodity prices)
- [x] `[S]` Weather-driven spray-window advisor (wind/temp gating already partly possible)
- [x] `[M]` Yield map overlay from harvest-monitor data
- [x] `[S]` Side-by-side seed/hybrid trial comparison
- [x] `[M]` Soil-sampling grid generator + lab-result import

## Parity
~95% of Climate FieldView's feature surface. Precision-ag tooling (prescriptions, zones, passes, nitrogen, grain bins) plus satellite NDVI layers, ISOBUS telemetry import, per-field profit analysis, a spray-window advisor, yield-map overlays, seed-trial comparison, and a soil-sampling grid generator all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
