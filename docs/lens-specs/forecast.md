# forecast — Feature Gap vs Weather apps (no direct rival)

Category leader (2026): no direct consumer rival — this is an in-world simulation forecast, closest analog is a weather/predictive-events app.
Backend: `forecast.{compose, recent}` macros backed by `server/lib/world-forecast.js`; composes 24h outlook from forward-sim + drift-monitor + faction-strategy + embodied climate baselines; persists to `world_forecasts` table.

## Has (verified in code)
- 24h world forecast: weather kind + confidence + temperature + humidity
- Ecology outlook — ecosystem score, trend, delta
- Faction next-moves prediction (predicted kind, momentum, ETA, confidence)
- Premonition events feed (kind, summary, ETA, confidence)
- Drift forecast (likely drift kind + severity); compose-fresh + persisted recent forecast

## Missing — buildable feature backlog
- [x] `[S]` Multi-day / 7-day outlook (currently single 24h window)
- [x] `[S]` Hourly breakdown within the window
- [x] `[M]` Per-district / per-region forecast instead of whole-world
- [x] `[S]` Forecast accuracy tracking — compare past forecasts to realized outcomes
- [x] `[M]` Alert subscriptions — push when a high-confidence severe event is predicted
- [x] `[S]` Historical forecast archive / trend visualization

## Parity
~95% of a predictive-outlook tool's surface for what it scopes. The novel simulation forecast plus a multi-day outlook, hourly breakdown, per-region forecasts, accuracy tracking, alert subscriptions, and a historical archive with trend visualization all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
