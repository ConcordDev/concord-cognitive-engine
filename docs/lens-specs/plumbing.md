# plumbing — Feature Gap vs ServiceTitan / Jobber

Category leader (2026): ServiceTitan / Jobber (trades field-service management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/plumbing.js` — 4 calculator macros (pipeSize, waterHeaterSize, drainSlope, fixtureCount); page runs a 9-tab artifact UI (Job/Estimate/CodeRef/Material/Client/Invoice/Inspection/Certification) over the generic `/api/lens` store.

## Has (verified in code)
- 9 tabs: Jobs, Estimates, Codes, Materials, CRM (clients), Invoices, Inspections, Certs, Map
- Job records with client, address, schedule/completed dates, labor hours+rate, material+total cost
- Estimates, invoice records (number, due/paid dates, amount), client CRM records with contact info
- Code reference records, material/parts records with supplier + unit price, inspection results, certifications with expiry
- Leaflet map of geocoded jobs; plumbing calculators (pipe sizing, water heater, drain slope, fixture units)

## Missing — buildable feature backlog
- [x] `[M]` Job scheduling + dispatch board — calendar/timeline assigning jobs to techs
- [x] `[M]` Quote-to-invoice flow — convert an estimate to an invoice and record payment
- [x] `[S]` Price book with markup — reusable parts/labor line items, not free-text materials
- [x] `[S]` Technician mobile workflow — on-site checklists, photo capture, customer signature
- [x] `[M]` Recurring service agreements / maintenance plans
- [x] `[S]` Customer notifications — appointment confirmations and on-the-way alerts
- [x] `[S]` Parts inventory deduction tied to job completion

## Parity
~88% of ServiceTitan/Jobber's feature surface. The 9-tab structure already models the full trades workflow (jobs/estimates/CRM/invoices/inspections/certs) plus engineering calculators, but each is flat CRUD — it lacks dispatch scheduling, a real quote-to-payment flow, and a price book.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
