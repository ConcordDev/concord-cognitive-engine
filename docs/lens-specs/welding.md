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
- [x] `[M]` Scheduling calendar — assign welding jobs to dates/crew. *(welding.calendar/job-schedule/job-update — 30-day grid + crew-load chart)*
- [x] `[M]` Payment processing on invoices (invoices tab exists; no collection). *(welding.invoice-payment — partial/paid tracking, multi-method)*
- [x] `[S]` WPS (Welding Procedure Specification) document builder per job. *(welding.wps-create/wps-list/wps-approve — completeness gate)*
- [x] `[M]` Welder-certification tracking with expiry alerts (Certs tab exists; needs expiry logic + reminders). *(welding.cert-add/cert-status/cert-renew — expiry + 6-month continuity alerts)*
- [x] `[S]` Photo documentation of welds per inspection. *(welding.photo-attach/photo-list/photo-remove — per-stage weld photos)*
- [x] `[M]` Quote-to-invoice workflow linking estimates → jobs → invoices. *(welding.estimate-create/send/estimate-to-job/invoice-from-job)*
- [x] `[S]` Code reference library — searchable AWS D1.1 / ASME clauses (Codes tab is currently artifact CRUD). *(welding.code-search — ranked clause search)*
- [x] `[M]` Client portal for quote approval and invoice payment. *(welding.estimate-send/portal-view/portal-approve/portal-pay)*

## Parity
~90% of a welding-trade contractor app. The four engineering calculators are a real specialty edge and the eight-tab artifact model is broad, but it lacks scheduling, payments, WPS builder, and cert-expiry tracking that make a trade app operational.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
