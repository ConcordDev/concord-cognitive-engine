# math.arbitrary-precision — high-precision recompute (SX-NUM-19)

The checker agent's recompute tool: a closed form is
re-evaluated in BigInt decimal arithmetic at a **declared
precision**, so another solver's double-precision answer can
be verified digit by digit. Code:
`server/lib/conkay/physics/solvers/arbitrary-precision.js`
(registry solver, L2).

## Contract

- Input: an expression over the symbolic grammar, variables
  supplied as decimal strings, and `digits` (10–200) — the
  declared precision is part of the contract and is echoed
  with the result, along with the guard digits used (12) and
  the rounding mode (half-even).
- Output: the value as a **digit string** at exactly the
  declared significant digits. A binary float would discard
  precisely what this solver exists to keep.
- All internal operations run at declared + 12 guard digits
  and round once, at the end.

## Seated operations

+ − × ÷, integer and half exponents, sqrt, exp, log, sin,
cos, and the constants π (Machin formula) and e. General
rational powers and other functions refuse by name as
follow-on scope.

## Reference case

π to 50 significant digits:
3.1415926535897932384626433832795028841971693993751 — the
universal published constant, asserted as a string in CI,
alongside sqrt(2), e, ln 10, and sin(1) at 40 digits, and
the cancellation case 10^20 + 1 − 10^20, which binary
doubles answer 0 and this solver answers exactly 1.

## Replay

Walker: `conkay_solve` math.arbitrary-precision
`{expression: "pi", digits: 50}`, target `eval` → PASS with
the 50-digit expansion above; `{expression: "10^20 + 1 -
10^20", digits: 30}` → the digit string for exactly 1.
Reachability via solve.direct rides SC-00 (named
foundation); the MCP/chain paths reach the registry entry
as registered.
