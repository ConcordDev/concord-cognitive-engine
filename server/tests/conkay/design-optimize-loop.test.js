/**
 * SX-XC-10 design.optimize-loop tests.
 *
 * Reference cases (catalogue): Rosenbrock via the loop —
 * minimum 0 at (1, 1) from the classic start (-1.2, 1);
 * the car mass-range Pareto front under the declared
 * constants, recomputed independently in this test.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/design-optimize-loop.js";

const solver = getSolver("design.optimize-loop");
const run = (inputs, target = "optimize") =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered with the Rosenbrock and car Pareto references", () => {
  assert.ok(solver);
  assert.ok(solver.reference.includes("Rosenbrock"));
});

test("reference case: Nelder-Mead finds the Rosenbrock minimum (1, 1) from (-1.2, 1)", () => {
  const r = run({ model: "rosenbrock", start: [-1.2, 1], method: "nelder-mead", tolerance: 1e-12 });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.equal(r.outputs.converged, true);
  assert.ok(Math.abs(r.outputs.x[0] - 1) < 1e-3 && Math.abs(r.outputs.x[1] - 1) < 1e-3, `x ${r.outputs.x}`);
  assert.ok(r.outputs.objective < 1e-6, `f ${r.outputs.objective}`);
});

test("gradient method reaches a quadratic's minimizer known by construction", () => {
  // A = [[4, 1], [1, 3]], choose x* = (2, -1), set b = A x* = (7, -1)
  const r = run({ model: "quadratic", matrix: [[4, 1], [1, 3]], vector: [7, -1], start: [0, 0], method: "gradient", tolerance: 1e-9 });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.x[0] - 2) < 1e-4 && Math.abs(r.outputs.x[1] - -1) < 1e-4, `x ${r.outputs.x}`);
});

test("budget exhaustion is reported, never dressed as convergence", () => {
  const r = run({ model: "rosenbrock", start: [-1.2, 1], method: "nelder-mead", maxEvaluations: 60 });
  assert.equal(r.outputs.converged, false);
  assert.ok((r.warnings || []).join(" ").includes("budget exhausted"), JSON.stringify(r.warnings));
});

test("reference case: the car mass-range Pareto front is non-dominated and matches the model curve", () => {
  const r = run({ model: "car-mass-range", batteryRange: [5, 120] }, "pareto");
  assert.equal(r.status, "PASS", r.reason || "");
  const front = r.outputs.front;
  assert.ok(front.length >= 10, `front size ${front.length}`);
  const mass = (E) => 900 + E / 0.25;
  const range = (E) => E / (0.12 + 6e-5 * mass(E));
  for (const p of front) {
    assert.ok(Math.abs(p.mass - mass(p.batteryKwh)) < 1e-6, `mass at ${p.batteryKwh}`);
    assert.ok(Math.abs(p.rangeKm - range(p.batteryKwh)) < 1e-4, `range at ${p.batteryKwh}`);
  }
  for (let i = 0; i < front.length; i += 1) {
    for (let j = 0; j < front.length; j += 1) {
      if (i === j) continue;
      const a = front[i];
      const b = front[j];
      assert.ok(!(b.mass <= a.mass && b.rangeKm >= a.rangeKm && (b.mass < a.mass || b.rangeKm > a.rangeKm)),
        `point ${i} dominated by ${j}`);
    }
  }
  // the curve's ends: smallest battery = lightest + shortest range
  assert.ok(front[0].batteryKwh < 10 && front[front.length - 1].batteryKwh > 100);
});

test("refusals: start outside bounds, unknown model, engine tier", () => {
  const outside = run({ model: "sphere", start: [5, 5], bounds: [[0, 1], [0, 1]] });
  assert.equal(outside.status, "NOT_COMPUTED");
  assert.ok(outside.reason.includes("outside its bounds"), outside.reason);
  const noModel = run({ start: [0, 0] });
  assert.equal(noModel.status, "NOT_COMPUTED");
  assert.ok(noModel.reason.includes("missing_input:model"), noModel.reason);
  const eng = run({ model: "sphere", start: [1, 1] }, "engine");
  assert.equal(eng.status, "NOT_COMPUTED");
  assert.ok(eng.reason.includes("requires_engine_tier:sxe-21"), eng.reason);
});
