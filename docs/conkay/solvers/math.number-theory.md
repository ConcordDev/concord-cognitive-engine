# math.number-theory — number theory (SX-NUM-20)

Elementary number theory in BigInt throughout. Code:
`server/lib/conkay/physics/solvers/number-theory.js`
(registry solver, L1). Reference: OEIS — the catalogue's
reference case is φ(36) = 12 (A000010).

## Targets

`is-prime` · `factor` · `phi` · `gcd-lcm` · `modpow` ·
`modinv` · `crt` (coprime case) · `jacobi` · `discrete-log`
(baby-step giant-step).

## The honesty rules

- **Inputs are integers as safe numbers or decimal
  strings**, so values past 2^53 stay exact. Every operation
  declares its size envelope: primality to 200 digits,
  factorization and φ to 60 digits, discrete log to
  p ≤ 2^40 — refusals name the envelope.
- **A primality verdict names its own epistemic status.**
  The Miller–Rabin base set used is proven deterministic
  below 3.3×10^24, and there the verdict is `prime-proven`;
  above it the verdict is `prime-probable` **with the bases
  listed**. The suite pins the Carmichael numbers and 2047,
  the base-2 strong pseudoprime — verdicts that fool weaker
  tests.
- **Factorization never guesses.** Trial division + Pollard
  rho run under a declared budget; an exhausted budget
  refuses with the remaining composite cofactor named
  rather than serving partial factors as a factorization.
- A non-invertible modular inverse refuses with its gcd as
  the reason; a non-coprime CRT refuses naming the pair
  (the general CRT is named follow-on scope).

## Replay

Walker: `conkay_solve` math.number-theory `{n: 36}`,
target `phi` → PASS with phi "12"; `{n:
"618970019642690137449562111"}`, target `is-prime` → PASS
with verdict prime-probable and twelve bases listed.
Reachability via solve.direct rides SC-00 (named
foundation); the MCP/chain paths reach the registry entry
as registered.
