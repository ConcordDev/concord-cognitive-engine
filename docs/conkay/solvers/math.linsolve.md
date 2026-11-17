# math.linsolve — linear systems (SX-NUM-03)

Dense linear algebra at the JS tier; the engine class refused by
name. Code: `server/lib/conkay/physics/solvers/linsolve.js`
(registry solver, L3).

## Operations (JS tier)

- **solve** `{A, b, method?, acceptIllConditioned?}` — LU with
  partial pivoting (default) or Cholesky (`method: "cholesky"`,
  symmetric positive definite only; a non-SPD matrix is refused
  at its failing pivot, a non-symmetric one by name). The result
  carries x, the determinant, the 1-norm condition estimate, and
  the residual.
- **inverse** `{A}` — from the LU factors.
- **det** `{A}` — pivot product with the permutation sign.

**Verification by substitution:** every solve computes
`||Ax − b||∞` against the original system; a residual beyond
1e-8 · max(1, ||b||∞) FAILs the result with the evidence instead
of serving it.

**Condition envelope (the row's own validity rule):** cond₁ is
estimated from the LU factors on every call. Above **1e12** the
call is NOT_COMPUTED `condition_above_envelope` — unless the
caller declares `acceptIllConditioned: true`, in which case the
answer is served as WARN with the estimate and the declaration
named in the warning. Singular matrices are NOT_COMPUTED
`singular_matrix` with the failing pivot.

## Engine tier (refused by name)

`qr`, `sparse` (SuperLU), `iterative` (CG/GMRES/BiCGSTAB via
PETSc) → NOT_COMPUTED `requires_engine_tier:lapack-petsc`. Dense
systems above n = 128 name the same tier. When those engines seat
under SXE-00, solver.select routes upward; nothing here quietly
approximates them.

## Reference + locator

Golub & Van Loan, *Matrix Computations* 4e (LU Ch. 3, Cholesky
Ch. 4, conditioning Ch. 2); NIST Matrix Market for reference-case
practice. CI cases are manufactured from known solutions (x
chosen, b = Ax by hand), the permutation-sign determinant, an
inverse verified by independent multiplication in the test, and
the Hilbert-matrix conditioning pin (cond₁(H₁₀) ≈ 3.5e13, a
textbook constant) exercising both envelope branches.

## Replay

Walker: `conkay_solve` math.linsolve `{A: [[2,1],[1,3]],
b: [5,5]}`, target `solve` → PASS, x = [2, 1], residual ~0,
determinant 5; the same call on a 10×10 Hilbert system →
NOT_COMPUTED `condition_above_envelope`. Reachability via
solve.direct rides SC-00 (named foundation); the MCP/chain paths
reach the registry entry as registered.
