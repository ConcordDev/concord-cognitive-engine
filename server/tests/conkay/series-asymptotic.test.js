/**
 * SX-NUM-16 math.series-asymptotic tests.
 *
 * Reference case (catalogue): the Pade approximant of e^x —
 * the [1/1] coefficients are the exact rationals (1 + x/2) /
 * (1 - x/2), and the [5/5] at 0.5 tracks e^0.5 to 1e-7.
 * Stirling pins against the Lanczos log Gamma value from
 * SX-NUM-15 (an independent implementation). Acceleration
 * pins: Aitken on the Leibniz series beats the raw sum by an
 * order of magnitude, reported beside it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/series-asymptotic.js";

const solver = getSolver("math.series-asymptotic");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L0 with the radius-declared regime", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 0);
  assert.ok(solver.regime.includes("radius of convergence declared"));
});

test("taylor: exp coefficients are the reciprocal factorials, radius declared", () => {
  const r = run({ f: "exp(x)", order: 6, points: [0.5] }, "taylor");
  assert.equal(r.status, "PASS", r.reason || "");
  const expected = [1, 1, 1 / 2, 1 / 6, 1 / 24, 1 / 120, 1 / 720];
  r.outputs.coefficients.forEach((cv, i) => assert.ok(Math.abs(cv - expected[i]) < 1e-15, `c${i} ${cv}`));
  assert.ok(r.outputs.values[0].insideDeclaredRadius);
  assert.ok(Math.abs(r.outputs.values[0].y - Math.exp(0.5)) < 1e-4);
});

test("reference case: Pade of e^x — [1/1] coefficients exact, [5/5] tracks e^0.5", () => {
  const r11 = run({ f: "exp(x)", m: 1, n: 1 }, "pade");
  assert.equal(r11.status, "PASS", r11.reason || "");
  assert.deepEqual(r11.outputs.numerator, [1, 0.5]);
  assert.deepEqual(r11.outputs.denominator, [1, -0.5]);
  const r55 = run({ f: "exp(x)", m: 5, n: 5, points: [0.5, 1] }, "pade");
  assert.ok(Math.abs(r55.outputs.values[0].y - Math.exp(0.5)) < 1e-7, `[5/5] at 0.5: ${r55.outputs.values[0].y}`);
  assert.ok(Math.abs(r55.outputs.values[1].y - Math.E) < 2e-5, `[5/5] at 1: ${r55.outputs.values[1].y}`);
});

test("asymptotic: Stirling at x = 10 matches the Lanczos value; the floor refuses at x = 2 under a tight tolerance", () => {
  const r = run({ name: "log-gamma", points: [10] }, "asymptotic");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.values[0].y - 12.801827480081469) < 1e-9, `stirling(10) ${r.outputs.values[0].y}`);
  assert.ok(r.outputs.values[0].errorScale < 1e-10, `floor ${r.outputs.values[0].errorScale}`);
  const refused = run({ name: "log-gamma", points: [2], tol: 1e-9 }, "asymptotic");
  assert.equal(refused.status, "NOT_COMPUTED");
  assert.ok(refused.reason.startsWith("asymptotic_floor"), refused.reason);
});

test("accelerate: Aitken on the Leibniz series beats the raw partial sum, reported beside it", () => {
  // partial sums of 4 * SUM (-1)^k / (2k + 1) -> pi
  const seq = [];
  let s = 0;
  for (let k = 0; k < 12; k += 1) {
    s += (4 * (k % 2 === 0 ? 1 : -1)) / (2 * k + 1);
    seq.push(s);
  }
  const r = run({ sequence: seq }, "accelerate");
  assert.equal(r.status, "PASS", r.reason || "");
  const rawErr = Math.abs(r.outputs.rawLastTerm - Math.PI);
  const accErr = Math.abs(r.outputs.aitken - Math.PI);
  assert.ok(accErr < rawErr / 5, `aitken err ${accErr} vs raw ${rawErr}`);
  assert.ok(Math.abs(r.outputs.wynnEpsilon - Math.PI) < 0.01, `wynn ${r.outputs.wynnEpsilon}`);
});
