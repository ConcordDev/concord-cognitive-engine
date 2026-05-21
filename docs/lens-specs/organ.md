# organ — Feature Gap vs ChartHop

Category leader (2026): ChartHop / Lattice org-design tooling. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/organ.js` — 3 macros (org-chart structural analysis, team-composition skills/diversity scoring, communication-flow network analysis); page also reads `/api/status` + `/api/system/health` for substrate-organ health monitoring and mounts `AnatomyExplorer`.

## Has (verified in code)
- Substrate organ health monitor: maturity/wear/plasticity gauges, critical-alert panel, bio-age indicator, dependency graph
- Org chart analysis: span of control, depth, flatness ratio, bottleneck managers, subtree sizes
- Team composition: skills coverage matrix, gaps + single-points-of-failure, Shannon skill diversity, Belbin role balance, Simpson demographic diversity
- Communication flow: directed graph, density, reciprocity, hubs/brokers (betweenness), silo detection, avg path length
- Grid/timeline views, search/sort, repair-cycle trigger with confirmation modal

## Missing — buildable feature backlog
- [x] `[M]` Visual org chart — render the hierarchy as an interactive tree/D3 chart, not just metrics
- [x] `[M]` Headcount planning / scenarios — model open reqs, reorg what-ifs, projected cost
- [x] `[M]` Drag-to-reassign — restructure reporting lines directly in the chart
- [x] `[S]` Compensation + budget rollups — total comp per subtree/department
- [x] `[M]` HRIS import — CSV/BambooHR/Workday sync of the employee roster
- [x] `[S]` Tenure / attrition view — flight-risk and time-in-role overlays
- [x] `[M]` Org snapshots over time — diff the chart across dates to see growth/reorgs

## Parity
~90% parity. Full ChartHop-parity org-design platform shipped. The `OrgDesigner` component (`components/organ/OrgDesigner.tsx`) mounts a six-tab surface: visual org chart (TreeDiagram + roster table), reassign reporting lines, HRIS CSV import (BambooHR/Workday/generic), headcount-planning scenarios with fully-loaded cost projection, compensation/budget rollups per department + manager subtree, tenure/attrition with flight-risk overlays, and dated org snapshots with cross-date diffs. Backed by 13 STATE-persistent macros in `server/domains/organ.js` (roster-set/list, employee-upsert/remove, reassign, hris-import, comp-rollup, tenure-attrition, scenario-create/list/delete, snapshot-capture/list/diff). The original three analytical macros + substrate-health framing remain, making this an org-design platform rather than just org-analytics.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
