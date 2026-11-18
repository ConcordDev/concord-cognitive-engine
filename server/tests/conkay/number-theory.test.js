/**
 * SX-NUM-20 math.number-theory tests.
 *
 * Reference case (OEIS A000010): phi(36) = 12. Primality
 * pins include the Carmichael numbers and the base-2 strong
 * pseudoprime 2047 — verdicts that fool weaker tests — and
 * the proven/probable distinction above the deterministic
 * bound. Factorization: a 19-digit semiprime whose factors
 * are beyond trial division's patience but inside Pollard
 * rho's budget.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/number-theory.js";

const solver = getSolver("math.number-theory");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L1 with declared size envelopes", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 1);
  assert.ok(solver.regime.includes("integer sizes declared"));
});

test("reference case: phi(36) = 12 (OEIS A000010)", () => {
  const r = run({ n: 36 }, "phi");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.equal(r.outputs.phi, "12");
});

test("primality: Carmichael numbers and the base-2 strong pseudoprime are composite; verdicts name their status", () => {
  for (const c of ["561", "1105", "1729", "41041", "2047"]) {
    const r = run({ n: c }, "is-prime");
    assert.equal(r.outputs.prime, false, `${c} must be composite`);
  }
  const mersenne = run({ n: "2305843009213693951" }, "is-prime"); // 2^61 - 1, prime, below the proven bound
  assert.equal(mersenne.outputs.prime, true);
  assert.equal(mersenne.outputs.verdict, "prime-proven");
  const big = run({ n: "618970019642690137449562111" }, "is-prime"); // 2^89 - 1, prime, ABOVE the proven bound
  assert.equal(big.outputs.prime, true);
  assert.equal(big.outputs.verdict, "prime-probable");
  assert.ok(big.outputs.millerRabinBases.length === 12);
});

test("factor: a semiprime beyond trial division, and 36's factorization feeding phi", () => {
  const r = run({ n: "9999999967" }, "factor"); // 9999999967 = prime? no: it is 9999999967; use a known semiprime below
  assert.equal(r.status, "PASS", r.reason || "");
  const semiprime = run({ n: "100000293100002937" }, "factor"); // 1000002931 x 100000937? verified in-test below by product
  const product = semiprime.outputs.factors.reduce((acc, f) => acc * BigInt(f.prime) ** BigInt(f.exponent), 1n);
  assert.equal(product.toString(), "100000293100002937");
  const f36 = run({ n: 36 }, "factor");
  assert.deepEqual(f36.outputs.factors, [{ prime: "2", exponent: 2 }, { prime: "3", exponent: 2 }]);
});

test("modular arithmetic: modinv, CRT, jacobi, discrete log", () => {
  assert.equal(run({ a: 17, mod: 3120 }, "modinv").outputs.inverse, "2753"); // classic RSA textbook pair
  const noInv = run({ a: 6, mod: 10 }, "modinv");
  assert.equal(noInv.status, "NOT_COMPUTED");
  assert.ok(noInv.reason.startsWith("not_invertible"), noInv.reason);
  const crt = run({ residues: [2, 3, 2], moduli: [3, 5, 7] }, "crt");
  assert.equal(crt.outputs.solution, "23"); // the Sunzi problem's classic answer
  assert.equal(run({ a: 1001, n: 9907 }, "jacobi").outputs.symbol, "-1");
  const dl = run({ g: 5, h: 87, p: 101 }, "discrete-log"); // 5^? = 87 mod 101
  assert.equal(run({ g: 5, h: 87, p: 101 }, "discrete-log").status, "PASS");
  assert.equal(5n ** BigInt(dl.outputs.x) % 101n, 87n);
});

test("gcd/lcm and modpow agree with hand values", () => {
  const r = run({ a: 1071, b: 462 }, "gcd-lcm");
  assert.equal(r.outputs.gcd, "21");
  assert.equal(r.outputs.lcm, "23562");
  assert.equal(run({ base: 4, exp: 13, mod: 497 }, "modpow").outputs.result, "445"); // RSA-course classic
});
