# uq.propagate — uncertainty propagation (SX-XC-06)

Propagation of input uncertainty through a model, at the
JS tier under the CB-0820 engine-only interim ruling
(XC-06 is one of the five engine-flag rows). Three methods
over a built-in model library: **moments** (exact analytic
propagation), **monte-carlo** and **lhs** (Latin hypercube)
— both seeded and deterministic, and both shipping the
analytic mean/variance beside the sampled estimates they
must converge to. The general tier — a wrapper around
arbitrary solvers, polynomial chaos, sampled Sobol
indices — is SXE-22's (stats-uq engine stack) and refuses
by name as `requires_engine_tier:sxe-22`.
Code: `server/lib/conkay/physics/solvers/uq-propagate.js`
(registry solver, L3).

## Models and inputs

- **linear** — y = intercept + Σ aᵢxᵢ (coefficients per
  variable). Exact: mean = c + Σ aᵢμᵢ, Var = Σ aᵢ²σᵢ²,
  Sobol Sᵢ = aᵢ²σᵢ² / Var.
- **product** — y = Π xᵢ. Exact for independent inputs:
  mean = Π μᵢ, Var = Π(σᵢ² + μᵢ²) − mean², first-order
  Sobol analytic (the interaction remainder stays
  visible: first-order indices sum to less than 1).

Variables (≤ 16, independent) carry a distribution:
`normal` {mean, std}, `uniform` {min, max}, `lognormal`
{mu, sigma} — moments analytic for each. Sampling is
seeded (mulberry32; Box–Muller normals; LHS by stratified
quantiles with a seeded permutation, Acklam's inverse
normal CDF): the same inputs + seed reproduce the same
estimates bit-for-bit, which is what makes a stochastic
method CI-signable. Sample counts 100..200000.

Outputs: mean, variance, std, 95% CI (normal-approx on
exact moments for `moments`; sample percentiles for the
samplers), the standard error of the mean (samplers),
first-order Sobol indices (analytic, labelled as such).

## Reference + locator

NIST/SEMATECH *e-Handbook of Statistical Methods* — the
propagation-of-error formulas for sums and products of
independent variables. CI reference case, from the
catalogue: y = 2x1 + 3x2 + 1 with x1 ~ N(10, 2²),
x2 ~ U(0, 6) → analytic mean 30, variance 43
(= 4·4 + 9·3), Sobol {16/43, 27/43}; the seeded Monte
Carlo (N = 20000, seed 12345) is pinned within 5 standard
errors of the analytic mean.

## Replay

Walker: `conkay_solve` uq.propagate `{model: "linear",
coefficients: [2, 3], intercept: 1, variables: [{name:
"x1", dist: "normal", mean: 10, std: 2}, {name: "x2",
dist: "uniform", min: 0, max: 6}], method: "moments"}`,
target `propagate` → PASS, mean 30, variance 43; target
`engine` → NOT_COMPUTED `requires_engine_tier:sxe-22`.
Reachability via solve.direct rides SC-00 (named
foundation); the MCP/chain paths reach the registry entry
as registered.
