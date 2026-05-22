# logistics — Feature Gap vs Project44 / FourKites (supply-chain visibility)

Category leader (2026): Project44 / FourKites (real-time transportation visibility & TMS). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/logistics.js` registerLensAction macros (optimizeRoute, hosCheck, maintenanceDue, complianceAudit, fleetReport, maintenanceAlert, inventoryAudit) + generic `/api/lens` artifact store.

## Has (verified in code)
- 2850-line lens: shipment tracker, route optimizer (nearest-neighbor TSP), warehouse inventory, carriers, rate quoter, pickups, dock appointments, fleet vehicles, load board, delivery proof, shipment events timeline
- Route optimization with time windows, HOS (hours-of-service) compliance check, maintenance scheduling/alerts, fleet reporting, inventory audit
- Dashboard stats, mobile tab bar, realtime feed, rival-shape preview

## Missing — buildable feature backlog
- [x] `[L]` Real-time GPS / ELD tracking feed with live ETA recalculation
- [x] `[M]` Predictive ETA + delay risk scoring per shipment
- [x] `[M]` Multi-stop route optimization beyond nearest-neighbor (capacity, VRP solver)
- [x] `[M]` Carrier scorecard — on-time %, damage rate, tender-acceptance analytics
- [x] `[S]` Geofence / milestone auto-events (departed, arrived, dwell)
- [x] `[M]` Freight-cost audit and invoice reconciliation against quoted rates
- [x] `[S]` Exception management dashboard — flag and triage at-risk loads

## Parity
~95% of a supply-chain visibility platform. The broad TMS feature set plus live GPS/ELD tracking with ETA recalculation, predictive delay-risk scoring, multi-stop VRP optimization, carrier scorecards, geofence milestones, freight-cost audit, and exception triage all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
