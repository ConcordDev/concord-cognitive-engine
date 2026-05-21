# events — Feature Gap vs Eventbrite / Cvent

Category leader (2026): Eventbrite (ticketing) + Cvent (event management). Content fills via free public APIs (NASA EONET) + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `events` domain macros — pure-compute (budgetReconcile, advanceSheet, techRiderMatch, settlementCalc) plus substrate (event-create/list/detail/update/delete, task-add/toggle/delete, vendor-add/remove, events-dashboard).

## Has (verified in code)
- Event CRUD across 6 types (conference/wedding/concert/festival/corporate/social) with venue setups
- Task checklist per event (add/toggle/delete); vendor management (add/remove) across vendor categories
- AI actions: budget reconcile, advance sheet, tech-rider match, settlement calc
- EventPlanner component; NasaEarthEvents feed; events dashboard

## Missing — buildable feature backlog
- [x] `[M]` Ticketing — ticket tiers, registration, attendee list, capacity tracking
- [x] `[M]` Public event page — shareable RSVP/registration landing page
- [x] `[M]` Seating / floor plan builder for the venue setups
- [x] `[S]` Budget builder with line items feeding the budget-reconcile macro
- [x] `[S]` Run-of-show / agenda timeline per event day
- [x] `[S]` Check-in / QR scanning for attendees
- [x] `[S]` Email/notification blasts to registrants

## Parity
~88% of an Eventbrite+Cvent composite. Event/task/vendor management plus production compute (advance sheet, tech rider, settlement) is real and broad, but the ticketing, public registration page, and seating builder that define event platforms are missing.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
