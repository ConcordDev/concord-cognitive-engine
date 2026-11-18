/**
 * SX-XC-07 surrogate.build tests.
 *
 * Reference discipline (catalogue): self-validated against
 * HELD-OUT top-tier runs. The training functions are known
 * exactly; held-out errors are graded against the true
 * function at points the surrogate never trained on.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/surrogate-build.js";

const solver = getSolver("surrogate.build");
const run = (inputs, target = "build-predict") =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

const quad = (x, y) => 1 + 2 * x + 3 * y + x * x - x * y + 0.5 * y * y;
const trainPts = [];
for (const x of [0, 0.25, 0.5, 0.75, 1]) for (const y of [0, 0.5, 1]) trainPts.push([x, y]);
const trainTD = { points: trainPts, values: trainPts.map(([x, y]) => quad(x, y)) };

test("registered at L3 with the held-out discipline declared", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.reference.includes("held-out"));
});

test("reference case: a quadratic surface recovers an exactly quadratic function, held-out error at precision", () => {
  const heldOut = { points: [[0.13, 0.37], [0.62, 0.81], [0.9, 0.2]], values: [quad(0.13, 0.37), quad(0.62, 0.81), quad(0.9, 0.2)] };
  const r = run({ method: "poly", degree: 2, trainingData: trainTD, queries: [[0.3, 0.4]], validationData: heldOut, tolerance: 1e-6 });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.ok(Math.abs(r.outputs.predictions[0].value - quad(0.3, 0.4)) < 1e-8, `pred ${r.outputs.predictions[0].value} vs ${quad(0.3, 0.4)}`);
  assert.equal(r.outputs.validation.withinTolerance, true);
  assert.ok(r.outputs.validation.maxError < 1e-6, `held-out max err ${r.outputs.validation.maxError}`);
});

test("kriging interpolates: training values reproduced, interior prediction carries an error bar", () => {
  const xs = Array.from({ length: 9 }, (_, i) => i * 0.375);
  const td = { points: xs.map((x) => [x]), values: xs.map((x) => Math.sin(x)) };
  const atTrain = run({ method: "kriging", trainingData: td, queries: [[1.5]] });
  assert.equal(atTrain.status, "PASS", atTrain.reason || "");
  assert.ok(Math.abs(atTrain.outputs.predictions[0].value - Math.sin(1.5)) < 1e-6, `interp ${atTrain.outputs.predictions[0].value}`);
  const mid = run({ method: "kriging", trainingData: td, queries: [[1.234]] });
  assert.ok(Math.abs(mid.outputs.predictions[0].value - Math.sin(1.234)) < 0.05, `mid ${mid.outputs.predictions[0].value} vs ${Math.sin(1.234)}`);
  assert.ok(mid.outputs.predictions[0].errorBar > 0);
});

test("hull discipline: a query outside the training range is refused by name", () => {
  const r = run({ method: "poly", trainingData: trainTD, queries: [[2, 0.5]] });
  assert.equal(r.status, "NOT_COMPUTED");
  assert.ok(r.reason.includes("outside_training_hull"), r.reason);
});

test("POD: a rank-2 parametric field is captured by 2 modes and predicted exactly at a new parameter", () => {
  const xs = Array.from({ length: 9 }, (_, i) => i / 8);
  const field = (mu) => xs.map((x) => mu * Math.sin(Math.PI * x) + mu * mu * Math.cos(Math.PI * x));
  const mus = [0.5, 1.0, 1.5, 2.0];
  const r = run({ snapshots: { parameters: mus.map((m) => [m]), fields: mus.map(field) }, queryParameters: [1.25] }, "pod");
  assert.equal(r.status, "PASS", r.reason || "");
  assert.equal(r.outputs.modesUsed, 2);
  assert.ok(r.outputs.energyCaptured > 0.999999, `energy ${r.outputs.energyCaptured}`);
  const truth = field(1.25);
  const maxErr = Math.max(...r.outputs.predictedField.map((v, i) => Math.abs(v - truth[i])));
  assert.ok(maxErr < 1e-6, `POD field max err ${maxErr}`);
});

test("refusals: missing training data, underdetermined surface, engine tier", () => {
  const missing = run({ method: "poly", queries: [[0, 0]] });
  assert.equal(missing.status, "NOT_COMPUTED");
  assert.ok(missing.reason.includes("missing_input:trainingData"), missing.reason);
  const under = run({ method: "poly", degree: 2, trainingData: { points: [[0, 0], [1, 0], [0, 1]], values: [1, 2, 3] }, queries: [[0.5, 0.5]] });
  assert.equal(under.status, "NOT_COMPUTED");
  assert.ok(under.reason.includes("underdetermined"), under.reason);
  const eng = run({ method: "poly", trainingData: trainTD, queries: [[0, 0]] }, "engine");
  assert.equal(eng.status, "NOT_COMPUTED");
  assert.ok(eng.reason.includes("requires_engine_tier:sxe-01"), eng.reason);
});
