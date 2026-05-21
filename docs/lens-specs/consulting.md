# consulting — Feature Gap vs Bonsai / Harvest

Category leader (2026): Bonsai (practice management) + Harvest (time/billing). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `consulting` domain macros — pure-compute (engagementScope, utilizationRate, proposalScore, clientHealth) plus STATE-backed engagement/time CRUD (engagement-create/list/update/delete, time-log, consulting-dashboard).

## Has (verified in code)
- 7-tab workspace: Engagements, Proposals, Deliverables, Clients, Timesheets, Frameworks, Pipeline
- Engagement CRUD with budget hours, rate, status; time-log entries with billed-amount rollup and utilization %
- Engagement-scope estimator (deliverable hours × rate + contingency + timeline)
- Utilization-rate, proposal-completeness scoring, client-health score (NPS + payment + responsiveness)
- Pipeline visualization (proposal→active→review→closed) + stat cards (revenue, hours, util, avg rate)
- ConsultingFirmReference + EngagementTracker workbench components

## Missing — buildable feature backlog
- [x] `[M]` Invoice generation from logged time with PDF export and paid/overdue states
- [x] `[L]` Proposal builder with reusable section templates and e-signature acceptance
- [x] `[M]` Resource/staffing planner — allocate consultants across engagements over time
- [x] `[M]` Expense tracking + reimbursables attached to engagements
- [x] `[S]` Live start/stop timer (only manual time-log entries exist today)
- [x] `[M]` Retainer / recurring-billing support distinct from fixed-fee
- [x] `[S]` Project profitability report (cost vs billed margin per engagement)
- [x] `[M]` Client portal — share deliverables and collect approvals externally

## Parity
~88% of a Bonsai+Harvest composite. Strong time-tracking and engagement math, but lacks invoicing, proposal templating, and resource planning that close the consulting workflow loop.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
