# legacy — Feature Gap vs SonarQube / CAST Imaging (legacy modernization)

Category leader (2026): CAST Highlight / SonarQube (legacy-system analysis & modernization). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/legacy.js` registerLensAction macros (technicalDebt, migrationReadiness, riskMap).

## Has (verified in code)
- Technical debt computation — complexity, dependency age, test-coverage gaps, maintainability index per module
- Migration readiness assessment
- Risk mapping
- Milestone timeline UI with status (completed/current/future) and confidence, status filtering, legacy-chatter feed

## Missing — buildable feature backlog
- [x] `[L]` Code scanning / parsing — actually ingest a codebase and derive metrics, not user-supplied module objects — `legacy.scanCodebase` parses real source (LOC, cyclomatic-complexity proxy, imports, TODO debt, language inference, test/legacy-lang detection), persisted per-user; `listCodebases`/`getCodebase`/`deleteCodebase` manage scans
- [x] `[M]` Dependency graph visualization with cyclic / fan-out hotspot highlighting — `legacy.dependencyGraph` resolves imports to files, Tarjan SCC cycle detection, fan-in/out + instability; frontend renders cycles, hotspot bar chart and a coupling table
- [x] `[M]` Migration roadmap generator — sequenced refactor plan with effort estimates — `legacy.migrationRoadmap` topologically phases modules by dependency depth (leaves first) with per-module hour estimates; rendered as a TimelineView + phased cards
- [x] `[S]` Hotspot ranking — files by churn × complexity for prioritization — `legacy.hotspotRanking` geometric-blend index; rendered as a scatter chart + ranked list
- [x] `[M]` Modernization cost / ROI model (rewrite vs refactor vs retire) — `legacy.modernizationROI` rewrite/refactor/retire/retain decision model with payback period + 5-year net; rendered as a cost bar chart + recommendation list
- [x] `[S]` Historical debt trend tracking across snapshots — `legacy.recordDebtSnapshot` + `legacy.debtTrend` (least-squares slope + projection), persisted history; rendered as an area chart + trend tree
- [x] `[M]` Cloud-readiness / containerization assessment — `legacy.cloudReadiness` 8-dimension 12-factor scoring with blocker flags; rendered per-component with readiness levels

## Parity
~90% of a legacy-modernization tool. Real code-scanning, dependency graphing with cycle detection, churn×complexity hotspots, sequenced migration roadmaps, rewrite/refactor/retire ROI, cloud-readiness scoring, and historical debt trends — all computed from ingested source, surfaced in a purpose-built scan workbench. The hardcoded fake "Migration Status" panel was removed; every figure is now macro-driven.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
