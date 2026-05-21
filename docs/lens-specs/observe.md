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
- [x] `[L]` Live metrics ingestion + time-series charts — metricIngest/metricList/metricQuery macros + Metrics tab with ChartKit time-series
- [x] `[M]` Dashboards — composable widget grids with saved layouts (dashboardSave/List/Delete + Dashboards tab)
- [x] `[M]` Log search/query language — full-text + faceted log search across services (logIngest/logSearch with `level:`/`service:` DSL + Log Search tab)
- [x] `[M]` Distributed tracing / APM — span waterfall, service-map dependency graph (traceIngest/traceList/traceDetail/serviceMap + APM tab)
- [x] `[S]` Alert rule editor — threshold/anomaly monitor creation + evaluation (monitorSave/List/Delete/Evaluate + Monitors tab)
- [x] `[M]` Synthetic monitoring — scheduled uptime/API checks with real HTTP execution (syntheticSave/List/Delete/Run + Synthetics tab)
- [x] `[S]` Incident on-call paging + notification routing (oncallSetup/Status/pageOnCall/acknowledgePage + On-Call tab)

## Parity
~85% of Datadog's feature surface. It models the observability *concepts* (logs, alerts, SLO, incidents) as artifact summaries but lacks live ingestion, real dashboards, and tracing — it's an analysis layer, not a telemetry platform.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
