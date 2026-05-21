# electrical — Feature Gap vs ServiceTitan (electrical) + NEC calc tools

Category leader (2026): no single consumer rival — closest analogs are ServiceTitan (electrical contractor ops) and Electrical Calc Elite (NEC calculations). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `electrical` domain macros (loadCalculation, voltageDropCalc, circuitTrace, safetyInspection); generic `/api/lens` artifact store; NecCodeCalc + OpenHardwarePulse components.

## Has (verified in code)
- Multi-tab workspace: Jobs, Estimates, and further trade artifact types
- AI/compute actions: load calculation, voltage-drop calc, circuit trace, safety inspection
- NEC code calculator component; OpenHardwarePulse feed
- Generic job/estimate artifact CRUD with status workflow

## Missing — buildable feature backlog
- [ ] `[M]` Panel schedule builder — circuit-by-circuit load assignment with breaker sizing
- [ ] `[M]` Conduit fill + wire-size calculator with NEC table lookup
- [ ] `[S]` Box fill calculator
- [ ] `[M]` Estimate → invoice flow with labor + materials line items
- [ ] `[S]` One-line diagram / circuit map drawing
- [ ] `[S]` Inspection checklist templates per job type
- [ ] `[S]` Material price list integration for estimates

## Parity
~45% of a ServiceTitan+NEC-calc composite. Has core NEC compute (load, voltage drop) and job/estimate tracking, but missing the panel schedule, conduit/box fill calculators, and estimate→invoice flow that define electrical-trade software.
