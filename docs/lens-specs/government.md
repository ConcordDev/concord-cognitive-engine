# government — Feature Gap vs civic portals (Accela / USA.gov)

Category leader (2026): Accela civic platform + USA.gov / Countable (civic engagement). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `government` domain — very deep (~40 macros): representatives-find, bills-list, civic alerts, FOIA tracker, budget breakdown, departments, service requests (311), routing rules, permits (apply/pay/approve/deny/issue), inspections, assets + maintenance, open-data search, dashboard.

## Has (verified in code)
- Citizen side: representative finder, bill tracking, civic alerts, FOIA request tracker, budget visualizer
- 311 service requests — create, assign, status, routing rules
- Permitting workflow — apply → pay fee → approve/deny → issue; inspections schedule + complete
- Department management; municipal asset register with maintenance logging
- Open-data explorer; permit-timeline / violation-escalation / resource-staging analytics

## Missing — buildable feature backlog
- [ ] `[M]` Online payment processing for permit fees / fines (records "pay" but no gateway)
- [ ] `[S]` Public meeting calendar + agenda/minutes
- [ ] `[M]` Voter registration / election info + polling-place lookup
- [ ] `[S]` Map-based service-request reporting (drop a pin on a pothole)
- [ ] `[M]` Bill comment / call-your-rep advocacy actions (Countable-style)
- [ ] `[S]` Document/form library with e-signature
- [ ] `[S]` Case-status notifications (email/SMS on permit/request updates)

## Parity
~65% of a combined civic-portal surface. It covers both the government-ops side (permits, inspections, 311, assets) and the citizen side (reps, bills, FOIA, budget) impressively, but lacks real payment processing, map-based reporting, and election/meeting features.
