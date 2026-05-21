# masonry — Feature Gap vs Buildertrend / masonry estimating tools

Category leader (2026): Buildertrend / contractor estimating + job-management software. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/masonry.js` — 4 macros: materialEstimate, mortarMix, wallStrength, jobCosting + generic `/api/lens` artifact store for jobs/estimates/clients/invoices.

## Has (verified in code)
- Material estimate — brick/block/stone quantity takeoff from wall dimensions
- Mortar mix calculator — mix ratios and quantities
- Wall strength estimation — structural capacity check
- Job costing — labor + material cost rollup
- Business tabs — jobs, estimates, code refs, materials, clients, invoices (typed artifacts)
- MasonStuff / MasonryFeed components, action panel

## Missing — buildable feature backlog
- [ ] `[M]` Visual wall/project takeoff — draw the wall, auto-derive area and material counts
- [ ] `[M]` Estimate → professional proposal PDF for the client
- [ ] `[M]` Job scheduling calendar — crew assignment, multi-day jobs, weather awareness
- [ ] `[S]` Photo documentation — before/during/after job photos with timeline
- [ ] `[M]` Change orders — track scope additions with re-pricing and client sign-off
- [ ] `[S]` Material price book — reusable unit costs that flow into estimates
- [ ] `[M]` Invoicing with payment tracking and progress billing
- [ ] `[S]` Code-reference library for masonry (IBC/ACI/TMS) tied to wall-strength checks

## Parity
~40% of a contractor estimating/management suite. Real domain calculators (material takeoff, mortar mix, wall strength, costing) and basic business artifacts, but missing visual takeoff, proposal generation, scheduling, and change-order workflows that define a production contractor tool.
