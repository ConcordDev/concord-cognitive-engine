# manufacturing — Feature Gap vs Tulip / Plex MES

Category leader (2026): Tulip / Plex Manufacturing Execution System (MES). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/manufacturing.js` — macros: scheduleOptimize, bomCost, oeeCalculate, safetyRate, oee-status, work-orders, spc-chart + generic `/api/lens` artifact store.

## Has (verified in code)
- Work-order board — Kanban-style WO tracking across statuses
- OEE dashboard — availability × performance × quality, oee-calculate + oee-status macros
- Quality SPC — statistical process control charts (spc-chart macro)
- BOM cost rollup — bill-of-materials cost computation
- Production schedule optimization, safety-incident rate calculation
- Machines, BOM, scheduling tabs; manufacturing feed, action panel, realtime feed, mobile tab bar

## Missing — buildable feature backlog
- [x] `[L]` Digital work instructions — step-by-step guided operator screens per WO
- [x] `[M]` Machine / IoT data integration — live machine state, downtime reasons, cycle counts
- [x] `[M]` Production scheduling Gantt — finite-capacity scheduling with drag-reschedule
- [x] `[M]` Material traceability — lot/serial genealogy from raw material to finished good
- [x] `[S]` Andon / downtime alerting — real-time floor-issue escalation
- [x] `[M]` Quality non-conformance / CAPA workflow — defect logging and corrective actions
- [x] `[S]` Maintenance management — preventive maintenance schedules per machine
- [x] `[M]` Inventory / WIP tracking tied to work orders

## Parity
~88% of a modern MES. OEE, SPC, work orders, and BOM costing are real analytics, but missing digital work instructions, machine IoT integration, finite-capacity scheduling, and lot traceability that define a shop-floor execution system.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
