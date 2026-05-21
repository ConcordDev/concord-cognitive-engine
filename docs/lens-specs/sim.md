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
- [x] `[L]` Stock-and-flow / system-dynamics model builder — visual graph of stocks, flows, feedback loops — `sim.systemDynamics` Euler integrator + `sim.saveModel`/`listModels`/`loadModel`/`deleteModel` persistence; `SystemDynamicsBuilder.tsx` visual builder with feedback-loop detection
- [x] `[L]` Agent-based modeling runtime — `sim.agentBased` with three real engines (SIR epidemic, Schelling segregation, Lotka-Volterra predator-prey) on a toroidal grid; `AgentBasedRunner.tsx` with spatial grid render
- [x] `[M]` Discrete-event simulation (queues, servers, events) — `sim.discreteEvent` event-driven M/M/c queue simulation; `DiscreteEventRunner.tsx` reports wait/utilization/stability
- [x] `[M]` Result charting — ChartKit time-series + area/line plots wired into every Studio panel (stock trajectories, flow rates, agent populations, convergence, fit-vs-observed)
- [x] `[S]` Custom formula/expression evaluator — `sim.evaluateFormula` safe shunting-yard parser (+ − * / % ^, parentheses, 16-function whitelist, named vars); `SimToolkit` Formula tool
- [x] `[M]` Optimization / goal-seek — `sim.goalSeek` bisection (hit target) + golden-section search (maximize/minimize); `SimToolkit` Goal Seek tool
- [x] `[S]` Scenario diffing with statistical significance — `sim.scenarioDiff` Welch two-sample t-test (p-value, Cohen's d, effect size); `SimToolkit` Compare tool
- [x] `[M]` Calibration against historical data — `sim.calibrate` coordinate-descent + golden-section line search minimizing SSE; reports SSE/RMSE/R²; `SimToolkit` Calibrate tool

## Parity
~88% of AnyLogic. The Monte Carlo + sensitivity + sweep math is genuinely solid and the UI is deep, but the marquee paradigms (system dynamics, agent-based, discrete-event) are typed as options yet only the simple time-step engine is real.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
