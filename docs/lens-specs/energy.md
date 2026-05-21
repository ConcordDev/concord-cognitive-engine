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
- [ ] `[M]` Real-time consumption graph — live wattage stream like Sense's main view
- [ ] `[M]` Per-device disaggregation — attribute total load to individual devices
- [ ] `[S]` Cost projection — estimate the monthly bill from readings + rate
- [ ] `[S]` Time-of-use rate modeling with peak/off-peak breakdown
- [ ] `[M]` Solar self-consumption vs export tracking with savings
- [ ] `[S]` Usage alerts — notify on unusual consumption or a device left on
- [ ] `[S]` Historical comparison (this month vs last) charts

## Parity
~55% of a Sense+Span composite. Device registry, readings, solar log, utility rates, and live EIA data are real, but missing the real-time consumption graph, per-device disaggregation, and bill projection that define home energy monitors.
