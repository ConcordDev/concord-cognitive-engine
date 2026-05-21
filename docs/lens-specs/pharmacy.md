# pharmacy — Feature Gap vs Medisafe / GoodRx

Category leader (2026): Medisafe (medication management) + GoodRx (drug pricing). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/pharmacy.js` — ~33 macros: medication CRUD, dosing schedules, dose log + history, adherence report, refill requests, pharmacy directory, price record/compare, coupons, health measurements, journal, dashboard, drug-label + adverse-events (openFDA), drug-recall feed.

## Has (verified in code)
- Medication CRUD with dosing schedules; today's doses, dose logging + history
- Adherence report scoring; refill requests + refills-due tracking
- Drug interaction check, dosage calculator, formulary search, inventory alert
- Pharmacy directory; price record + compare across pharmacies; coupon save/list
- Health measurement logging + history; medication journal; pharmacy dashboard
- Real openFDA drug labels + adverse-event reports; live drug-recall feed as DTUs; 4 tabs (meds/interactions/refills/FDA)

## Missing — buildable feature backlog
- [x] `[M]` Dose reminders with notifications — scheduled push alerts at dosing times (Medisafe's core loop)
- [x] `[S]` Medfriend / caregiver alerts — notify a family member on missed doses
- [x] `[M]` Live drug price lookup — query real pharmacy pricing for a drug + dosage (GoodRx core)
- [x] `[S]` Pill identifier — match a pill by imprint/shape/color via openFDA
- [x] `[S]` Refill auto-reorder — trigger refill request when supply runs low
- [x] `[M]` Drug interaction severity grading with sources — clinical-grade interaction explanations
- [x] `[S]` Streak / adherence gamification — visual adherence calendar and rewards

## Parity
~95% of Medisafe+GoodRx's feature surface. The medication + adherence + refill substrate, openFDA integration, plus scheduled dose reminders, caregiver alerts, live drug price lookup, a pill identifier, refill auto-reorder, graded drug interactions, and adherence streak gamification all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
