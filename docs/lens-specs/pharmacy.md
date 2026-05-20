# pharmacy — Feature Completeness Spec

Rival app(s): GoodRx, Medisafe, CVS / Walgreens apps (2026)
Sources:
- https://open.fda.gov/apis/drug/enforcement/ — openFDA drug enforcement / recalls (free, no key)

## Features

### Medication-management substrate
- [x] Medications, dosing schedules, dose log, refill requests
- [x] Pharmacies, price comparison, coupons, health measurements, journal
- [x] Adherence scoring + pharmacy dashboard
- (33 macros)

### Live data & feed
- [x] Live drug-recall feed — openFDA drug enforcement reports ingested as DTUs (macro: pharmacy.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| e-Prescription routing | a Surescripts-style network licence | manual refill requests + pharmacy records |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (openFDA recalls → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` pharmacy feed green; `tests/pharmacy-domain-parity.test.js` + `tests/pharmacy-rx-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="pharmacy"` mounted in the lens page.
