/**
 * SX-NUM-14 math.transforms tests.
 *
 * References: the DLMF transform tables. Laplace pairs:
 * 1 <-> 1/s, e^{-t} <-> 1/(s+1), sin t <-> 1/(s^2+1),
 * t <-> 1/s^2 — the catalogue's reference case is the inverse
 * pair 1/(s+1) -> e^{-t}. FFT pins are the delta and a single
 * bin cosine; every FFT result carries its own round-trip and
 * Parseval certificates.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/transforms.js";

const solver = getSolver("math.transforms");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L2 with the DLMF pairs in its reference", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 2);
  assert.ok(solver.reference.includes("DLMF"));
});

test("fft: a delta transforms flat; a bin-3 cosine lands on bins 3 and 61", () => {
  const delta = run({ signal: [1, 0, 0, 0, 0, 0, 0, 0] }, "fft");
  assert.equal(delta.status, "PASS", delta.reason || "");
  for (const bin of delta.outputs.spectrum) assert.ok(Math.abs(bin.re - 1) < 1e-12 && Math.abs(bin.im) < 1e-12);
  assert.ok(delta.outputs.roundTripError < 1e-12);
  assert.ok(delta.outputs.parsevalRelativeError < 1e-12);
  const sig = Array.from({ length: 64 }, (_, j) => Math.cos((2 * Math.PI * 3 * j) / 64));
  const r = run({ signal: sig }, "fft");
  assert.ok(Math.abs(r.outputs.spectrum[3].re - 32) < 1e-9, `bin3 ${r.outputs.spectrum[3].re}`);
  assert.ok(Math.abs(r.outputs.spectrum[61].re - 32) < 1e-9);
  assert.ok(Math.abs(r.outputs.spectrum[4].re) < 1e-9);
  assert.ok(r.outputs.roundTripError < 1e-11);
});

test("dct: a constant signal concentrates in the zeroth coefficient", () => {
  const r = run({ signal: [2, 2, 2, 2] }, "dct");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.coefficients[0] - 4) < 1e-12, `k0 ${r.outputs.coefficients[0]}`);
  for (let k = 1; k < 4; k += 1) assert.ok(Math.abs(r.outputs.coefficients[k]) < 1e-12);
});

test("laplace: the DLMF pairs 1 -> 1/s and e^{-t} -> 1/(s+1)", () => {
  const r1 = run({ f: "1", s: [2, 0.5] }, "laplace");
  assert.equal(r1.status, "PASS", r1.reason || "");
  assert.ok(Math.abs(r1.outputs.values[0].value - 0.5) < 1e-9);
  assert.ok(Math.abs(r1.outputs.values[1].value - 2) < 1e-8);
  const r2 = run({ f: "exp(-t)", s: [1, 3] }, "laplace");
  assert.ok(Math.abs(r2.outputs.values[0].value - 0.5) < 1e-9);
  assert.ok(Math.abs(r2.outputs.values[1].value - 0.25) < 1e-9);
  const refused = run({ f: "1", s: [0] }, "laplace");
  assert.equal(refused.status, "NOT_COMPUTED");
  assert.ok(refused.reason.startsWith("outside_envelope"), refused.reason);
});

test("inverse-laplace: the catalogue pair 1/(s+1) -> e^{-t}, plus 1/s -> 1 and 1/(s^2+1) -> sin t", () => {
  const r = run({ F: "1/(s+1)", t: [0.5, 1, 2] }, "inverse-laplace");
  assert.equal(r.status, "PASS", r.reason || "");
  for (const v of r.outputs.values) {
    assert.ok(Math.abs(v.value - Math.exp(-v.t)) < 1e-6, `t=${v.t}: ${v.value} vs ${Math.exp(-v.t)}`);
  }
  const one = run({ F: "1/s", t: [0.7] }, "inverse-laplace");
  assert.ok(Math.abs(one.outputs.values[0].value - 1) < 1e-6, `1/s -> ${one.outputs.values[0].value}`);
  const sin = run({ F: "1/(s^2+1)", t: [1] }, "inverse-laplace");
  assert.ok(Math.abs(sin.outputs.values[0].value - Math.sin(1)) < 1e-5, `sin -> ${sin.outputs.values[0].value}`);
});

test("hilbert: the envelope of a pure cosine is 1; dwt reconstructs exactly", () => {
  const sig = Array.from({ length: 64 }, (_, j) => Math.cos((2 * Math.PI * 4 * j) / 64));
  const h = run({ signal: sig }, "hilbert");
  assert.equal(h.status, "PASS", h.reason || "");
  for (const v of h.outputs.envelope) assert.ok(Math.abs(v - 1) < 1e-9, `envelope ${v}`);
  const d = run({ signal: [1, 3, 5, 7, 2, 4, 6, 8] }, "dwt");
  assert.equal(d.status, "PASS", d.reason || "");
  assert.ok(d.outputs.reconstructionError < 1e-12);
  assert.equal(d.outputs.details.length, 3);
});
