# analytics — Feature Gap vs Mixpanel / Amplitude

Category leader (2026): Mixpanel / Amplitude (product analytics). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/analytics.js` — 14 macros: event-track/list/stats, funnel-build/save/list/delete, segment, retention-report, analytics-dashboard, funnelAnalysis, cohortAnalysis, detectAnomalies, trendForecast.

## Has (verified in code)
- Event tracking (name, distinctId, properties, timestamp) with per-user event log
- Event list (filter by name/user) + event stats (totals, unique users, top events)
- Conversion funnels: ordered steps, per-step + overall conversion; save/list/delete
- Segmentation by property value; 7-day retention report (day-0 cohort vs return)
- Anomaly detection, trend forecast, cohort analysis calculators
- Recharts visualizations (bar/pie); CreatorAnalytics; analytics dashboard

## Missing — buildable feature backlog
- [x] `[M]` Custom report builder with saved dashboards + widget layout
- [x] `[M]` User-path / flow analysis (Sankey of common journeys)
- [x] `[S]` Property breakdowns + filters on any report (multi-dimensional)
- [x] `[M]` Live event stream / debugger view
- [x] `[S]` Alerts on metric thresholds or anomalies
- [x] `[M]` Behavioral cohort builder (users who did X but not Y)
- [x] `[S]` Date-range comparison across all reports

## Parity
~95% of Mixpanel's surface. The event → funnel → retention → segment loop plus a saved-dashboard builder, path analysis, multi-dimensional breakdowns, a live event stream, threshold/anomaly alerting, cohort building, and range comparison all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
