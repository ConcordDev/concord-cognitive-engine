# forestry — Feature Gap vs SilvAssist / forest-management software

Category leader (2026): no direct consumer rival — closest analog is professional forest-management software (e.g. SilvAssist, ForestMetrix) + wildfire dashboards.
Backend: `forestry` domain — timber volume, fire risk, harvest plan, carbon sequestration, stand CRUD, activity log, dashboard; live InciWeb active-fires + NIFC fire perimeters (free, no key). iTree + USFS Wildfire Risk data.

## Has (verified in code)
- Stand inventory (species, age, area, density, site index, volume, basal, terrain, geo)
- Timber-volume estimation (board feet, MBF, value) from DBH/height measurements
- Fire-risk scoring from temp/humidity/wind/drought/fuel-moisture with recommended actions
- Harvest planning (clearcut/shelterwood/selective/salvage — removal %, rotation, permits)
- Carbon sequestration + carbon-credit valuation; live InciWeb wildfire incidents + NIFC perimeters
- Tabs: Dashboard / Stands / Harvest / Fire / Wildlife / Replanting / Inventory / Map; GBIF wildlife panel

## Missing — buildable feature backlog
- [ ] `[M]` Growth & yield projection over a rotation (current volume is point-in-time)
- [ ] `[M]` GIS stand mapping with polygon drawing + acreage calc on the map
- [ ] `[S]` Inventory cruise plotting — sample plots, expansion factors, statistical summary
- [ ] `[S]` Pest / disease tracking with treatment scheduling (Wildlife tab is thin)
- [ ] `[M]` Replanting / silviculture scheduler with seedling orders + survival surveys
- [ ] `[S]` Carbon-credit registry workflow (verification, vintage, retirement)

## Parity
~55% of professional forest-management software. The compute helpers (volume, fire risk, carbon, harvest) plus live wildfire feeds are solid, but it lacks growth modeling, real GIS stand mapping, and a structured cruise/inventory workflow.
