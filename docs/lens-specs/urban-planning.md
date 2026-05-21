# urban-planning — Feature Gap vs UrbanFootprint / Esri Urban

Category leader (2026): Esri ArcGIS Urban / UrbanFootprint (city planning suites). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `urban-planning` domain macros — pure-compute (`zoningAnalysis`, `walkabilityScore`, `densityCalc`, `trafficImpact`) + live US Census ACS and HUD income-limits APIs (`census-acs-county`, `hud-income-limits`).

## Has (verified in code)
- Eight-tab workbench: Dashboard, Projects, Zoning, Infrastructure, Transit, Green Space, Permits, Map.
- Zoning analysis — FAR, max buildable sqft, height, setback, parking, density by zone type.
- Walkability score (Walk-Score-style amenity weighting), density calc with transit-viability classification.
- Traffic-impact analysis — trip generation, peak-hour trips, % increase, mitigation list.
- Live US Census ACS county data and HUD income limits.

## Missing — buildable feature backlog
- [ ] `[L]` Actual interactive map — "Map" tab exists; render parcels, zones, projects on a real GIS map.
- [ ] `[M]` 3D massing / building-envelope visualization from zoning constraints.
- [ ] `[M]` Scenario planning — compare alternative development scenarios side by side.
- [ ] `[S]` Parcel-level data — pull a parcel and auto-fill lot size / zone.
- [ ] `[M]` Impact dashboards — population, jobs, housing, emissions projections per scenario.
- [ ] `[S]` Transit-coverage analysis on the map (catchment buffers).
- [ ] `[M]` Public-comment / stakeholder review workflow on projects.
- [ ] `[S]` Export plans as PDF/shareable report.

## Parity
~40% of Esri Urban. The four planning calculators are real and the Census/HUD data is genuinely live, but the category is fundamentally map-based 3D scenario planning, and there is no actual map or massing visualization here.
