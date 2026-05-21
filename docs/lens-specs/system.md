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
- [ ] `[M]` Live time-series metrics — CPU/memory/heap/request-rate graphs (Prometheus is wired in the stack but not surfaced here).
- [ ] `[M]` Alerting UI — Prometheus alert rules exist; surface fired alerts and acknowledge them.
- [ ] `[M]` Log viewer / search over server logs.
- [ ] `[S]` Auto-refresh / live polling of the system report.
- [ ] `[M]` Per-heartbeat health — last-run time, error count, skipped-tick counter per module.
- [ ] `[M]` Distributed-trace / request-latency view.
- [ ] `[S]` Customizable dashboard panels.
- [ ] `[S]` Historical trend of coverage/drift over time, not just current snapshot.

## Parity
~45% of Datadog/Grafana. It is a strong static self-audit (heartbeats, coverage, drift, gaps) but lacks live time-series metrics, alerting surface, and log search — the realtime observability that defines the category.
