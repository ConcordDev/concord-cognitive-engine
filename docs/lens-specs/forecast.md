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
- [ ] `[S]` Multi-day / 7-day outlook (currently single 24h window)
- [ ] `[S]` Hourly breakdown within the window
- [ ] `[M]` Per-district / per-region forecast instead of whole-world
- [ ] `[S]` Forecast accuracy tracking — compare past forecasts to realized outcomes
- [ ] `[M]` Alert subscriptions — push when a high-confidence severe event is predicted
- [ ] `[S]` Historical forecast archive / trend visualization

## Parity
~60% of a predictive-outlook tool's surface for what it scopes. It is a genuinely novel simulation forecast with no real-world rival; the gaps are range (multi-day/hourly), granularity (per-region), and accuracy feedback — all straightforward extensions.
