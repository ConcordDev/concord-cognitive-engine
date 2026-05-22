# cri — Feature Gap vs data-quality scorecard tooling

Category leader (2026): no direct consumer rival — internal utility. Closest analog: a data-quality scorecard tool (Monte Carlo / Great Expectations) blended with incident severity triage. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `cri` domain macros (severityAssessment, responseTimeline, stakeholderImpact); reads `/api/dtus` for CRETI quality scores.

## Has (verified in code)
- CRETI quality-score table over DTUs — sortable by composite + 5 sub-scores (coherence, relevance, evidence, timeliness, integration), threshold filter, asc/desc
- Quality-distribution chart (avg/max/median/min); per-DTU detail drill-in
- AI actions: severity assessment, response timeline, stakeholder impact
- LensFeaturePanel + CrisisActionPanel + realtime data panel + DTU export

## Missing — buildable feature backlog
- [x] `[M]` Quality trend over time — track composite score movement per DTU/corpus
- [x] `[M]` Score-rule configuration — adjust CRETI weighting and thresholds in-UI
- [x] `[S]` Bulk remediation — select low-quality DTUs and batch-improve/flag
- [x] `[S]` Alerting on quality regressions — notify when a DTU drops below threshold
- [x] `[M]` Root-cause linkage — connect a low score to its contributing dimension with fixes
- [x] `[S]` Side-by-side comparison of two DTUs' quality profiles

## Parity
~88% of a data-quality scorecard tool. Solid scoring, multi-dimension sorting, and distribution view; missing trend tracking, configurable rules, and remediation/alerting that close the quality loop.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
