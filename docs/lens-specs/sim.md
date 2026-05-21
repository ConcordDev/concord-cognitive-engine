# sim — Feature Gap vs AnyLogic / Vensim

Category leader (2026): AnyLogic / Vensim (simulation modeling). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `sim` domain (4 macros: `scenarioRun`, `parameterSweep`, `monteCarlo`, `sensitivityAnalysis`). Pure-compute; no external API.

## Has (verified in code)
- Discrete time-step simulation engine with rule types (growth/decay/multiply/add/cap/floor)
- Parameter sweep across a range; best-outcome detection
- Monte Carlo trials (up to 10k) with normal/uniform sampling, percentiles, 90% CI
- Sensitivity analysis with elasticity ranking (most/least sensitive parameter)
- Rich 6-tab UI: scenarios, parameters, runs, results, comparison, models — variable distributions (uniform/normal/poisson/beta/triangular), assumptions, run history, comparison view
- Realtime panel, DTU export, model library (SimRepos)

## Missing — buildable feature backlog
- [ ] `[L]` Stock-and-flow / system-dynamics model builder — visual graph of stocks, flows, feedback loops
- [ ] `[L]` Agent-based modeling runtime — modelType is typed but no agent engine exists
- [ ] `[M]` Discrete-event simulation (queues, servers, events) — typed but not implemented
- [ ] `[M]` Result charting — histograms, tornado diagrams, time-series plots beyond raw numbers
- [ ] `[S]` Custom formula/expression evaluator beyond sum/product/max/min
- [ ] `[M]` Optimization / goal-seek — find parameter values that hit a target output
- [ ] `[S]` Scenario diffing in the comparison tab with statistical significance
- [ ] `[M]` Calibration against historical data

## Parity
~45% of AnyLogic. The Monte Carlo + sensitivity + sweep math is genuinely solid and the UI is deep, but the marquee paradigms (system dynamics, agent-based, discrete-event) are typed as options yet only the simple time-step engine is real.
