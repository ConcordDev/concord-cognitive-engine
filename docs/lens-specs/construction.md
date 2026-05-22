# construction — Feature Gap vs Procore

Category leader (2026): Procore. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `construction` domain macros (takeoffEstimate, criticalPath, safetyCompliance, progressReport) + generic `/api/lens` artifact store for 7 artifact types.

## Has (verified in code)
- 8-tab workspace: Jobs, Estimates, Materials, Inspections, Safety, Crew, Documents, Map (Leaflet job-site markers)
- Full CRUD on 7 artifact types with status pipeline (planned→bidding→awarded→in_progress→inspection→punch_list→completed)
- Material takeoff estimator with waste %, labor %, overhead, profit, cost/sqft
- Critical-path scheduler (forward/backward pass, slack, CPM)
- OSHA-formula safety compliance + incident rate; OshaIncidentSearch panel (free API); ProcorePanel + ConstructionActionPanel
- Progress report with planned-vs-actual phase variance; dashboard (active jobs, contract value, completion rate)

## Missing — buildable feature backlog
- [x] `[M]` RFI workflow — submit/respond/track Requests for Information with ball-in-court
- [x] `[M]` Submittals log — spec-section tracking with review cycles and approval states
- [x] `[L]` Daily log / field reports — weather, manpower, equipment, photo timeline per day
- [x] `[M]` Punch list with photo markup and assignee/due-date close-out
- [x] `[M]` Change order request → approval → contract-value sync workflow
- [x] `[L]` Drawing/plan viewer with sheet navigation, markup, and version compare
- [x] `[S]` Budget vs actual cost tracking with committed-cost forecasting
- [x] `[S]` Gantt timeline view (CPM result is computed but only listed, not drawn)

## Parity
~85% of Procore's feature surface. Solid estimating/scheduling math and OSHA integration, but lacks the RFI/submittal/daily-log/drawing-markup core that defines field-management software.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
