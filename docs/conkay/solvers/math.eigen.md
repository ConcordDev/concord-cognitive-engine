# math.eigen — eigenproblems (SX-NUM-04)

Eigenproblems at the JS tier; the engine class refused by name.
Code: `server/lib/conkay/physics/solvers/eigen.js`
(registry solver, L3).

## Operations (JS tier)

- **eig** `{A}` — the full spectrum of a **symmetric** matrix by
  the classical Jacobi method. Eigenvalues descending, unit
  eigenvectors with a canonical sign (largest-magnitude component
  positive). Every pair is verified before serving: the maximum
  pair residual `||A v − λ v||∞` and the orthonormality defect
  `||VᵀV − I||∞` are computed against the original matrix; a
  defect beyond the declared tolerance FAILs with the evidence.
- **dominant** `{A}` — the dominant eigenpair of a general real
  matrix by power iteration with a Rayleigh quotient, served
  only when its own residual proves it (≤ 1e-9 · ||A||∞).
  Non-convergence inside the cap is NOT_COMPUTED
  `not_converged` with the residual named — a rotation's complex
  dominant pair lands there, never in an approximation.

## Engine tier (refused by name)

The non-symmetric full spectrum (LAPACK DGEEV) and sparse
generalized problems (ARPACK / SLEPc Krylov–Schur, shift-invert)
→ NOT_COMPUTED `requires_engine_tier:lapack-arpack`. The Matrix
Market BCSSTK reference cases belong to that tier: they are
large sparse structural systems, and no dense JS run of them
would be an honest reference pass. Dense cap at this tier:
n ≤ 64.

## Reference + locator

Golub & Van Loan, *Matrix Computations* 4e (§8.5 Jacobi, §7.3
power method); Matrix Market eigen cases. CI reference cases
are analytic: the catalogue's 2×2 `[[2,1],[1,2]]` (λ = 3, 1);
the tridiagonal Toeplitz matrix with the closed-form spectrum
2 − 2cos(kπ/4) = {2−√2, 2, 2+√2}; a diagonal matrix; a rotation
as the not-converged pin.

## Replay

Walker: `conkay_solve` math.eigen `{A: [[2,1],[1,2]]}`, target
`eig` → PASS, eigenvalues [3, 1], residuals ~1e-16; target
`dominant` on `[[0,1],[-1,0]]` → NOT_COMPUTED `not_converged`.
Reachability via solve.direct rides SC-00 (named foundation);
the MCP/chain paths reach the registry entry as registered.
