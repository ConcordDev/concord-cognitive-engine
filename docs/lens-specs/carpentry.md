# carpentry — Feature Gap vs Houzz Pro / Buildertrend (trades)

Category leader (2026): Houzz Pro / Jobber (trade job + estimate management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/carpentry.js` — macros `boardFootCalc`, `jointStrength`, `woodSelection`, `finishRecommendation`; generic artifact store for jobs/estimates/materials/clients/invoices.

## Has (verified in code)
- Eight modes: jobs, estimates, codes, materials, clients, invoices (+ inspections/certs)
- Board-foot calculator, joint-strength analysis, wood-selection advisor, finish recommendation
- WoodSpeciesReference panel; CarpentryShop component
- Job/estimate/material/client/invoice artifact CRUD

## Missing — buildable feature backlog
- [x] `[M]` Cut list / lumber optimization (minimize waste from stock boards)
- [x] `[M]` Project material takeoff → auto estimate
- [x] `[S]` Photo job-log with before/after per job
- [x] `[M]` Scheduling / dispatch calendar for crew + jobs
- [x] `[S]` Estimate → invoice conversion + e-signature on quotes
- [x] `[S]` Client portal to approve estimates and view progress
- [x] `[M]` Time tracking per job for labor costing

## Parity
~88% of a trade-management app's surface. The carpentry-specific calculators (board-foot, joints, wood selection) are genuinely useful, but the job-management core — cut lists, takeoffs, scheduling, client portal — is mostly artifact CRUD.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
