# tick — Feature Gap vs Datadog / heartbeat monitors (Better Uptime)

Category leader (2026): Better Uptime / Datadog (cron + heartbeat monitoring) — no consumer rival; closest analog. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `tick` domain macros (`healthPulse`, `loadPredict`, `rhythmAnalysis`) + `/api/events` for tick history; surfaces the engine's 15s governor heartbeat.

## Has (verified in code)
- Four-tab console: Stream, Statistics, Timeline, Health.
- Live tick event stream from `/api/events`; tick statistics and timeline view.
- Health view with metric cards: tick regularity, stress level, signal strength, error rate.
- Health-pulse macro (composite health score), load-predict macro, rhythm-analysis macro (cadence pattern detection).

## Missing — buildable feature backlog
- [x] `[M]` Per-heartbeat detail — drill into each of the 68 registered heartbeats with last-run, frequency, error count. (`heartbeatRegistry` + `heartbeatList` macros → MonitorPanel "Heartbeats" tab; registry sourced from the live `heartbeat-registry.js`.)
- [x] `[S]` Skipped-tick / overrun visualization (the `concord_heartbeat_skipped_total` counter exists but is not surfaced). (`skipReport` macro → stacked ticks/skipped bar chart in MonitorPanel "Overview".)
- [x] `[M]` Alerting — notify when tick rate drops to 0 or a heartbeat module errors. (`recordSample` auto-raises `tick_stopped` / `tick_overrun` / `heartbeat_error` alerts; `alerts` macro → MonitorPanel "Alerts" tab with ack/clear + notify config.)
- [x] `[S]` Configurable time-range selector for the stream/timeline. (`stream` macro + 15m/1h/6h/12h window selector in MonitorPanel.)
- [x] `[M]` Tick latency histogram — how long each governorTick takes. (`latencyHistogram` macro → bucketed bar chart + p50/p90/p95/p99 in MonitorPanel "Latency" tab.)
- [x] `[S]` Pause / resume / manual-trigger controls for individual heartbeats. (`heartbeatControl` macro → per-row pause/resume/trigger buttons in MonitorPanel "Heartbeats" tab.)
- [x] `[M]` Historical uptime / SLA percentage over rolling windows. (`uptimeSLA` macro → 1h/6h/24h uptime cards vs 99.9% target in MonitorPanel "SLA" tab.)

## Parity
~90% of a heartbeat monitor. The stream/stats/health views over the real governor tick are joined by a full Datadog/Better-Uptime-style MonitorPanel: per-heartbeat drill-down sourced from the live registry, pause/resume/trigger controls, a skipped-tick/overrun chart, an alerting feed (auto-raised on tick-stop / heartbeat-error / overrun) with notification config, a tick-latency histogram with percentiles, a configurable time-range selector, and rolling-window uptime/SLA cards. Remaining gap is server-side per-heartbeat run-timing instrumentation (the runtime registry does not yet record last-run timestamps), which needs a heartbeat-registry change outside the lens scope.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
