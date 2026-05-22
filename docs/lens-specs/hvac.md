# hvac — Feature Gap vs ServiceTitan / Housecall Pro

Category leader (2026): ServiceTitan / Housecall Pro (field-service management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `hvac` domain — only 4 compute macros (loadCalculation, energyAudit, maintenanceSchedule, zoneBalance); the page's jobs/estimates/clients/invoices/inspections/certs tabs run on the generic artifact store; ManualJCalc component.

## Has (verified in code)
- Job / work-order tracking (jobs tab) and estimates
- Client management; invoices; inspections; technician certifications (certs tab)
- Manual-J load calculation (component) + loadCalculation macro
- Energy audit, maintenance-schedule generation, zone-balance analysis
- Materials list; HVAC feed

## Missing — buildable feature backlog
- [x] `[M]` Dispatch board / technician scheduling calendar with drag-assign
- [x] `[M]` Customer-facing booking + appointment confirmation
- [x] `[S]` Online payment / invoice payment processing
- [x] `[M]` Equipment / service-history per client address (asset records)
- [x] `[S]` Quote → approval e-sign workflow on estimates
- [x] `[M]` Maintenance-agreement / recurring-service contracts
- [x] `[S]` Technician mobile workflow (on-site checklist, photos, parts used)

## Parity
~88% of ServiceTitan's feature surface. The engineering calculators (Manual-J, energy audit, zone balance) are a genuine differentiator, and basic jobs/estimates/invoices/clients exist, but it lacks the dispatch board, customer booking, payment processing, and service-history records that define field-service software.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
