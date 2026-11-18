/**
 * SX-NUM-18 math.dde tests.
 *
 * Reference case (Bellen & Zennaro, the catalogue's named
 * case): y' = -y(t-1), y = 1 on [-1, 0]. Known solution:
 * y = 1 - t on [0, 1]; y = t^2/2 - 2t + 3/2 on [1, 2], so
 * y(1) = 0, y(1.5) = -0.375, y(2) = -0.5. Also: zero delay
 * dependence degenerates to the ODE; a Mackey-Glass-shaped
 * system runs as two components; missing history refuses.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/dde.js";

const solver = getSolver("math.dde");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L2 with the Bellen & Zennaro reference", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 2);
  assert.ok(solver.reference.includes("Bellen"));
});

test("reference case: y' = -y(t-1) reproduces the known piecewise solution on [0, 2]", () => {
  const r = run({ f: "-d0", tau: 1, history: "1", t1: 2, points: [0.5, 1, 1.5, 2] }, "solve");
  assert.equal(r.status, "PASS", r.reason || "");
  const [a, b, c, d] = r.outputs.values.map((v) => v.y[0]);
  assert.ok(Math.abs(a - 0.5) < 1e-6, `y(0.5) ${a}`);
  assert.ok(Math.abs(b - 0) < 1e-6, `y(1) ${b}`);
  assert.ok(Math.abs(c - -0.375) < 1e-5, `y(1.5) ${c}`);
  assert.ok(Math.abs(d - -0.5) < 1e-5, `y(2) ${d}`);
  assert.ok(r.outputs.stepDoublingEstimate < 1e-5, `estimate ${r.outputs.stepDoublingEstimate}`);
});

test("no delay dependence degenerates to the ODE y' = -y", () => {
  const r = run({ f: "-x0", tau: 1, history: "1", t1: 1, points: [1] }, "solve");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.values[0].y[0] - Math.exp(-1)) < 1e-6, `y(1) ${r.outputs.values[0].y[0]}`);
});

test("a two-component system with cross-delay runs and stays finite", () => {
  const r = run({
    f: ["-d1", "-d0"],
    tau: 0.5,
    history: ["1", "0"],
    t1: 1,
    points: [1],
  }, "solve");
  assert.equal(r.status, "PASS", r.reason || "");
  const [y0, y1] = r.outputs.values[0].y;
  assert.ok(Number.isFinite(y0) && Number.isFinite(y1));
  // on [0, 0.5]: y0' = -y1(t-.5) = 0 (y0 stays 1), y1' = -y0(t-.5) = -1 -> y1 = -t
  // on [0.5, 1]: y0' = -y1(t-.5) = (t-.5) -> y0(1) = 1 + 0.125; y1' = -1 -> y1(1) = -1
  assert.ok(Math.abs(y0 - 1.125) < 1e-9, `y0(1) ${y0}`);
  assert.ok(Math.abs(y1 - -1) < 1e-9, `y1(1) ${y1}`);
});

test("missing history refuses by name (SC-03); a loose grid against a tight tolerance refuses with its estimate", () => {
  const noHist = run({ f: "-d0", tau: 1, t1: 1, points: [1] }, "solve");
  assert.equal(noHist.status, "NOT_COMPUTED");
  assert.ok(noHist.reason.startsWith("missing_input:history"), noHist.reason);
  // (the reference problem itself is integrated exactly at any
  // grid — its pieces are polynomials — so the refusal pin uses
  // a transcendental history, where a coarse grid has a real
  // step-doubling estimate)
  const loose = run({ f: "-d0", tau: 1, history: "exp(t)", t1: 2, points: [2], stepsPerDelay: 4, tol: 1e-12 }, "solve");
  assert.equal(loose.status, "NOT_COMPUTED");
  assert.ok(loose.reason.startsWith("step_doubling_estimate"), loose.reason);
});
