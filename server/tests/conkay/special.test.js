/**
 * SX-NUM-15 math.special tests.
 *
 * References: NIST DLMF. The catalogue's reference case is
 * erf(1) = 0.8427007929. Further pins: Gamma(1/2) = sqrt(pi),
 * J0(1) = 0.7651976866, the first J0 zero, K(1/2) and E(1/2),
 * W(1) the omega constant, 2F1(1,1;2;1/2) = 2 ln 2, Ai(0) and
 * Bi(0). Poles and out-of-domain points are refused by name.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/special.js";

const solver = getSolver("math.special");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L1 (screening tier) with the DLMF reference", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 1);
  assert.ok(solver.reference.includes("DLMF"));
});

test("reference case: erf(1) = 0.8427007929 (DLMF), erfc(1) its complement", () => {
  const r = run({ points: [1, 0, -1, 3] }, "erf");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.values[0].erf - 0.8427007929497149) < 1e-11, `erf(1) ${r.outputs.values[0].erf}`);
  assert.ok(Math.abs(r.outputs.values[0].erfc - 0.15729920705028513) < 1e-11);
  assert.equal(r.outputs.values[1].erf, 0);
  assert.ok(Math.abs(r.outputs.values[2].erf + 0.8427007929497149) < 1e-11);
  assert.ok(Math.abs(r.outputs.values[3].erf - 0.9999779095030014) < 1e-10, `erf(3) ${r.outputs.values[3].erf}`);
});

test("gamma: Gamma(1/2) = sqrt(pi), Gamma(5) = 24, poles refused", () => {
  const r = run({ points: [0.5, 5, 1] }, "gamma");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.values[0].y - Math.sqrt(Math.PI)) < 1e-12);
  assert.ok(Math.abs(r.outputs.values[1].y - 24) < 1e-10);
  const lg = run({ points: [10] }, "log-gamma");
  assert.ok(Math.abs(lg.outputs.values[0].y - 12.801827480081469) < 1e-11);
  const pole = run({ points: [0] }, "gamma");
  assert.equal(pole.status, "NOT_COMPUTED");
  assert.ok(pole.reason.startsWith("pole"), pole.reason);
  const pole2 = run({ points: [-2] }, "gamma");
  assert.ok(pole2.reason.startsWith("pole"), pole2.reason);
});

test("bessel: J0(1), J1(1), the first J0 zero, I0(1)", () => {
  const j0 = run({ order: 0, points: [1] }, "bessel-j");
  assert.ok(Math.abs(j0.outputs.values[0].y - 0.7651976865579666) < 1e-12, `J0(1) ${j0.outputs.values[0].y}`);
  const j1 = run({ order: 1, points: [1] }, "bessel-j");
  assert.ok(Math.abs(j1.outputs.values[0].y - 0.4400505857449335) < 1e-12);
  const zero = run({ order: 0, points: [2.404825557695773] }, "bessel-j");
  assert.ok(Math.abs(zero.outputs.values[0].y) < 1e-9, `J0 at its zero: ${zero.outputs.values[0].y}`);
  const i0 = run({ order: 0, points: [1] }, "bessel-i");
  assert.ok(Math.abs(i0.outputs.values[0].y - 1.2660658777520084) < 1e-12);
});

test("elliptic: K(1/2) and E(1/2) by the AGM, K(0) = pi/2, E(1) = 1", () => {
  const k = run({ points: [0.5, 0] }, "elliptic-k");
  assert.equal(k.status, "PASS", k.reason || "");
  assert.ok(Math.abs(k.outputs.values[0].y - 1.8540746773013719) < 1e-12, `K ${k.outputs.values[0].y}`);
  assert.ok(Math.abs(k.outputs.values[1].y - Math.PI / 2) < 1e-14);
  const e = run({ points: [0.5, 1] }, "elliptic-e");
  assert.ok(Math.abs(e.outputs.values[0].y - 1.3506438810476755) < 1e-12, `E ${e.outputs.values[0].y}`);
  assert.equal(e.outputs.values[1].y, 1);
});

test("lambertw: W(1) is the omega constant, W(e) = 1, the -1 branch, the -1/e wall", () => {
  const r = run({ points: [1, Math.E, 0] }, "lambertw");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.values[0].y - 0.5671432904097839) < 1e-12);
  assert.ok(Math.abs(r.outputs.values[1].y - 1) < 1e-12);
  const m = run({ points: [-0.2], branch: -1 }, "lambertw");
  const w = m.outputs.values[0].y;
  assert.ok(Math.abs(w * Math.exp(w) + 0.2) < 1e-12 && w < -1, `W-1(-0.2) ${w}`);
  const wall = run({ points: [-0.5] }, "lambertw");
  assert.equal(wall.status, "NOT_COMPUTED");
  assert.ok(wall.reason.startsWith("outside_envelope"), wall.reason);
});

test("hypergeometric and airy: 2F1(1,1;2;1/2) = 2 ln 2, Ai(0) and Bi(0)", () => {
  const h = run({ a: 1, b: 1, c: 2, z: 0.5 }, "hypergeometric");
  assert.equal(h.status, "PASS", h.reason || "");
  assert.ok(Math.abs(h.outputs.value - 2 * Math.LN2) < 1e-12, `2F1 ${h.outputs.value}`);
  const boundary = run({ a: 1, b: 1, c: 2, z: 1 }, "hypergeometric");
  assert.equal(boundary.status, "NOT_COMPUTED");
  const airy = run({ points: [0, 1] }, "airy");
  assert.ok(Math.abs(airy.outputs.values[0].Ai - 0.35502805388781724) < 1e-12);
  assert.ok(Math.abs(airy.outputs.values[0].Bi - 0.6149266274460007) < 1e-12);
  assert.ok(Math.abs(airy.outputs.values[1].Ai - 0.13529241631288142) < 1e-10, `Ai(1) ${airy.outputs.values[1].Ai}`);
});
