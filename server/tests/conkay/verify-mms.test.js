/**
 * SX-XC-05 verify.mms tests.
 *
 * Reference case (catalogue; Roache; Salari & Knupp
 * SAND2000-1444): Poisson MMS observed order 2 — P1 FEM in
 * L2 (H1 order 1), second-order FD in 1D. Source terms are
 * hand-derived from the manufactured solutions, never from
 * the solver's own output.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/verify-mms.js";

const solver = getSolver("verify.mms");
const run = (inputs, target = "mms") =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

test("registered at L3 with the Poisson order-2 reference", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 3);
  assert.ok(solver.reference.includes("SAND2000-1444"));
});

test("reference case: poisson-2d sin-product confirms L2 order 2 and H1 order 1", () => {
  const r = run({ problem: "poisson-2d" });
  assert.equal(r.status, "PASS", r.reason || JSON.stringify(r.outputs));
  assert.equal(r.outputs.verdict, "order_confirmed");
  assert.ok(Math.abs(r.outputs.observedOrder.l2 - 2) <= 0.35, `L2 order ${r.outputs.observedOrder.l2}`);
  assert.ok(Math.abs(r.outputs.observedOrder.h1 - 1) <= 0.35, `H1 order ${r.outputs.observedOrder.h1}`);
  const errs = r.outputs.rows.map((row) => row.l2Error);
  assert.ok(errs[1] < errs[0] && errs[2] < errs[1], `errors not decreasing: ${errs}`);
  assert.equal(r.inputs.solution, "sin-product");
});

test("poisson-1d sin confirms FD order 2 with decreasing max error", () => {
  const r = run({ problem: "poisson-1d", solution: "sin" });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.equal(r.outputs.verdict, "order_confirmed");
  assert.ok(Math.abs(r.outputs.observedOrder.l2 - 2) <= 0.2, `order ${r.outputs.observedOrder.l2}`);
  const maxErrs = r.outputs.rows.map((row) => row.maxError);
  assert.ok(maxErrs[1] < maxErrs[0] && maxErrs[2] < maxErrs[1]);
});

test("the poly manufactured solutions also confirm (source terms hand-derived)", () => {
  const r1 = run({ problem: "poisson-1d", solution: "poly" });
  assert.equal(r1.outputs.verdict, "order_confirmed", JSON.stringify(r1.outputs.observedOrder));
  const r2 = run({ problem: "poisson-2d", solution: "poly" });
  assert.equal(r2.outputs.verdict, "order_confirmed", JSON.stringify(r2.outputs.observedOrder));
});

test("a custom mesh sequence is honoured and echoed", () => {
  const r = run({ problem: "poisson-1d", meshes: [20, 40, 80] });
  assert.equal(r.status, "PASS", r.reason || "");
  assert.deepEqual(r.inputs.meshes, [20, 40, 80]);
  assert.deepEqual(r.outputs.rows.map((row) => row.n), [20, 40, 80]);
});

test("refusals: missing problem, custom solution, short sequence, oversize mesh, engine tiers", () => {
  const missing = run({});
  assert.equal(missing.status, "NOT_COMPUTED");
  assert.ok(missing.reason.includes("missing_input:problem"), missing.reason);
  const custom = run({ problem: "poisson-2d", solution: "my-own-function" });
  assert.equal(custom.status, "NOT_COMPUTED");
  assert.ok(custom.reason.includes("requires_engine_tier:sxe-02"), custom.reason);
  const short = run({ problem: "poisson-1d", meshes: [40, 80] });
  assert.equal(short.status, "NOT_COMPUTED");
  assert.ok(short.reason.includes("invalid_input:meshes"), short.reason);
  const big = run({ problem: "poisson-2d", meshes: [8, 16, 64] });
  assert.equal(big.status, "NOT_COMPUTED");
  assert.ok(big.reason.includes("size_above_envelope"), big.reason);
  const sym = run({ problem: "poisson-2d" }, "symbolic-source");
  assert.equal(sym.status, "NOT_COMPUTED");
  assert.ok(sym.reason.includes("requires_engine_tier:sxe-02"), sym.reason);
});
