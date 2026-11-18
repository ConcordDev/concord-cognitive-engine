# math.interp-fit — interpolation, splines, RBF (SX-NUM-13)

Interpolation and fitting at the JS tier. Code:
`server/lib/conkay/physics/solvers/interp-fit.js` (registry
solver, L2). The validity envelope is **inside the data
hull**: every target refuses outside points by name — nothing
here extrapolates quietly.

## Targets

- **spline** — cubic spline, natural or clamped boundary
  conditions (clamped end derivatives are required inputs,
  never guessed). The catalogue reference case is the clamped
  form: with the cubic's own end derivatives, the spline
  reproduces the cubic exactly (CI: x³ on [0, 2] to 1e-9 at
  the quarter points).
- **pchip** — Fritsch–Carlson monotone cubic. The result
  reports the measured monotonicity violation on a fine
  sample (zero by construction, and asserted so).
- **chebyshev** — Chebyshev–Lobatto interpolation of a
  function expression on an interval, barycentric evaluation,
  with a **sampled max-error certificate** in the result
  (exp on [−1, 1] at degree 12: certificate < 1e-8).
- **rbf** — scattered-data interpolation (Gaussian or
  multiquadric) in 1D/2D. The interpolation system is
  residual-verified after the solve (must be ≤ 1e-6 to
  serve); evaluation is bounded by the data bounding box.
- **fit** — polynomial least squares via the SVD machinery.
  A degree ≥ the point count is refused by name: that is
  interpolation, not a fit. Results carry coefficients, RMS
  residual, and R².

## Data discipline

Abscissae must be strictly increasing — unsorted or duplicate
x values are refused, never silently sorted or merged
(sorting someone else's data is a substitution).

## Replay

Walker: `conkay_solve` math.interp-fit `{xs: [0, 0.5, 1, 1.5,
2], ys: [0, 0.125, 1, 3.375, 8], bc: {type: "clamped", da: 0,
db: 12}, points: [0.25, 1.75]}`, target `spline` → PASS with
0.015625 and 5.359375 (x³ exactly); `{xs: [0, 1, 2], ys: [0,
1, 0], points: [2.5]}`, target `spline` → NOT_COMPUTED
`outside_data_hull`. Reachability via solve.direct rides
SC-00 (named foundation); the MCP/chain paths reach the
registry entry as registered.
