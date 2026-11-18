# design.optimize-loop — design loop (SX-XC-10)

The design loop at the JS tier (catalogue engine:
JS + SXE-21). Single-objective optimization over a
declared model library, and a multi-objective Pareto
loop over the car mass–range model. Adjoint gradients,
arbitrary chain objectives, and the engine optimizers
(HiGHS/IPOPT class) refuse as
`requires_engine_tier:sxe-21`.
Code: `server/lib/conkay/physics/solvers/design-optimize-loop.js`
(registry solver).

## Single objective (target `optimize`)

Models: `rosenbrock`, `sphere`, `quadratic` (caller's
symmetric matrix + vector), `polynomial` (declared terms,
total degree ≤ 4, analytic gradient). Methods:

- **nelder-mead** — derivative-free simplex, box bounds
  by projection.
- **gradient** — analytic gradient where the model
  declares one (central finite differences otherwise),
  Barzilai–Borwein steps safeguarded by Armijo
  backtracking. (Plain steepest descent was measured in
  this build zigzagging to the budget on an
  ill-conditioned quadratic while sitting 3e-9 from the
  minimizer; BB is the standard cure and is what ships.)

Every run declares its evaluation budget; exhaustion or
non-convergence serves the best point found **with a
warning**, never dressed as an optimum. A start outside
its bounds refuses by name.

## Pareto (target `pareto`)

Model `car-mass-range`: battery energy E over the
caller's range, pack constants declared (specific energy
0.25 kWh/kg, glider 900 kg, consumption
0.12 + 6e-5·mass kWh/km). Candidates come from a
weighted-scalarization sweep (golden-section per weight)
plus a dense sweep of the design parameter — for this
one-parameter family the front IS the model curve (mass
and range both strictly monotonic in E), and weighted
sums alone recovered only 3 distinct points in this
build's measurement, so the parameter sweep is a named
leg of the method. An exact dominance filter
(min mass, max range) decides membership; nothing
dominated is served.

## Reference + locator

Catalogue reference cases: Rosenbrock minimum 0 at
(1, 1) from the classic start (−1.2, 1), pinned to
1e-3 / f < 1e-6; a quadratic whose minimizer is known by
construction (b = A·x*), pinned to 1e-4; the car front
recomputed independently in the suite from the declared
constants and checked point-by-point for dominance.

## Replay

Walker: `conkay_solve` design.optimize-loop `{model:
"rosenbrock", start: [-1.2, 1], method: "nelder-mead"}`,
target `optimize` → PASS, x ≈ (1, 1), objective < 1e-6,
converged true; `{model: "car-mass-range"}`, target
`pareto` → the non-dominated front; target `engine` →
NOT_COMPUTED `requires_engine_tier:sxe-21`.
Reachability via solve.direct rides SC-00 (named
foundation); the MCP/chain paths reach the registry entry
as registered.
