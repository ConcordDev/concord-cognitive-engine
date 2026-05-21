# observe — Feature Gap vs Datadog

Category leader (2026): Datadog (observability). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/observe.js` — 4 macros (serviceLog, incidentTrack, alertSummary, sloCheck) over the generic `/api/lens` artifact store, plus an `observer.compose_report` macro for empirical-report DTUs.

## Has (verified in code)
- Service-log summarizer: error-rate, by-level counts, top service over a window
- Incident tracker: open incidents with severity (sev1–4), timeline, status
- Alert summary: firing/resolved counts, mean resolve time, by-service grouping
- SLO check: target vs actual, error budget, burn rate, status (healthy/burning/critical)
- Observer-mode report composition into citable `empirical_report` DTUs
- ObserveActionPanel (Datadog-shape workbench) + ObservabilityRepos panel

## Missing — buildable feature backlog
- [ ] `[L]` Live metrics ingestion + time-series charts — no actual metric stream/graphs, only static artifact summaries
- [ ] `[M]` Dashboards — composable widget grids with saved layouts
- [ ] `[M]` Log search/query language — full-text + faceted log search across services
- [ ] `[M]` Distributed tracing / APM — span waterfall, service-map dependency graph
- [ ] `[S]` Alert rule editor — threshold/anomaly monitor creation, not just alert summarization
- [ ] `[M]` Synthetic monitoring — scheduled uptime/API checks
- [ ] `[S]` Incident on-call paging + notification routing

## Parity
~30% of Datadog's feature surface. It models the observability *concepts* (logs, alerts, SLO, incidents) as artifact summaries but lacks live ingestion, real dashboards, and tracing — it's an analysis layer, not a telemetry platform.
