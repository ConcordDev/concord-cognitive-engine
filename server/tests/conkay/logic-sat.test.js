/**
 * SX-NUM-22 math.logic-sat tests.
 *
 * Reference case (SAT competition benchmark family): the
 * pigeonhole principle PHP(4,3) — 4 pigeons, 3 holes — is
 * UNSAT. A SAT case's model is re-verified independently in
 * the test (not trusting the solver's own verification), and
 * model counts are pinned on hand-enumerable formulas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { envelope, getSolver } from "../../lib/conkay/physics/registry.js";
import "../../lib/conkay/physics/solvers/logic-sat.js";

const solver = getSolver("math.logic-sat");
const run = (inputs, target) =>
  envelope(solver, target, solver.run({ inputs }, target), { runtimeMs: 1 });

function pigeonhole(pigeons, holes) {
  const v = (p, h) => p * holes + h + 1;
  const clauses = [];
  for (let p = 0; p < pigeons; p += 1) {
    clauses.push(Array.from({ length: holes }, (_, h) => v(p, h)));
  }
  for (let h = 0; h < holes; h += 1) {
    for (let p1 = 0; p1 < pigeons; p1 += 1) {
      for (let p2 = p1 + 1; p2 < pigeons; p2 += 1) {
        clauses.push([-v(p1, h), -v(p2, h)]);
      }
    }
  }
  return clauses;
}

test("registered at L1 screening with the pigeonhole reference", () => {
  assert.ok(solver);
  assert.equal(solver.fidelity, 1);
  assert.ok(solver.reference.includes("pigeonhole"));
});

test("reference case: PHP(4,3) is UNSAT; PHP(3,3) is SAT with a verified model", () => {
  const unsat = run({ clauses: pigeonhole(4, 3) }, "sat");
  assert.equal(unsat.status, "PASS", unsat.reason || "");
  assert.equal(unsat.outputs.satisfiable, false);
  const sat = run({ clauses: pigeonhole(3, 3) }, "sat");
  assert.equal(sat.outputs.satisfiable, true);
  assert.equal(sat.outputs.modelVerified, true);
  // independent re-verification, not the solver's own word
  for (const clause of pigeonhole(3, 3)) {
    assert.ok(clause.some((lit) => sat.outputs.model[Math.abs(lit)] === (lit > 0)), `clause ${clause} satisfied`);
  }
});

test("unit propagation and the empty clause behave; counts are exact on hand-enumerable formulas", () => {
  const forced = run({ clauses: [[1], [-1, 2], [-2, 3]] }, "sat");
  assert.equal(forced.outputs.satisfiable, true);
  assert.deepEqual(
    [forced.outputs.model[1], forced.outputs.model[2], forced.outputs.model[3]],
    [true, true, true],
  );
  const empty = run({ clauses: [[1], []] }, "sat");
  assert.equal(empty.outputs.satisfiable, false);
  // (a OR b): 3 models over {a,b}; with a declared third free variable: 6
  assert.equal(run({ clauses: [[1, 2]] }, "count").outputs.modelCount, "3");
  assert.equal(run({ clauses: [[1, 2]], variables: 3 }, "count").outputs.modelCount, "6");
  // exactly-one-of-three via PHP shape without the capacity clauses is SAT-many; a contradiction counts 0
  assert.equal(run({ clauses: [[1], [-1]] }, "count").outputs.modelCount, "0");
});

test("SMT is the named engine tier; malformed CNF refuses by name", () => {
  const smt = run({ clauses: [[1]] }, "smt");
  assert.equal(smt.status, "NOT_COMPUTED");
  assert.ok(smt.reason.startsWith("requires_engine_tier:z3"), smt.reason);
  const bad = run({ clauses: [[1, 0]] }, "sat");
  assert.equal(bad.status, "NOT_COMPUTED");
  assert.ok(bad.reason.startsWith("invalid_input"), bad.reason);
});
