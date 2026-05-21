# consulting — Feature Gap vs Bonsai / Harvest

Category leader (2026): Bonsai (consultant practice management); Harvest for time/billing. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: domain macros (`consulting.engagementScope/utilizationRate/proposalScore/clientHealth`) + generic `/api/lens` artifact store; ConsultingFirmReference + EngagementTracker components.

## Has (verified in code)
- 7 modes: Engagements, Proposals, Deliverables, Clients, Timesheets, Frameworks, Pipeline
- Engagement CRUD with type (Strategy/Ops/Tech/M&A/etc), fee, hourly rate, scope, dates
- Dashboard: total revenue, billed hours, active engagements, pipeline count
- AI actions: engagement scope, utilization rate, proposal score, client health
- Framework library + engagement tracker component

## Missing — buildable feature backlog
- [ ] `[M]` Live time tracking — start/stop timer logging billable hours against an engagement
- [ ] `[M]` Invoice generation + tracking — turn billed hours into invoices with paid/overdue states
- [ ] `[M]` Proposal builder — structured proposal document with scope, pricing tiers, e-acceptance
- [ ] `[S]` Pipeline kanban — drag deals across stages with weighted forecast value
- [ ] `[M]` Expense tracking + reimbursables — per-engagement expense log
- [ ] `[S]` Utilization dashboard — billable vs non-billable ratio per consultant over time
- [ ] `[M]` Client portal / shared deliverable links — clients view deliverables and approve

## Parity
~40% of Bonsai's feature surface. Covers engagement and client modeling well, but missing the time-timer, invoicing, and proposal-builder workflow that a practice-management tool centers on.
