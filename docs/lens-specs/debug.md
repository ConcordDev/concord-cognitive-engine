# debug — Feature Gap vs Sentry / Datadog

Category leader (2026): Sentry (error tracking) + Datadog (observability). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `debug` domain macros (logAnalysis, errorCluster, performanceProfile, stackTraceAnalysis); system/DB/jobs/memory status panels; InferenceTranscriptViewer, SLODashboard, ProvenanceDashboard, NvdCveFeed, ComputePanel components.

## Has (verified in code)
- 4 status panels: System, Database, Jobs, Memory
- AI actions: log analysis, error clustering, performance profiling, stack-trace analysis
- SLO dashboard; provenance dashboard; inference transcript viewer
- NVD CVE feed (live public vulnerability API); compute/platform panel
- Lens template generator utility

## Missing — buildable feature backlog
- [ ] `[L]` Live error stream / issue inbox — ingest and group runtime exceptions with occurrences
- [ ] `[M]` Distributed trace viewer — span waterfall across a request
- [ ] `[M]` Alert rules — configure thresholds that notify on metric breach
- [ ] `[M]` Time-series metric charts — CPU/memory/latency over time, not point-in-time
- [ ] `[S]` Issue assignment + resolution workflow (open/resolved/ignored)
- [ ] `[S]` Release tracking — tie errors to a deploy/version
- [ ] `[S]` Breadcrumb / event timeline leading up to an error

## Parity
~40% of a Sentry+Datadog composite. Strong internal observability scaffold (SLO, provenance, CVE feed, status panels), but missing the live error-inbox, trace waterfall, alert rules, and time-series charts that define APM tools.
