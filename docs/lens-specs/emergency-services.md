# emergency-services — Feature Gap vs CAD dispatch systems

Category leader (2026): no consumer rival — closest analog is a public-safety CAD (computer-aided dispatch) system like Tyler / Central Square. Content fills via free public APIs (USGS quakes) + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `emergency-services` domain macros — pure-compute (triageAssess, dispatchOptimize, incidentLog, resourceReadiness) plus substrate (incident-create/list/status, unit-add/list, ems-dashboard, feed); QuakeFeed component.

## Has (verified in code)
- Incident CRUD with status tracking; unit roster (add/list)
- AI actions: triage assessment, dispatch optimization, incident logging, resource readiness
- EMS dashboard; USGS earthquake feed (live API); map view (Leaflet)
- EmergencyServicesActionPanel; incident feed

## Missing — buildable feature backlog
- [ ] `[M]` Live incident map with unit positions and incident pins
- [ ] `[M]` Unit dispatch + status lifecycle (available→en-route→on-scene→clear)
- [ ] `[M]` Priority/severity triage queue with auto-prioritization
- [ ] `[S]` Incident timeline / event log per call
- [ ] `[M]` Nearest-unit recommendation tied to incident location
- [ ] `[S]` Resource readiness rollup feeding from unit roster
- [ ] `[S]` Alerting when a new high-priority incident is created

## Parity
~45% of a CAD dispatch system. Incidents, units, dashboard, and the quake feed are real, plus useful dispatch/triage compute, but missing the live map, full unit-status lifecycle, and nearest-unit dispatch that make CAD operational.
