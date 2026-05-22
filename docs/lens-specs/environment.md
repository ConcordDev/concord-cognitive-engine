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
- [x] `[M]` Carbon footprint dashboard — Scope 1/2/3 rollup with charts
- [x] `[M]` Inventory report generation (GHG Protocol / CDP-style export)
- [x] `[S]` Year-over-year emissions trend with target-trajectory overlay
- [x] `[M]` Activity data import from utility bills / spreadsheets
- [x] `[S]` Reduction-scenario modeling — project the effect of a project on totals
- [x] `[S]` Audit trail / verification status per activity entry

## Parity
~95% of a Persefoni+Watershed composite. Emission factors, activity logging, supplier disclosures, RECs/offsets ledgers, targets, live EPA/USGS/AirNow data plus a Scope 1/2/3 footprint dashboard, GHG Protocol inventory report export, year-over-year trends, activity-data import, reduction-scenario modeling, and a per-entry audit trail all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
