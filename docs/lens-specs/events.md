# events — Feature Completeness Spec

Rival app(s): event-management tools — Eventbrite Organizer, Aisle Planner, Allseated (2026)
Sources:
- event-planning workflow: events with budget, planning checklist, vendor roster, guest counts
- existing production calculators (advance sheet, tech rider, settlement)

## Features

### Event planning
- [x] Create an event — name, type (conference/wedding/concert/festival/corporate/social), date, venue, budget, guest count (macro: events.event-create)
- [x] List + filter events by type / status (macro: events.event-list)
- [x] Event detail with vendor cost + remaining budget (macro: events.event-detail)
- [x] Update — status (planning/confirmed/complete/cancelled), budget, venue (macro: events.event-update)
- [x] Delete an event (macro: events.event-delete)

### Tasks & vendors
- [x] Planning checklist — add / toggle / delete tasks (macro: events.task-add / task-toggle / task-delete)
- [x] Vendor roster — add / remove vendors with role + cost (macro: events.vendor-add / vendor-remove)
- [x] Events dashboard — total, upcoming, budget, open tasks (macro: events.events-dashboard)

### Production calculators (retained)
- [x] Budget reconciliation (macro: events.budgetReconcile)
- [x] Advance sheet (macro: events.advanceSheet)
- [x] Tech rider matching (macro: events.techRiderMatch)
- [x] Settlement calculation (macro: events.settlementCalc)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Ticketing + attendee registration | a payment processor + check-in | the in-world `world events` system handles RSVP/entry fees; this lens is the organizer's planning workspace |
| Seating charts / floor plans | a spatial layout editor | guest count + venue field; vendor roster covers logistics |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/events.js` clean. 14 macros
  (4 production calculators + 10 event-planning substrate).
- 2026-05-20: Tests — `tests/events-planning-domain-parity.test.js` 9/9 green
  (event CRUD + per-user scope + type fallback / tasks add-toggle-delete /
  vendors + remaining-budget math / dashboard / calculators intact).
- 2026-05-20: Frontend — new `EventPlanner` (event list, budget tracking,
  planning checklist, vendor roster) mounted in the events lens page.
  `npx tsc --noEmit` exit 0.
