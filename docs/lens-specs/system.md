# system — Feature Gap vs Datadog / Grafana (observability)

Category leader (2026): Datadog / Grafana — system observability dashboard. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: cartographer report endpoint + `/api/analytics` + `/api/plugins`; reads heartbeat runtime, coverage, drift from the system self-audit.

## Has (verified in code)
- Eight-tab system console: overview, heartbeats, gaps, coverage, drift, analytics, plugins, substrate.
- Heartbeat inventory — registered heartbeats with frequency and never-disable flag, runtime booted state.
- Gaps view — dormant modules + headless backends count.
- Coverage view — present/partial/missing per subsystem with filter and percentage.
- Drift view — claimed-vs-actual numeric drift across docs/code.
- Analytics tab (per-player/per-world/global activity), plugin browser/installer, substrate stats.
- Keyboard tab navigation.

## Missing — buildable feature backlog
- [x] `[M]` Live time-series metrics — CPU/memory/heap/request-rate graphs (`system.sample`/`metrics` macros + `MetricsPanel.tsx`, real `process.memoryUsage()`/`cpuUsage()` ring buffer).
- [x] `[M]` Alerting UI — Prometheus alert rules parsed from `alerts.yml`, evaluated against the live sample, acknowledgeable per-user (`system.alerts`/`alert-ack` + `AlertsPanel.tsx`).
- [x] `[M]` Log viewer / search over server logs (`system.logs` over the in-process logger buffer + `LogViewer.tsx` with level/source/text filters).
- [x] `[S]` Auto-refresh / live polling of the system report (`system.live-status` + `useLiveStatus.ts` hook, shared pause/play across all realtime panels).
- [x] `[M]` Per-heartbeat health — last-run time, error count, skipped-tick counter per module (`system.heartbeat-health` + `HeartbeatHealthPanel.tsx`).
- [x] `[M]` Distributed-trace / request-latency view (`system.trace-record`/`traces` with p50/p95/p99 + per-route rollup + `TracesPanel.tsx`).
- [x] `[S]` Customizable dashboard panels (`system.dashboard-load`/`save`/`reset` per-user layout + `CustomDashboard.tsx`).
- [x] `[S]` Historical trend of coverage/drift over time (`system.history-snapshot`/`history` snapshot timeline + `TrendPanel.tsx`).

## Parity
~90% of Datadog/Grafana. Static self-audit (heartbeats, coverage, drift, gaps) plus the realtime layer that defines the category: live time-series metrics, fired-alert surface with acknowledgement, log search, per-heartbeat health, request-latency traces, customizable dashboards, and historical coverage/drift trend.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
