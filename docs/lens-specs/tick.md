# tick — Feature Gap vs Datadog / heartbeat monitors (Better Uptime)

Category leader (2026): Better Uptime / Datadog (cron + heartbeat monitoring) — no consumer rival; closest analog. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `tick` domain macros (`healthPulse`, `loadPredict`, `rhythmAnalysis`) + `/api/events` for tick history; surfaces the engine's 15s governor heartbeat.

## Has (verified in code)
- Four-tab console: Stream, Statistics, Timeline, Health.
- Live tick event stream from `/api/events`; tick statistics and timeline view.
- Health view with metric cards: tick regularity, stress level, signal strength, error rate.
- Health-pulse macro (composite health score), load-predict macro, rhythm-analysis macro (cadence pattern detection).

## Missing — buildable feature backlog
- [ ] `[M]` Per-heartbeat detail — drill into each of the 68 registered heartbeats with last-run, frequency, error count.
- [ ] `[S]` Skipped-tick / overrun visualization (the `concord_heartbeat_skipped_total` counter exists but is not surfaced).
- [ ] `[M]` Alerting — notify when tick rate drops to 0 or a heartbeat module errors.
- [ ] `[S]` Configurable time-range selector for the stream/timeline.
- [ ] `[M]` Tick latency histogram — how long each governorTick takes.
- [ ] `[S]` Pause / resume / manual-trigger controls for individual heartbeats.
- [ ] `[M]` Historical uptime / SLA percentage over rolling windows.

## Parity
~45% of a heartbeat monitor. The stream/stats/health views over the real governor tick are genuinely useful, but it cannot drill into individual heartbeats, has no alerting, and does not surface the overrun/skip counters that exist in the backend.
