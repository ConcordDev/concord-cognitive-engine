# energy — Feature Gap vs Sense / Span Home

Category leader (2026): Sense (home energy monitor) + Span (panel app). Content fills via free public APIs (EIA) + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `energy` domain macros — pure-compute (consumptionAnalysis, solarEstimate, carbonFootprint, gridStatus) plus live EIA (eia-electricity-rates, eia-generation-mix) and substrate (device add/list/update/delete, reading-log/history, solar-log/summary, rate-set/get).

## Has (verified in code)
- Device registry CRUD; meter reading log + history
- Solar production log + summary; utility rate set/get
- AI actions: consumption analysis, solar estimate, carbon footprint, grid status
- Live EIA data: electricity rates, generation mix; EnergyMonitorSection, EiaPanel, SolarCarbonPanel
- Energy action stack; lens feed

## Missing — buildable feature backlog
- [x] `[M]` Real-time consumption graph — live wattage stream like Sense's main view
- [x] `[M]` Per-device disaggregation — attribute total load to individual devices
- [x] `[S]` Cost projection — estimate the monthly bill from readings + rate
- [x] `[S]` Time-of-use rate modeling with peak/off-peak breakdown
- [x] `[M]` Solar self-consumption vs export tracking with savings
- [x] `[S]` Usage alerts — notify on unusual consumption or a device left on
- [x] `[S]` Historical comparison (this month vs last) charts

## Parity
~95% of a Sense+Span composite. Device registry, readings, solar log, utility rates, live EIA data, real-time wattage stream, per-device disaggregation, cost projection, time-of-use modeling, solar self-consumption vs export, usage alerts and month-over-month comparison are all real and code-verified. Backend macros (`live-sample`/`live-stream`, `disaggregate`, `cost-projection`, `tou-set`/`tou-get`/`tou-breakdown`, `solar-self-consumption`, `usage-alerts`, `month-comparison`) each have a purpose-built UI surface in the Energy Monitor tabs. Remaining gap is licensed/hardware integrations (direct smart-meter telemetry) — structural, not buildable.
