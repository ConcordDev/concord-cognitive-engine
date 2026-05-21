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
- [ ] `[L]` Satellite NDVI/vegetation imagery layers (open Sentinel-2 data is free — buildable)
- [ ] `[M]` Equipment data sync from machine APIs (ISOBUS/CAN telemetry import)
- [ ] `[M]` Profit/cost analysis per field (input costs vs commodity prices)
- [ ] `[S]` Weather-driven spray-window advisor (wind/temp gating already partly possible)
- [ ] `[M]` Yield map overlay from harvest-monitor data
- [ ] `[S]` Side-by-side seed/hybrid trial comparison
- [ ] `[M]` Soil-sampling grid generator + lab-result import

## Parity
~70% of Climate FieldView's feature surface. Genuinely deep precision-ag tooling — prescriptions, zones, passes, nitrogen, grain bins all real. Main gaps are satellite imagery layers and machine-data ingestion.
