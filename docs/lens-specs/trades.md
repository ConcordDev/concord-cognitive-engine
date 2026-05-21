# trades — Feature Gap vs ServiceTitan / Jobber

Category leader (2026): ServiceTitan / Jobber (field-service / contractor management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `trades` domain — 24+ macros: estimate/P&L/permit/invoice/PO calculators, job CRUD, customer CRUD, contracts, technicians, dispatch-board, route-optimize, quotes.

## Has (verified in code)
- Six-mode workbench (jobs, estimates, materials, permits, equipment, clients) plus sub-views.
- Job sub-views: timeline, estimate builder, change orders, time tracking, P&L, materials tracker, photos, invoice generator.
- Estimate calculation, profit/loss calc, permit checking, invoice + purchase-order generation, materials cost.
- Job lifecycle — create, list, update-status, assign to technician.
- Technician roster (add/delete/set-status), dispatch board, route optimization, quotes.
- Customer CRUD, contracts (create/list/cancel), photo entries, time entries.
- TradingView-style index session chart (ambient — `^IXIC`).

## Missing — buildable feature backlog
- [ ] `[M]` Online booking / scheduling calendar — drag-drop job scheduling, not just a dispatch board.
- [ ] `[M]` Payment processing — invoices are generated but no card/ACH collection or payment status tracking.
- [ ] `[M]` Customer portal — clients view quotes, approve estimates, pay invoices.
- [ ] `[S]` Recurring jobs / maintenance contracts with auto-generated visits.
- [ ] `[M]` GPS technician tracking and live job-status updates from the field.
- [ ] `[S]` SMS/email automated reminders and on-the-way notifications.
- [ ] `[M]` Pricebook — reusable priced services/materials catalog for fast estimates.
- [ ] `[S]` Reporting dashboard — revenue, close rate, tech utilization.

## Parity
~60% of ServiceTitan. Genuinely deep for job/estimate/invoice/dispatch management with real calculators, but it lacks the scheduling calendar, integrated payments, customer portal, and field-tracking that complete a field-service platform.
