# math.special — special functions (SX-NUM-15)

Special functions at the JS tier, against the NIST DLMF.
Code: `server/lib/conkay/physics/solvers/special.js`
(registry solver, L1 screening tier). Every function carries
the DLMF domain as its envelope: poles and out-of-domain
arguments are refused by name, never approximated around.

## Targets

- **gamma / log-gamma** — Lanczos (g = 7) with reflection.
  Poles at the non-positive integers are refused: a pole is
  not a number.
- **erf** — power series for |x| ≤ 2.5, the DLMF continued
  fraction (modified Lentz) for erfc beyond. The catalogue
  reference case is erf(1) = 0.8427007929 (CI measures to
  1e-11).
- **bessel-j / bessel-i** — integer orders 0..30 by their
  power series, certified to |x| ≤ 30. Bessel Y and K name
  the GSL engine tier.
- **beta** — via log-gamma, on its positive domain.
- **elliptic-k / elliptic-e** — complete integrals (parameter
  m) by the arithmetic-geometric mean; m > 1 refused, m = 1
  returns K = ∞ and E = 1 as the DLMF limits.
- **lambertw** — both real branches by Halley iteration;
  x < −1/e refused (no real branch exists there).
- **hypergeometric** — 2F1 by its series inside |z| < 1;
  the disc boundary names the transformation-formula
  follow-on rather than extrapolating the series.
- **airy** — Ai and Bi by their power series, certified to
  |x| ≤ 10; beyond names the GSL tier.

## Reference + locator

NIST DLMF. CI pins: erf(1) and erf(3); Γ(1/2) = √π, Γ(5) =
24, log Γ(10); J0(1), J1(1), the first J0 zero, I0(1);
K(1/2) = 1.8540746773, E(1/2) = 1.3506438810; W(1) =
0.5671432904 (the omega constant), W(e) = 1, the −1 branch
by its defining equation; 2F1(1,1;2;½) = 2 ln 2; Ai(0),
Bi(0), Ai(1).

## Replay

Walker: `conkay_solve` math.special `{points: [1]}`, target
`erf` → PASS with erf = 0.8427007929497149; `{points: [0]}`,
target `gamma` → NOT_COMPUTED `pole`. Reachability via
solve.direct rides SC-00 (named foundation); the MCP/chain
paths reach the registry entry as registered.
