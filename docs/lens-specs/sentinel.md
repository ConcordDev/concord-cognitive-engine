# sentinel — Feature Gap vs CrowdStrike Falcon / threat console

Category leader (2026): no consumer rival — closest analog is a security/threat console (CrowdStrike Falcon, a threat-intel + semantic-search workbench). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `runDomain` against `shield` (status/threats/metrics/scan), `intel` (per-domain intel queries), and `semantic` (status/similar/classify_intent/extract_entities) domains.

## Has (verified in code)
- 3 tabs: Shield, Intel, Semantic
- Shield: status, threat list, metrics, on-demand scan
- Intel: per-domain intelligence queries
- Semantic search: similarity search, intent classification, entity extraction over the corpus

## Missing — buildable feature backlog
- [ ] `[M]` Threat detail + triage — drill into a threat, assign, resolve/dismiss
- [ ] `[M]` Continuous monitoring + alerts — scheduled scans that notify on new threats
- [ ] `[S]` Threat timeline / history — track threats over time, not just a current list
- [ ] `[S]` Shield metrics charts — visualize the metrics rather than raw values
- [ ] `[M]` Intel correlation — link intel findings to active threats
- [ ] `[S]` Configurable scan scope + rules
- [ ] `[S]` Semantic-search saved queries + result export

## Parity
~40% of a threat-console's feature surface. The three subsystems (shield scan, intel query, semantic search) are real and useful, but it is read-and-scan only — it lacks threat triage, continuous monitoring with alerts, and a threat timeline.
