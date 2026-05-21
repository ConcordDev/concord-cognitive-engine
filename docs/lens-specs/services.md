# services — Feature Gap vs Square Appointments / Vagaro

Category leader (2026): Square Appointments / Vagaro (service-business booking + POS). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/services.js` — 7 macros (scheduleOptimize, reminderGenerate, revenueByProvider, clientRetentionReport, commissionCalc, dailyCloseReport, supplyCheck); page runs a 7-tab artifact UI.

## Has (verified in code)
- 7 tabs: Dashboard, Appointments, Clients, Services, Staff, POS, Inventory
- Appointment, client, service, staff artifact CRUD over the generic store
- Schedule optimization, appointment reminder generation
- Revenue-by-provider, client-retention report, commission calculator, daily-close report
- Supply/inventory check; POS tab

## Missing — buildable feature backlog
- [ ] `[M]` Calendar booking grid — drag appointments onto a staff/time calendar
- [ ] `[M]` Online self-booking page — clients book their own appointments
- [ ] `[M]` Payment capture at POS — take card payment for a service (Stripe-style)
- [ ] `[S]` Automated reminder delivery — actually send SMS/email reminders, not just generate text
- [ ] `[S]` Staff availability + shift management
- [ ] `[S]` Client history + preferences profile — past services, notes, rebooking
- [ ] `[M]` Recurring appointments + waitlist

## Parity
~45% of Square Appointments' feature surface. The 7-tab structure models the full service business (appointments/clients/staff/POS/inventory) and the analytics macros (revenue, retention, commission, daily close) are real, but it lacks a calendar booking grid, online self-booking, and POS payment capture.
