# math.series-asymptotic — series, perturbation, asymptotics (SX-NUM-16)

Series and asymptotics at the JS fast-path tier. Code:
`server/lib/conkay/physics/solvers/series-asymptotic.js`
(registry solver, L0). The row's envelope rule: **the radius
of convergence is declared with every series result**, and
an asymptotic result never claims more accuracy than its
least term.

## Targets

- **taylor** — coefficients by exact symbolic differentiation
  (math.symbolic), evaluated at the centre. The result
  declares a radius estimate (root test over the last
  coefficients, labelled an estimate) and marks each
  evaluation point inside/outside it with the last-term
  scale beside the value.
- **pade** — [m/n] Padé approximants from the Taylor
  coefficients via the Toeplitz system. The catalogue
  reference case is the Padé approximant of e^x: the [1/1]
  coefficients are the exact (1 + x/2)/(1 − x/2), and the
  [5/5] tracks e^x to 1e-7 at x = 0.5.
- **asymptotic** — named divergent expansions summed to
  optimal truncation. Seated: Stirling for log Γ (Bernoulli
  coefficients, DLMF 5.11). The result ships termsUsed and
  the least term as its error scale; when that floor exceeds
  the declared tolerance the call refuses with
  `asymptotic_floor`, naming the floor — the expansion
  cannot certify the point and says so. (At x = 10 the floor
  is below 1e-10 and the value matches the independent
  Lanczos implementation to 1e-9; at x = 2 the floor is
  ~1e-6 and a 1e-9 request refuses.)
- **accelerate** — Aitken Δ² and the Wynn epsilon algorithm
  on a caller's partial-sum sequence, reported **beside**
  the unaccelerated last term, never instead of it.

## Scope named honestly

Laurent series are follow-on scope. Perturbation problems
are served by composition — the DAE/BVP solvers with the
small parameter swept — rather than by a dedicated target
here.

## Replay

Walker: `conkay_solve` math.series-asymptotic `{f: "exp(x)",
m: 1, n: 1}`, target `pade` → PASS with numerator [1, 0.5]
and denominator [1, −0.5]; `{name: "log-gamma", points: [2],
tol: 1e-9}`, target `asymptotic` → NOT_COMPUTED
`asymptotic_floor`. Reachability via solve.direct rides
SC-00 (named foundation); the MCP/chain paths reach the
registry entry as registered.
