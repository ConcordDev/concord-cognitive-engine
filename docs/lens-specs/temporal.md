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
- [ ] `[M]` Chart rendering — decomposition and forecast return arrays but the page does not plot them.
- [ ] `[M]` Forecast confidence intervals and changepoint detection (Prophet's core).
- [ ] `[S]` Multiple seasonality periods (daily/weekly/yearly) and holiday effects.
- [ ] `[M]` Model comparison / accuracy backtesting (MAE/MAPE on held-out data).
- [ ] `[S]` Data import — CSV upload of a time series.
- [ ] `[M]` Cross-series correlation / lag analysis.
- [ ] `[S]` Annotated event overlays on the time axis.
- [ ] `[M]` Interactive zoom / brushing on the series.

## Parity
~40% of Prophet/Tableau. The three analysis macros are real time-series math, but with no charting, no confidence intervals, no changepoints, and no backtesting it stops well short of a forecasting tool.
