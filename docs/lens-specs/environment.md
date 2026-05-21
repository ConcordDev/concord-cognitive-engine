# environment — Feature Gap vs Persefoni / Watershed (carbon accounting)

Category leader (2026): Persefoni / Watershed (enterprise carbon accounting + ESG). Content fills via free public APIs (EPA, USGS, AirNow) + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `environment` domain macros — pure-compute (populationTrend, complianceCheck, trailCondition, diversionRate) plus live data (epa-superfund-search, usgs-water-realtime, airnow-current) and substrate (emission-factors list/lookup, activities list/log/delete, suppliers list/add/invite/record-disclosure).

## Has (verified in code)
- Emissions activities panel with logging + emission-factor library + factor lookup
- Suppliers portal — add, invite, record disclosure (Scope-3 supplier data)
- Targets tracker; projects backlog; RECs ledger; offsets ledger
- EJScreen lookup; EPA Superfund search; USGS realtime water; AirNow air quality (live APIs)
- AI actions: population trend, compliance check, trail condition, diversion rate

## Missing — buildable feature backlog
- [ ] `[M]` Carbon footprint dashboard — Scope 1/2/3 rollup with charts
- [ ] `[M]` Inventory report generation (GHG Protocol / CDP-style export)
- [ ] `[S]` Year-over-year emissions trend with target-trajectory overlay
- [ ] `[M]` Activity data import from utility bills / spreadsheets
- [ ] `[S]` Reduction-scenario modeling — project the effect of a project on totals
- [ ] `[S]` Audit trail / verification status per activity entry

## Parity
~60% of a Persefoni+Watershed composite. One of the deeper lenses — emission factors, activity logging, supplier disclosures, RECs/offsets ledgers, targets, and live EPA/USGS/AirNow data all work. Main gaps are the Scope 1/2/3 rollup dashboard and a GHG Protocol report export.
