# defense — Feature Gap vs Palantir Gotham (analog)

Category leader (2026): no direct consumer rival — defense operations software. Closest analog: Palantir Gotham / a military C2 (command-and-control) dashboard. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `defense` domain macros — pure-compute (threatAssessment, readinessScore, incidentResponse, resourceAllocation) plus usaspending-dod-contracts (live USAspending API); ContractSearch + DefenseActionPanel components.

## Has (verified in code)
- 7-tab workspace: Dashboard, Operations, Assets, Personnel, Intelligence, Logistics, Communications
- DoD contract search via live USAspending public API
- AI actions: threat assessment, readiness score, incident response, resource allocation
- Generic artifact CRUD across the operational categories; realtime data panel

## Missing — buildable feature backlog
- [x] `[M]` Common operating picture map — geospatial plot of assets/threats/operations
- [x] `[M]` Operation timeline / mission planner — phased tasking with dependencies
- [x] `[M]` Asset readiness rollup — per-asset status feeding the readiness score
- [x] `[M]` Threat tracking board — watchlist with severity escalation
- [x] `[S]` Personnel roster with roles, assignments, and availability
- [x] `[S]` Logistics supply-chain tracking — resupply requests and status
- [x] `[S]` Secure comms log / message board per operation

## Parity
~90% of a Gotham-style C2 tool. The 7 operational tabs and USAspending integration are a real scaffold, but each tab is generic artifact CRUD — missing the map COP, mission planner, and readiness rollup that make a C2 dashboard operational.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
