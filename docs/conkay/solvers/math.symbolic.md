# math.symbolic — computer algebra (SX-NUM-01)

Two tiers, per the catalogue row's own method. Code:
`server/lib/conkay/physics/solvers/math-symbolic.js`
(registry solver, L0).

## L0 fast path (this build, in JS)

Exact symbolic work with **rational coefficients** (BigInt
fractions — `0.1 + 0.2` simplifies to `3/10`, never
0.30000000000000004). Operations: `simplify`, `differentiate`,
`integrate`, `evaluate`.

Grammar: numbers (decimals exact), identifiers, `+ - * /` with
implicit multiplication (`2x`, `x(x+1)`), `^` with integer or
rational exponents, parentheses, unary minus, `sin cos tan exp log
sqrt`, constants `pi` and `e` (symbolic in closed forms, numeric
under `evaluate`).

Differentiation: sum/product/power/chain rules over the grammar.
Integration decides this class, and no more:

- constants and constant multiples of integrable factors;
- powers of the variable, including `x^-1 → log(x)`;
- `exp`/`sin`/`cos` of a linear argument `a·x`;
- `log(x)` (→ `x·log(x) − x`, by parts);
- sums of the above.

**Every antiderivative is verified by re-differentiating it and
comparing canonical forms before it is served.** A mismatch returns
FAIL with the round-trip evidence, never the wrong answer. Outside
the class → NOT_COMPUTED `not_integrable_in_js_scope:<form>`.

## Engine tier (refused by name, not approximated)

`solve`, `limit`, `series`, `dsolve`, `laplace`, `fourier`,
`matrices` are the SymPy class: NOT_COMPUTED
`requires_engine_tier:sympy`. When a SymPy engine seats under
SXE-00, those operations route through solver.select and return
`engine_unavailable:sympy` while it is absent — the same honesty
contract, one tier up. The catalogue reference case `dsolve y″+y=0`
belongs to that tier and is refused here by design.

## Reference + locator

NIST DLMF (closed forms); OpenStax *Calculus* Vol. 1–3. CI
reference cases: `∫ sin x dx = −cos x` (the row's own case),
`∫ x² dx = x³/3`, `∫ e^{2x} dx = e^{2x}/2`, `∫ dx/x = log x`,
`d/dx x³ = 3x²` — plus a behavioral cross-check of symbolic
derivatives against central finite differences, an independent
method.

## Replay

Walker: `conkay_solve` math.symbolic `{expression: "sin(x)"}`,
target `integrate` → PASS `−cos x` with
`verifiedByRedifferentiation: true`; target `dsolve` →
NOT_COMPUTED `requires_engine_tier:sympy`. Reachability via
solve.direct rides SC-00 (named foundation); the MCP/chain paths
reach the registry entry as registered.
