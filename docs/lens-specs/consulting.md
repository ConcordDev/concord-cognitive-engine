# consulting — Feature Completeness Spec

Rival app(s): Harvest, Toggl, Bonsai, Productive (2026)
Sources:
- consulting-engagement / billable-time record-keeping

## Features

### Engagement management
- [x] Track engagements — client, rate, hour budget, status (macro: consulting.engagement-create)
- [x] List engagements with logged hours / billed / utilization (macro: consulting.engagement-list)
- [x] Update engagement rate / budget / status (macro: consulting.engagement-update)
- [x] Delete an engagement (macro: consulting.engagement-delete)
- [x] Log billable time with notes (macro: consulting.time-log)
- [x] Utilization dashboard — engagements, active, logged hours, billed total (macro: consulting.consulting-dashboard)

### Calculators
- [x] Client-health scoring — NPS / payment rate / response time (macro: consulting.clientHealth)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Invoicing / payment | a PSP + invoice renderer | billed totals are computed from logged time × rate; the `accounting` lens carries ledgers |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/consulting.js` clean.
  Engagement substrate (6 macros) appended to the client-health domain.
- 2026-05-20: Tests — `tests/consulting-engagement-domain-parity.test.js`
  5/5 green (engagement CRUD + per-user scope / time log + billed +
  utilization math / dashboard aggregation / positive-hours guard).
- 2026-05-20: Frontend — new `EngagementTracker` (engagement list with time
  logging + utilization + dashboard) mounted in the consulting lens page.
  `npx tsc --noEmit` exit 0.
