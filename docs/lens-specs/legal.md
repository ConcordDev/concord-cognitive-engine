# legal — Feature Gap vs Clio (legal practice management)

Category leader (2026): Clio (legal practice management). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/legal.js` registerLensAction macros (deadlineCheck, contractRenewal, conflictCheck, caseSummary, complianceAudit, deadlineCalculator, generateInvoice, complianceScore) + generic `/api/lens` artifact store.

## Has (verified in code)
- 3400-line practice-management lens: matters/cases, documents, contracts, clients, time entries, deadlines, billing
- ContractAnalyzer, CaseTracker, LegalQA, LegalCaseSearch, ClioSection, legal action panel components
- Deadline check + court-rule deadline calculator, conflict-of-interest check, compliance audit + score, invoice generation
- Case summary, contract-renewal tracking, mobile tab bar, realtime feed, agent FAB

## Missing — buildable feature backlog
- [ ] `[M]` Trust accounting / IOLTA — separate client trust ledgers with three-way reconciliation
- [ ] `[M]` Time-tracking timer with billable-hour capture across activities
- [ ] `[M]` Calendar with court-rule-driven date computation auto-added to a docket
- [ ] `[M]` Client intake forms + e-signature engagement letters
- [ ] `[S]` Document assembly from templates with merge fields
- [ ] `[M]` Payment processing / online client payment portal
- [ ] `[S]` Matter budgeting and realization/collection-rate reporting

## Parity
~60% of Clio's surface. One of the deepest lenses — matters, documents, contracts, billing, conflict checks all present — but missing trust accounting, a billable-hour timer, and document assembly that anchor a real practice-management system.
