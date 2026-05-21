# legacy — Feature Gap vs SonarQube / CAST Imaging (legacy modernization)

Category leader (2026): CAST Highlight / SonarQube (legacy-system analysis & modernization). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/legacy.js` registerLensAction macros (technicalDebt, migrationReadiness, riskMap).

## Has (verified in code)
- Technical debt computation — complexity, dependency age, test-coverage gaps, maintainability index per module
- Migration readiness assessment
- Risk mapping
- Milestone timeline UI with status (completed/current/future) and confidence, status filtering, legacy-chatter feed

## Missing — buildable feature backlog
- [ ] `[L]` Code scanning / parsing — actually ingest a codebase and derive metrics, not user-supplied module objects
- [ ] `[M]` Dependency graph visualization with cyclic / fan-out hotspot highlighting
- [ ] `[M]` Migration roadmap generator — sequenced refactor plan with effort estimates
- [ ] `[S]` Hotspot ranking — files by churn × complexity for prioritization
- [ ] `[M]` Modernization cost / ROI model (rewrite vs refactor vs retire)
- [ ] `[S]` Historical debt trend tracking across snapshots
- [ ] `[M]` Cloud-readiness / containerization assessment

## Parity
~40% of a legacy-modernization tool. The debt and risk math is real, but it operates on hand-supplied module descriptors — missing the actual code-scanning, dependency graphing, and roadmap generation that make CAST/Sonar useful.
