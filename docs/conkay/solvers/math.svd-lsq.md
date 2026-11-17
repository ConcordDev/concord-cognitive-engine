# math.svd-lsq — SVD, least squares (SX-NUM-05)

SVD and least squares at the JS tier. Code:
`server/lib/conkay/physics/solvers/svd-lsq.js`
(registry solver, L2). Convention: A = U · diag(s) · Vt, U
(m×k) orthonormal columns, Vt (k×n) orthonormal rows,
k = min(m, n), s descending.

## Operations

- **svd** `{A}` — one-sided Jacobi (Hestenes) SVD, verified by
  reconstruction `||U S Vt − A||∞` on every call; a defect beyond
  1e-9 · ||A|| FAILs instead of serving.
- **lsq** `{A, b, rcond?}` — minimum-norm least squares via the
  pseudo-inverse. Singular values ≤ rcond · σmax (default
  rcond 1e-12, declared in the inputs) are truncated, and the
  truncation is **declared in the output** (effectiveRank,
  truncatedSingularValues). Optimality is verified by the
  normal-equation residual `||Aᵀ(Ax − b)||∞`.
- **rank** `{A, rcond?}` — effective rank under the declared
  rcond, with the singular values and the cutoff.
- **tikhonov** `{A, b, lambda}` — ridge solution by SVD filter
  factors σ/(σ² + λ²). λ is required: no regularization is ever
  assumed (SC-03).
- **tls** `{A, b}` — total least squares from the smallest right
  singular vector of [A | b]; a ~0 last component means no finite
  TLS solution and returns NOT_COMPUTED
  `tls_no_finite_solution`.

Sizes capped at 64×64 at this tier; larger systems name the
engine tier in the refusal.

## Reference + locator

NIST StRD linear regression sets; Golub & Van Loan, *Matrix
Computations* 4e Ch. 5–6. The CI reference case is the StRD
**Longley** set (Longley 1967), data and certified values
re-pulled from itl.nist.gov for this build. Longley is the
higher-difficulty collinearity case (σ range 1.66e6 … 3.42e-4 on
the design): this build's SVD path agrees with the certified
coefficients to **11.1–12.5 digits** and the residual sum of
squares to **13 digits**, where a normal-equations solve in
double precision visibly loses digits. The test asserts a
conservative 1e-6 relative bound on coefficients and 1e-9 on
the RSS. Analytic pins alongside: σ = {√3, 1} for a 3×2 case
(AᵀA eigenvalues 3, 1), an exact overdetermined fit, and the
rank-1 minimum-norm split.

## Replay

Walker: `conkay_solve` math.svd-lsq with the Longley design
(intercept column prepended), target `lsq` → PASS with the
coefficients above and effectiveRank 7; `{A: [[1,1],[1,1],[1,1]],
b: [2,2,2]}` target `lsq` → x = [1, 1] with
truncatedSingularValues 1 declared. Reachability via solve.direct
rides SC-00 (named foundation); the MCP/chain paths reach the
registry entry as registered.
