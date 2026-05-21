# welding — Feature Gap vs Jobber / contractor field-service (welding trade)

Category leader (2026): Jobber / ServiceTitan (trade contractor management, welding vertical). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `welding` domain macros — pure-compute engineering calculators (`jointStrength`, `rodSelection`, `heatInput`, `inspectionChecklist`).

## Has (verified in code)
- Eight-tab workbench: Jobs, Estimates, Codes, Materials, CRM (clients), Invoices, Inspections, Certs.
- Joint-strength calculator (weld joint load capacity).
- Rod/electrode selection calculator.
- Heat-input calculator (welding parameters).
- Inspection checklist generator.
- Typed artifact CRUD per tab with status config.

## Missing — buildable feature backlog
- [ ] `[M]` Scheduling calendar — assign welding jobs to dates/crew.
- [ ] `[M]` Payment processing on invoices (invoices tab exists; no collection).
- [ ] `[S]` WPS (Welding Procedure Specification) document builder per job.
- [ ] `[M]` Welder-certification tracking with expiry alerts (Certs tab exists; needs expiry logic + reminders).
- [ ] `[S]` Photo documentation of welds per inspection.
- [ ] `[M]` Quote-to-invoice workflow linking estimates → jobs → invoices.
- [ ] `[S]` Code reference library — searchable AWS D1.1 / ASME clauses (Codes tab is currently artifact CRUD).
- [ ] `[M]` Client portal for quote approval and invoice payment.

## Parity
~45% of a welding-trade contractor app. The four engineering calculators are a real specialty edge and the eight-tab artifact model is broad, but it lacks scheduling, payments, WPS builder, and cert-expiry tracking that make a trade app operational.
