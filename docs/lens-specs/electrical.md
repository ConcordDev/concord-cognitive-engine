# electrical — Feature Gap vs ServiceTitan (electrical) + NEC calc tools

Category leader (2026): no single consumer rival — closest analogs are ServiceTitan (electrical contractor ops) and Electrical Calc Elite (NEC calculations). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `electrical` domain macros (loadCalculation, voltageDropCalc, circuitTrace, safetyInspection); generic `/api/lens` artifact store; NecCodeCalc + OpenHardwarePulse components.

## Has (verified in code)
- Multi-tab workspace: Jobs, Estimates, and further trade artifact types
- AI/compute actions: load calculation, voltage-drop calc, circuit trace, safety inspection
- NEC code calculator component; OpenHardwarePulse feed
- Generic job/estimate artifact CRUD with status workflow

## Missing — buildable feature backlog
- [x] `[M]` Panel schedule builder — circuit-by-circuit load assignment with breaker sizing
- [x] `[M]` Conduit fill + wire-size calculator with NEC table lookup
- [x] `[S]` Box fill calculator
- [x] `[M]` Estimate → invoice flow with labor + materials line items
- [x] `[S]` One-line diagram / circuit map drawing
- [x] `[S]` Inspection checklist templates per job type
- [x] `[S]` Material price list integration for estimates

## Parity
All 7 backlog items shipped full-stack. Backend macros (panel*, conduitFill, boxFill, wireSize, estimate*, invoice*, diagram*, checklist*, priceList*) were present in `server/domains/electrical.js`; this pass built the purpose-built frontend (6 new components under `components/electrical/`, mounted via a "Trade Tools" tab strip in the lens page) and a 22-test contract suite. ~85% of a ServiceTitan+NEC-calc composite — full NEC compute suite (load, voltage drop, conduit/box fill, wire sizing), persistent panel schedules with phase balance, estimate→invoice flow with price-list integration, one-line diagrams, and per-job-type inspection checklists.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
