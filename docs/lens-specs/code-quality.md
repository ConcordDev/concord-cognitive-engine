# code-quality — Feature Gap vs SonarQube / CodeClimate

Category leader (2026): SonarQube / CodeClimate (code-quality + static analysis). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/detectors.js` — macros `list`, `run`, `runAll`, `findings`, `history`, `baseline`, `diff`, `summary`, `macro_telemetry`; runs the internal detector suite (architectural drift, dependency entropy, scaling pressure, unsafe expansion).

## Has (verified in code)
- Detector catalog with descriptions, consumers, data needs
- Run individual detectors or run-all; severity-classified findings (critical→info)
- Findings summary totals; per-detector duration + ok/reason
- History, baseline, and baseline-diff of detector runs
- ReleaseCadence panel; detector telemetry

## Missing — buildable feature backlog
- [ ] `[M]` Per-file / per-line issue annotation with source context
- [ ] `[M]` Quality gate — pass/fail threshold blocking on regression
- [ ] `[S]` Trend charts of issue count over time
- [ ] `[M]` Technical-debt estimate (remediation effort in hours)
- [ ] `[S]` Issue assignment + resolve/won't-fix workflow
- [ ] `[M]` Pull-request decoration (new-issues-in-this-diff)
- [ ] `[S]` Duplication / hotspot detection report

## Parity
~45% of SonarQube's surface. Real detector engine with severities, baselines, and diffs, but lacks per-line annotation, quality gates, debt estimation, and the PR-integration loop that makes SonarQube a CI gate.
