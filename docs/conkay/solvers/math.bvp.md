# math.bvp — boundary-value problems (SX-NUM-09)

Two-point boundary-value problems at the JS tier. Code:
`server/lib/conkay/physics/solvers/bvp.js` (registry solver,
L3).

## solve — collocation for systems

`{f, bcLeft, bcRight, a, b, mesh, tol, guess?}`: f is the
expression list for y' over `x, y0..`; the boundary conditions
are **residual expressions** over the state at each end (their
values must vanish), and bcLeft + bcRight must total exactly n
residuals for n state components — a wrong count is refused by
name. The discretization is the implicit midpoint rule on a
uniform mesh (order 2), solved by damped Newton over a
finite-difference Jacobian.

The answer carries a **mesh-doubling error estimate**: the
solve runs at mesh N and 2N, and the difference at shared nodes
is reported as `meshErrorEstimate`. If it exceeds the declared
tol (default 1e-6), the call is NOT_COMPUTED `not_converged`
with the estimate named — the coarse answer is never served as
a converged one. A singular collocation system (the resonant
case below) is refused as `singular_collocation`.

## blasius — the reference problem, by shooting

f''' + ½ f f'' = 0 with f(0) = f'(0) = 0 and f'(ηMax) = 1,
integrated by RK4 (4,000 steps) with the missing initial
curvature f''(0) found by secant iteration to |f'(ηMax) − 1| ≤
1e-11. ηMax is a declared input (default 10, range [4, 30]) —
the truncated boundary is part of the record, not a hidden
infinity. Output: f''(0) and the profile.

## Reference + locator

Ascher, Mattheij & Russell, *Numerical Solution of Boundary
Value Problems for Ordinary Differential Equations*. CI
reference cases: the Blasius constant f''(0) =
0.33205733621519630 (asserted to 2e-4); the linear oscillator
BVP with solution sin x; the nonlinear y'' = 2y³ problem with
exact solution 1/(1 + x); and the **resonant** problem
y'' = −y, y(0) = 0, y(π) = 1, which has no solution and is
refused (`singular_collocation` / `not_converged`), never
fitted.

## Named follow-on scope

Spectral (Chebyshev) collocation and adaptive mesh refinement
are follow-on scopes, unlisted rather than approximated.

## Replay

Walker: `conkay_solve` math.bvp `{f: ["y1", "-y0"], bcLeft:
["y0"], bcRight: ["y0 - 1"], a: 0, b: 1.5707963267948966, mesh:
64, tol: 1e-4}`, target `solve` → PASS with nodes reproducing
sin x and meshErrorEstimate within tol; `{}`, target `blasius`
→ PASS, f''(0) = 0.332057 within 2e-4. Reachability via
solve.direct rides SC-00 (named foundation); the MCP/chain
paths reach the registry entry as registered.
