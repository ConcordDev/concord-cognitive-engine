# analytics — Feature Completeness Spec

Rival app(s): Mixpanel, Amplitude (2026)
Sources:
- https://mixpanel.com/ (event-based model, funnels, retention, segmentation, dashboards)
- https://amplitude.com/ (events, funnels, cohort analysis, retention)
- Web search 2026-05-20: both use an event-based model — every user action is an event with properties; core reports are segmentation, funnels, retention

## Features

### Event tracking
- [x] Track events — name, distinctId, properties, timestamp; 50k-event ring buffer (macro: analytics.event-track)
- [x] Event list — filter by name / user (macro: analytics.event-list)
- [x] Event stats — totals, unique users, top events (macro: analytics.event-stats)

### Funnels
- [x] Build a conversion funnel — ordered event steps, per-step + overall conversion (macro: analytics.funnel-build)
- [x] Save / list (with live recomputed result) / delete funnels (macro: analytics.funnel-save / funnel-list / funnel-delete)

### Segmentation & retention
- [x] Segment an event by a property value (macro: analytics.segment)
- [x] Retention report — day-0 cohort vs return event over 7 days (macro: analytics.retention-report)
- [x] Analytics dashboard — events, users, today, event types, saved funnels (macro: analytics.analytics-dashboard)

### Calculators (retained)
- [x] Funnel analysis on supplied stages (macro: analytics.funnelAnalysis)
- [x] Cohort analysis (macro: analytics.cohortAnalysis)
- [x] Anomaly detection (macro: analytics.detectAnomalies)
- [x] Trend forecast (macro: analytics.trendForecast)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Auto-instrumented event capture from a live product | an SDK embedded in a real app | explicit `event-track` macro + a per-user event log; the lens is the analysis workbench |
| ML predictive cohorts (Amplitude) | a trained churn/activation model | deterministic retention report + cohort analysis calculator |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/analytics.js` clean. 12 macros
  (4 calculators + 8 event-analytics substrate).
- 2026-05-20: Tests — `tests/analytics-domain-parity.test.js` 10/10 green
  (event-track + per-user scope + unnamed reject / event-stats unique users +
  top events / funnel ordered conversion + 2-step minimum / funnel save-list-
  delete with live recompute / segment by property / retention day-0 cohort /
  dashboard / legacy calculators intact).
- 2026-05-20: Frontend — new `EventAnalytics` (event tracker, funnel builder
  with conversion bars, segment breakdown, retention sparkline) mounted in
  the analytics lens page. `npx tsc --noEmit` exit 0.
