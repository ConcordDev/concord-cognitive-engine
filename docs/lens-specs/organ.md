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
- [ ] `[M]` Visual org chart — render the hierarchy as an interactive tree/D3 chart, not just metrics
- [ ] `[M]` Headcount planning / scenarios — model open reqs, reorg what-ifs, projected cost
- [ ] `[M]` Drag-to-reassign — restructure reporting lines directly in the chart
- [ ] `[S]` Compensation + budget rollups — total comp per subtree/department
- [ ] `[M]` HRIS import — CSV/BambooHR/Workday sync of the employee roster
- [ ] `[S]` Tenure / attrition view — flight-risk and time-in-role overlays
- [ ] `[M]` Org snapshots over time — diff the chart across dates to see growth/reorgs

## Parity
~40% of ChartHop's feature surface. The analytical macros are unusually deep and the substrate-health framing is unique, but with no visual chart, no scenario planning, and no HRIS import it is an org-analytics tool rather than an org-design platform.
