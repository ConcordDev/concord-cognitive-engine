# carpentry — Feature Gap vs Houzz Pro / Buildertrend (trades)

Category leader (2026): Houzz Pro / Jobber (trade job + estimate management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/carpentry.js` — macros `boardFootCalc`, `jointStrength`, `woodSelection`, `finishRecommendation`; generic artifact store for jobs/estimates/materials/clients/invoices.

## Has (verified in code)
- Eight modes: jobs, estimates, codes, materials, clients, invoices (+ inspections/certs)
- Board-foot calculator, joint-strength analysis, wood-selection advisor, finish recommendation
- WoodSpeciesReference panel; CarpentryShop component
- Job/estimate/material/client/invoice artifact CRUD

## Missing — buildable feature backlog
- [ ] `[M]` Cut list / lumber optimization (minimize waste from stock boards)
- [ ] `[M]` Project material takeoff → auto estimate
- [ ] `[S]` Photo job-log with before/after per job
- [ ] `[M]` Scheduling / dispatch calendar for crew + jobs
- [ ] `[S]` Estimate → invoice conversion + e-signature on quotes
- [ ] `[S]` Client portal to approve estimates and view progress
- [ ] `[M]` Time tracking per job for labor costing

## Parity
~42% of a trade-management app's surface. The carpentry-specific calculators (board-foot, joints, wood selection) are genuinely useful, but the job-management core — cut lists, takeoffs, scheduling, client portal — is mostly artifact CRUD.
