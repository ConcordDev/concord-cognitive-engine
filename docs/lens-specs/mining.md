# mining — Feature Gap vs MineHub / Micromine

Category leader (2026): Micromine / MineHub (mine planning & operations). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/mining.js` — 12 macros: oreGradeCalc, blastDesign, safetyMetrics, resourceEstimate, live MSHA mine-lookup + violations, site CRUD, incident-log, mining-dashboard.

## Has (verified in code)
- Mine-site management — track sites (kind, commodity, production tonnes, status), CRUD
- Safety incident logging — near-miss/minor/serious/fatal; TRIR/LTIR safety metrics
- Operations dashboard — sites, active, total production, serious incidents
- Calculators — ore grade (cutoff, economic %, classification), blast design (burden/spacing/powder factor), resource estimate (tonnage, contained/recoverable metal, gross value)
- Live MSHA mine + violation lookup → DTUs
- Dashboard/cases/incidents tabs, MapView, MineSiteManager

## Missing — buildable feature backlog
- [ ] `[L]` Block model / orebody visualization — 3D grade model from drill samples
- [ ] `[M]` Mine plan / pit design — bench layout, pit shells, scheduling
- [ ] `[M]` Drill-hole database — log holes with intervals, assays, lithology
- [ ] `[M]` Production scheduling — haul cycles, equipment dispatch, daily targets
- [ ] `[S]` Grade-tonnage curve from sample data
- [ ] `[M]` Equipment / fleet management — utilization, maintenance, fuel
- [ ] `[S]` Reserve/resource reporting per JORC/NI 43-101 categories
- [ ] `[S]` GIS pit/bench mapping layer

## Parity
~40% of a mine-management suite. Real domain calculators (grade, blast, resource, safety) plus site records and live MSHA data, but missing block modeling, mine planning, drill-hole databases, and production scheduling that define mine-operations software.
