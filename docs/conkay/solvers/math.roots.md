# math.roots — nonlinear equations (SX-NUM-06)

Root finding at the JS tier. Functions arrive as **data** —
polynomial coefficients (descending) for scalar problems,
monomial term lists for systems — so derivatives and Jacobians
are exact and every answer is verified by substitution. Code:
`server/lib/conkay/physics/solvers/roots.js`
(registry solver, L3).

## Operations

- **brent** `{coefficients, bracket: [a, b]}` — Brent's method
  (Numerical Recipes §9.3). The bracket must genuinely straddle
  a sign change: same-sign endpoints are NOT_COMPUTED
  `no_bracket_sign_change`, and no bracket is ever widened or
  assumed.
- **newton** `{coefficients, x0}` — scalar Newton with the exact
  polynomial derivative. The start is declared and echoed —
  Newton is start-dependent and the record says so. A vanishing
  derivative or divergence is NOT_COMPUTED, named.
- **roots** `{coefficients}` — all roots (degree ≤ 20) by
  Durand–Kerner iteration in complex arithmetic, returned as
  {re, im} sorted, each verified by its own residual; the call
  serves only when every root's |p(z)| ≤ 1e-8 · coefficient
  scale, else NOT_COMPUTED naming the failure (clustered or
  multiple roots beyond reach name the companion-eigenvalue
  engine tier).
- **system** `{equations, x0}` — Newton for square multivariate
  polynomial systems given as monomial terms
  `{coeff, powers}`, with the exact Jacobian solved through
  math.linsolve's LU. Verified by the system residual
  (≤ 1e-12). A singular Jacobian mid-iteration is NOT_COMPUTED
  with the iterate named.

## Engine tier (refused by name)

Newton–Krylov and trust-region methods for general systems
(MINPACK hybrd) → `requires_engine_tier:minpack`. General
(non-polynomial) function inputs likewise belong to that tier:
this tier's honesty rests on functions-as-data with exact
derivatives.

## Reference + locator

Numerical Recipes 3e Ch. 9; MINPACK test set (Moré, Garbow,
Hillstrom, ANL-80-74). CI reference cases: the catalogue's
x² − 2 under Brent and Newton (root √2, residuals asserted);
the MINPACK **Rosenbrock** system from its standard start
(−1.2, 1) to the known root (1, 1); known factorizations
(x−1)(x−2)(x−3), (x−1)(x−2)(x−3)(x−4), x² + 1 → ±i, and the
double root (x−2)².

## Replay

Walker: `conkay_solve` math.roots `{coefficients: [1, 0, -2],
bracket: [1, 2]}`, target `brent` → PASS, root √2 with residual
~1e-16; `{coefficients: [1, 0, -2], bracket: [2, 3]}` →
NOT_COMPUTED `no_bracket_sign_change`. Reachability via
solve.direct rides SC-00 (named foundation); the MCP/chain paths
reach the registry entry as registered.
