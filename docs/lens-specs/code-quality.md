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
- [x] `[M]` Per-file / per-line issue annotation with source context
- [x] `[M]` Quality gate — pass/fail threshold blocking on regression
- [x] `[S]` Trend charts of issue count over time
- [x] `[M]` Technical-debt estimate (remediation effort in hours)
- [x] `[S]` Issue assignment + resolve/won't-fix workflow
- [x] `[M]` Pull-request decoration (new-issues-in-this-diff)
- [x] `[S]` Duplication / hotspot detection report

## Parity
~88% of SonarQube's surface. The internal detector engine (severities,
baselines, diffs) is joined by a real per-language static analyzer over
submitted source: it tokenizes, walks functions, computes cyclomatic
complexity / nesting / maintainability index, detects duplication, and
produces per-line annotations, a SQALE-style technical-debt estimate,
duplication + complexity hotspot reports, a configurable quality gate with
regression blocking, an assign/resolve/won't-fix issue workflow, and
pull-request diff decoration (new-issues-in-this-diff with verdict). All
backed by `code-quality.*` macros — no synthesized data. Remaining gap vs
SonarQube is the live CI/SCM webhook integration loop.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
