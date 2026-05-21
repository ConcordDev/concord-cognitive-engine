# emergency-services — Feature Gap vs CAD dispatch systems

Category leader (2026): no consumer rival — closest analog is a public-safety CAD (computer-aided dispatch) system like Tyler / Central Square. Content fills via free public APIs (USGS quakes) + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `emergency-services` domain macros — pure-compute (triageAssess, dispatchOptimize, incidentLog, resourceReadiness) plus substrate (incident-create/list/status, unit-add/list, ems-dashboard, feed); QuakeFeed component.

## Has (verified in code)
- Incident CRUD with status tracking; unit roster (add/list)
- AI actions: triage assessment, dispatch optimization, incident logging, resource readiness
- EMS dashboard; USGS earthquake feed (live API); map view (Leaflet)
- EmergencyServicesActionPanel; incident feed

## Missing — buildable feature backlog
- [x] `[M]` Live incident map with unit positions and incident pins
- [x] `[M]` Unit dispatch + status lifecycle (available→en-route→on-scene→clear)
- [x] `[M]` Priority/severity triage queue with auto-prioritization
- [x] `[S]` Incident timeline / event log per call
- [x] `[M]` Nearest-unit recommendation tied to incident location
- [x] `[S]` Resource readiness rollup feeding from unit roster
- [x] `[S]` Alerting when a new high-priority incident is created

## Parity
~85% of a CAD dispatch system. The full CAD operational layer is now wired end-to-end via the new `CADConsole` component (mounted under the `CAD Console` tab): live incident/unit map (`map-state`, `incident-create-geo`, `unit-position`), the unit dispatch lifecycle (`dispatch-unit`, `unit-status-advance` — available→dispatched→en_route→on_scene→clear), the auto-prioritized triage queue with dispatch scores (`triage-queue`), per-incident event timelines (`incident-timeline`), nearest-unit recommendation by haversine distance + ETA (`nearest-unit`), a readiness rollup derived live from the unit roster (`readiness-rollup`), and high-priority alerting on incident intake (`active-alerts`). Remaining gap is licensed CAD-grade map tiles and multi-agency interop — structural, not buildable.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
