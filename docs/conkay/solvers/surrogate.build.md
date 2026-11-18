# surrogate.build — reduced-order / surrogate models (SX-XC-07)

Surrogates trained ONLY on the caller's top-tier runs:
polynomial response surfaces, ordinary kriging, and POD
reduced-order models, each serving predictions with error
bars. The catalogue's envelope discipline governs: a
surrogate is valid **inside the training hull only** — a
query outside the per-dimension training range refuses by
name (`outside_training_hull`), and extrapolation is
never served. Engine-scale POD/DMD and GP refuse as
`requires_engine_tier:sxe-01`.
Code: `server/lib/conkay/physics/solvers/surrogate-build.js`
(registry solver, L3).

## Methods (target `build-predict`)

- **poly** — response surface of total degree 1 or 2 by
  ordinary least squares. Error bars are OLS prediction
  intervals (residual sigma × leverage at the query).
  Underdetermined or collinear training sets refuse by
  name — the surface is not identifiable from those runs.
- **kriging** — ordinary kriging, Gaussian correlation in
  range-normalized coordinates, theta selected by
  closed-form leave-one-out cross-validation over a fixed
  grid. Error bars are the native kriging standard
  deviation; training values are reproduced exactly (the
  interpolant property). Training cap 200 points.

Held-out validation: supply `validationData` (points +
values from top-tier runs the surrogate did not train on)
and a `tolerance`; the result reports max/RMS held-out
error and whether it is within tolerance. A miss serves
with a warning naming it — a surrogate is never graded
on its own training points.

## POD (target `pod`)

Snapshots {parameters, fields}: POD modes from the Gram
matrix eigensystem, per-mode coefficient response
surfaces over the parameters, prediction at a new
parameter inside the snapshot hull. Outputs: modes used,
energy captured, singular values, the predicted field,
and an error bar combined in quadrature through the
unit-norm modes (labelled approximate). Caps: 64
snapshots, ≤ 4 parameters.

## Reference + locator

Catalogue reference discipline: self-validated against
held-out top-tier runs. CI reference cases: a quadratic
surface trained on samples of an exactly quadratic
function recovers it with held-out max error < 1e-6 at
tolerance 1e-6; kriging reproduces sin(1.5) at a training
point to < 1e-6; a rank-2 parametric field
u(x; μ) = μ sin πx + μ² cos πx is captured by 2 POD modes
(energy > 0.999999) and predicted at μ = 1.25 with field
error < 1e-6 against the independently computed field.

## Replay

Walker: `conkay_solve` surrogate.build `{method: "poly",
degree: 2, trainingData: {points, values}, queries:
[[0.3, 0.4]]}`, target `build-predict` → PASS with a
prediction + error bar; a query at [2, 0.5] against a
[0,1]² hull → NOT_COMPUTED `outside_training_hull`.
Reachability via solve.direct rides SC-00 (named
foundation); the MCP/chain paths reach the registry entry
as registered.
