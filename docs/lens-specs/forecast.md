# forecast — Feature Completeness Spec

Rival app(s): none — this is a Concordia world-simulation lens, not a
domain-app port. It surfaces a 24-hour forecast for a Concordia world.

## Features

### World forecast
- [x] Compose a 24h forecast — weather + ecology trend + faction next moves + premonition events + drift watch (macro: forecast.compose)
- [x] Read the most recent composed forecast (macro: forecast.recent)
- [x] Frontend — weather / ecology / faction-strategy / premonitions / drift-watch panels, per-world selector, `WeatherForecast` component

The forecast is assembled from the embodied substrate already shipped:
Layer 7 embodied signals (weather baseline), per-player ecology
metrics, Layer 11 faction strategy, Layer 10 forward-sim
(premonitions), and the Layer 12 drift monitor.

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| External real-time feed | a free public data source | **Feed-exempt.** `forecast` is a world-simulation lens — its data is the internal Concordia simulation state (forward-sim, drift, faction strategy, embodied baselines), not external real-world data. There is no rival real-world app and no public API to ingest. Per the Boundary register convention, infrastructure/world lenses are feed-exempt. |

## Verification log
- 2026-05-20: Backend — `forecast.compose` / `forecast.recent` macros registered inline in `server.js` (lines ~70470). Verified present and exercised by the lens page.
- 2026-05-20: Frontend — lens page composes + renders forecast panels; no feed button (feed-exempt).
