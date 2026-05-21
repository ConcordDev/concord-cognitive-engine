# construction — Feature Gap vs Procore

Category leader (2026): Procore. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: domain macros (`construction.takeoffEstimate/criticalPath/safetyCompliance/progressReport`) + generic `/api/lens` artifact store; OshaIncidentSearch + ProcorePanel components.

## Has (verified in code)
- 8 modes: Jobs, Estimates, Materials, Inspections, Safety, Crew, Documents, Map
- Per-artifact CRUD with status workflow (planned→bidding→awarded→in_progress→inspection→punch_list→completed)
- Estimate breakdown (labor/material/overhead/profit), material takeoffs, crew assignments by trade
- Job-site Map view with lat/lng markers; portfolio dashboard (active jobs, contract value, completion rate)
- AI actions: takeoff estimate, critical path, safety compliance, progress report
- OSHA incident search panel (free public API)

## Missing — buildable feature backlog
- [ ] `[L]` Gantt/CPM schedule view — visual critical path with dependencies, not just a macro
- [ ] `[M]` RFI + submittal workflow — track requests-for-information and submittal approvals
- [ ] `[M]` Change-order management — first-class CO objects with cost/schedule impact and approval chain
- [ ] `[M]` Daily log with photo attachments — weather, manpower, equipment, progress photos per day
- [ ] `[M]` Punch-list tracker — itemized deficiency items with assignee and sign-off
- [ ] `[S]` Drawing/plan markup — annotate uploaded blueprints
- [ ] `[L]` Budget vs actual cost tracking — commitments, invoices, draw schedule

## Parity
~45% of Procore's feature surface. Solid multi-artifact tracker with map and OSHA data, but lacks the scheduling, RFI/submittal, and financial-controls depth that defines Procore.
