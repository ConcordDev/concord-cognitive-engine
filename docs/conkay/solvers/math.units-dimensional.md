# math.units-dimensional — dimensional analysis, Buckingham π (SX-NUM-02)

Dimension algebra over the SI base dimensions, at the JS tier
(CB-0820). Code:
`server/lib/conkay/physics/solvers/units-dimensional.js`
(registry solver, L0). Units per NIST SP 811.

## Operations

- **dimension** `{unit}` — a unit or unit expression
  (`kg*m/s^2`, `J/(kg*K)`, `1/s`) reduced to its dimension vector
  over [M, L, T, I, Θ, N, J], with the named SI derived unit when
  the vector matches one (N, Pa, J, W, V, …) and the SI factor.
- **convert** `{value, from, to}` — exact conversions. Factors are
  the SI/SP 811 definitions (inch = 0.0254 m, ft = 0.3048 m,
  atm = 101325 Pa, lbf = 4.4482216152605 N, eV = 1.602176634e-19 J,
  kWh = 3.6 MJ). A dimension mismatch is NOT_COMPUTED
  `dimension_mismatch` naming both dimensions; unknown units are
  refused by name. This is the SC-04 discipline as a solver:
  non-SI inputs are echoed and converted exactly.
- **check** `{terms: [...]}` — dimensional homogeneity of a sum.
  Homogeneous → PASS. A mismatched term is a computed **FAIL**
  verdict naming the offending term and both dimensions — a check
  that fails is an answer, not a refusal.
- **pi-groups** `{variables: [{name, unit}]}` — Buckingham π. The
  dimension matrix's null space is computed by exact rational
  RREF; the result carries rank, groupCount (= variables − rank,
  by construction), and each group as an exponent vector with an
  expression string. The basis is the RREF-canonical one; any
  textbook group (Reynolds, drag coefficient) lies in its span.

## Envelope

Multiplicative unit systems only. Affine temperature scales are
excluded by name: °C/°F offsets are not units in this algebra —
temperature is kelvin (props.material handles affine temperature
inputs for its own tables). Unit exponents are integers.

## Reference + locator

NIST SP 811, *Guide for the Use of the International System of
Units*; Buckingham, "On Physically Similar Systems", Phys. Rev.
1914. CI reference cases: 1 atm = 101325 Pa and 1 ft = 0.3048 m
(exact definitions); the pendulum's single π group proportional
to T²g/l; the drag problem's two groups, verified by showing the
Reynolds vector [0,1,1,1,−1] and the drag-coefficient vector
[1,−1,−2,−2,0] lie in the returned span, with every returned
group independently recomputed as dimensionless.

## Replay

Walker: `conkay_solve` math.units-dimensional
`{variables: [{name: "T", unit: "s"}, {name: "m", unit: "kg"},
{name: "l", unit: "m"}, {name: "g", unit: "m/s^2"}]}`, target
`pi-groups` → one group ∝ T²g/l; `{value: 1, from: "atm",
to: "Pa"}` target `convert` → 101325. Reachability via
solve.direct rides SC-00 (named foundation); the MCP/chain paths
reach the registry entry as registered.
