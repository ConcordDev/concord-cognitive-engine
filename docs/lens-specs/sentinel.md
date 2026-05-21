# sentinel — Feature Gap vs CrowdStrike Falcon / threat console

Category leader (2026): no consumer rival — closest analog is a security/threat console (CrowdStrike Falcon, a threat-intel + semantic-search workbench). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `runDomain` against `shield` (status/threats/metrics/scan), `intel` (per-domain intel queries), and `semantic` (status/similar/classify_intent/extract_entities) domains.

## Has (verified in code)
- 3 tabs: Shield, Intel, Semantic
- Shield: status, threat list, metrics, on-demand scan
- Intel: per-domain intelligence queries
- Semantic search: similarity search, intent classification, entity extraction over the corpus

## Missing — buildable feature backlog
- [x] `[M]` Threat detail + triage — drill into a threat, assign, resolve/dismiss
- [x] `[M]` Continuous monitoring + alerts — scheduled scans that notify on new threats
- [x] `[S]` Threat timeline / history — track threats over time, not just a current list
- [x] `[S]` Shield metrics charts — visualize the metrics rather than raw values
- [x] `[M]` Intel correlation — link intel findings to active threats
- [x] `[S]` Configurable scan scope + rules
- [x] `[S]` Semantic-search saved queries + result export

## Parity
Full threat-console feature surface. Backlog shipped via the `sentinel` domain
(`server/domains/sentinel.js`, 26 macros) + a six-tab operator UI
(`app/lenses/sentinel/` + `components/sentinel/`):
- **Shield** — live threat board, on-demand content/hash scan, one-click promote-to-triage.
- **Triage** — case state machine (open → investigating → contained → resolved/dismissed),
  assignee, investigation notes, intel correlation.
- **Monitors** — continuous-monitoring configs (scope + min-severity + interval) with an
  alert inbox; a monitor pass diffs the live `shield.threats` feed and emits new alerts.
- **Metrics** — time-bucketed cases/alerts area chart, severity-mix bar, and the
  append-only threat timeline (ChartKit + TimelineView).
- **Rules** — configurable scan scopes, auto-triage threshold, a custom detection-rule
  book (pattern → severity), and a rule-evaluator against content.
- **Semantic** — corpus search (similar / classify_intent / extract_entities) with a
  saved-query book and CSV/JSON result export.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
