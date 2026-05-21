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
- [ ] `[M]` Payroll run + pay-stub generation
- [ ] `[M]` Benefits enrollment workflow (open enrollment, plan selection)
- [ ] `[S]` Employee self-service portal (update info, view paystubs, request time off)
- [ ] `[S]` Time/attendance clock-in tracking
- [ ] `[M]` Learning management — assign + track training courses (tab exists, thin)
- [ ] `[S]` Compliance document acknowledgement workflow
- [ ] `[S]` Org-wide analytics dashboards (diversity, tenure, comp distribution)

## Parity
~65% of BambooHR's feature surface. The HCM core (employees, org chart, time off, reviews, recruiting) is solid and broad, but it lacks payroll, benefits enrollment, an employee self-service portal, and a real LMS — features that distinguish Workday-class suites.
