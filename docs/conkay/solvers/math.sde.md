# math.sde — stochastic differential equations (SX-NUM-17)

Scalar Itô SDEs dX = a(t, X) dt + b(t, X) dW at the JS tier.
Code: `server/lib/conkay/physics/solvers/sde.js` (registry
solver, L3). Reference: Kloeden & Platen.

## Targets

- **simulate** — Euler–Maruyama (strong order ½) or Milstein
  (strong order 1; the diffusion derivative is taken by exact
  symbolic differentiation, never finite differences).
  Ensemble statistics at t1: mean, variance, **standard error
  of the mean**, and quantiles. A Monte Carlo mean without
  its standard error is a number pretending to be exact, so
  the error ships with the estimate.
- **strong-order** — the order is *measured*, not asserted:
  on the GBM family (whose exact solution is known), the
  exact path is driven by the same Brownian increments as
  the approximation (common random numbers) at two step
  sizes, and the RMS-error ratio gives the measured order.

## Reproducibility

The generator (splitmix + Box–Muller) is seeded; the seed is
a declared input echoed with every result, and a defaulted
seed is labelled as defaulted (SC-03). The same seed
reproduces an ensemble bitwise — the suite pins this, which
is what makes the statistical reference cases (the GBM mean
S₀e^{μt} and variance from the exact law, the OU
mean-reversion law) deterministic tests rather than flakes.

## Scope named honestly

Stochastic Runge–Kutta families are follow-on scope, named
in the refusal. Work is capped at 4e6 path-steps per call.

## Replay

Walker: `conkay_solve` math.sde `{drift: "0.1*x", diffusion:
"0.3*x", x0: 100, t1: 1, steps: 100, paths: 20000, seed:
777}`, target `simulate` → PASS with the mean within four
standard errors of 100·e^{0.1} and the seed echoed;
`{mu: 0.1, sigma: 0.3, x0: 100, t1: 1}`, target
`strong-order` → PASS with measuredOrder in (0.3, 0.75).
Reachability via solve.direct rides SC-00 (named
foundation); the MCP/chain paths reach the registry entry
as registered.
