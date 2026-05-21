# cri — Feature Gap vs internal DTU quality / crisis tooling

Category leader (2026): no direct consumer rival — internal utility. Closest analog: a data-quality scorecard tool (e.g. Monte Carlo / Great Expectations) blended with incident severity triage. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: domain macros (`cri.severityAssessment/responseTimeline/stakeholderImpact`); 359-line domain; reads `/api/dtus?limit=300` for CRETI quality scores.

## Has (verified in code)
- CRETI quality-score table over DTUs (sortable by composite + sub-scores, threshold filter)
- Quality-distribution chart; per-DTU detail drill-in
- AI actions: severity assessment, response timeline, stakeholder impact
- LensFeaturePanel + CrisisActionPanel + realtime data panel + DTU export

## Missing — buildable feature backlog
- [ ] `[M]` Quality trend over time — track composite score movement per DTU/corpus
- [ ] `[M]` Score-rule configuration — adjust CRETI weighting and thresholds in-UI
- [ ] `[S]` Bulk remediation actions — select low-quality DTUs and batch-improve/flag
- [ ] `[S]` Alerting on quality regressions — notify when a DTU drops below threshold
- [ ] `[M]` Root-cause linkage — connect a low score to its contributing dimension with fixes
- [ ] `[S]` Comparison view — diff two DTUs' quality profiles side by side

## Parity
~50% of a data-quality scorecard tool. Solid scoring, sorting, and distribution view; missing trend tracking, configurable rules, and remediation/alerting that close the quality loop.
