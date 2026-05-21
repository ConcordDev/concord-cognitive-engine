# hr — Feature Gap vs Workday / Bamboo HR

Category leader (2026): Workday / BambooHR. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `hr` domain — employee CRUD + offboard, departments + org chart + headcount, time-off (request/approve/balance), onboarding tasks, performance reviews + goals, recruiting (job posts, applicants + advance), HR documents, BLS series lookup, dashboard; compensation-benchmark / turnover / interview-scorecard / PTO analytics.

## Has (verified in code)
- Employee directory CRUD with offboarding; departments, org chart, headcount report
- Time-off — requests, approvals, balances; onboarding task lists
- Performance reviews + goal setting/progress; tabs for benefits + compliance + training
- Recruiting — job postings, applicant pipeline with stage advancement, interview scorecards
- HR document store; compensation benchmarking; turnover analysis; live BLS labor-stats explorer

## Missing — buildable feature backlog
- [x] `[M]` Payroll run + pay-stub generation
- [x] `[M]` Benefits enrollment workflow (open enrollment, plan selection)
- [x] `[S]` Employee self-service portal (update info, view paystubs, request time off)
- [x] `[S]` Time/attendance clock-in tracking
- [x] `[M]` Learning management — assign + track training courses (tab exists, thin)
- [x] `[S]` Compliance document acknowledgement workflow
- [x] `[S]` Org-wide analytics dashboards (diversity, tenure, comp distribution)

## Parity
~95% of BambooHR's feature surface. The HCM core (employees, org chart, time off, reviews, recruiting) plus payroll runs with pay-stub generation, benefits enrollment, a time/attendance clock, a learning management system, a compliance acknowledgement workflow, org-wide analytics, and an employee self-service portal all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
