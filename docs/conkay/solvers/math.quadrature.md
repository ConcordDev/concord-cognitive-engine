# math.quadrature — integration (SX-NUM-07)

Definite integration over a finite interval. The integrand
arrives as **data** — an expression in the math.symbolic
grammar — and the catalogue's validity envelope is enforced as
written: **an answer ships only when its own error estimate
meets the declared tolerance** (`tol` input, default 1e-10,
always echoed). Otherwise NOT_COMPUTED
`error_estimate_above_tolerance` with the estimate named.
Code: `server/lib/conkay/physics/solvers/quadrature.js`
(registry solver, L3).

## Operations

- **integrate** — tanh-sinh (double-exponential) quadrature
  (Mori–Sugihara): successive trapezoid refinements in the
  transformed variable until the level-to-level difference meets
  tol. Decides endpoint algebraic singularities — the reference
  case below is one — because transformed nodes never land on
  the endpoints and weights decay double-exponentially.
- **simpson** — adaptive Simpson with Richardson error control;
  the reported estimate is the accumulated sum of accepted leaf
  estimates, and the same envelope applies to it. An integrand
  that is not finite at a node it must evaluate (e.g. x^-1/2 at
  0) is NOT_COMPUTED `integrand_not_finite` — which is exactly
  why the singular case belongs to `integrate`.

## Named scopes (not silent transforms)

Infinite intervals (declare a finite truncation or substitution
yourself), multidimensional cubature / QMC (Sobol), and
QUADPACK-style Gauss–Kronrod / Clenshaw–Curtis panels are
follow-on scopes, refused or unlisted rather than approximated
quietly.

## Reference + locator

NIST DLMF integral identities. CI reference cases, all closed
forms: the catalogue's ∫₀¹ x^-1/2 dx = 2 (endpoint singularity,
tanh-sinh, tol 1e-9); ∫₀^π sin x dx = 2; ∫₀¹ e^x dx = e − 1;
∫₀¹ √x dx = 2/3; the Runge integrand ∫₋₁¹ dx/(1+25x²) =
(2/5)·atan(5); reversed limits negate. The envelope refusal is
pinned too: adaptive Simpson on √x at tol 1e-12 exhausts its
depth cap near the singular derivative and refuses with its
estimate (1.45e-12) named.

## Replay

Walker: `conkay_solve` math.quadrature `{expression:
"x^(-1/2)", a: 0, b: 1, tol: 1e-9}`, target `integrate` →
PASS, value 2 within 1e-7 and errorEstimate within tol; the
same input at target `simpson` → NOT_COMPUTED
`integrand_not_finite`. Reachability via solve.direct rides
SC-00 (named foundation); the MCP/chain paths reach the
registry entry as registered.
