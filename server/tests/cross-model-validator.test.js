// Cohesive R-3 pins — server/lib/cross-model-validator.js (seeded faults).
//
// The brief's evidence standard: a seeded fault is caught by the pass
// before merge, with the referencing surfaces named. Each fault class
// gets its seed here: a requirement bound to a solver that does not
// exist; a requirement bound to a node that is not in its graph; a
// hard-bound requirement on a screening solver (warning class). A
// valid document passes with an empty list — the output is a list,
// never a boolean, and what could not be checked is accounted for in
// `unverifiable`, never silently skipped.
//
// Pure fixtures in listSolvers() / Design IR shapes: no server boot.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateIrAgainstSolvers } from "../lib/cross-model-validator.js";

const SOLVERS = [
  { id: "mass.assembly", domain: "mass", fidelity: 1, screening: false },
  { id: "geometry.clearance", domain: "geometry", fidelity: 1, screening: true },
  { id: "joint.bolt-shear", domain: "joint", fidelity: 2, screening: false },
];

const doc = (requirements, nodes = [{ id: "A1" }, { id: "J1" }]) => ({
  location: "fixture:design",
  ir: { nodes, requirements },
});

const bound = (of, extra = {}) => ({ id: "R1", of, max: "4 kg", ...extra });

describe("validateIrAgainstSolvers — seeded faults", () => {
  it("catches a requirement bound to a solver that does not exist, with the surface named", () => {
    const res = validateIrAgainstSolvers({
      solvers: SOLVERS,
      documents: [doc([bound({ solver: "mass.assemby", target: "A1", output: "mass" })])],
    });
    assert.equal(res.errors.length, 1);
    assert.equal(res.errors[0].kind, "solver_unresolved");
    assert.equal(res.errors[0].surface, "design-ir↔solver-registry");
    assert.match(res.errors[0].location, /requirements\[0\] \(R1\)/);
    assert.match(res.errors[0].detail, /mass\.assemby/);
  });
  it("catches a requirement bound to a node that is not in its graph", () => {
    const res = validateIrAgainstSolvers({
      solvers: SOLVERS,
      documents: [doc([bound({ solver: "mass.assembly", target: "ZZ", output: "mass" })])],
    });
    assert.deepEqual(res.errors.map((e) => e.kind), ["target_unresolved"]);
  });
  it("reports a hard-bound requirement on a screening solver as a WARNING, never an error", () => {
    const res = validateIrAgainstSolvers({
      solvers: SOLVERS,
      documents: [doc([bound({ solver: "geometry.clearance", target: "A1", output: "overallHeight" }, { max: "3.1 m", min: "3.0 m" })])],
    });
    assert.equal(res.errors.length, 0);
    assert.deepEqual(res.warnings.map((w) => w.kind), ["screening_solver_bound_to_hard_requirement"]);
  });
  it("does not warn when a screening solver is bound without a hard bound, or a bound uses a full solver", () => {
    const res = validateIrAgainstSolvers({
      solvers: SOLVERS,
      documents: [doc([
        { id: "R1", of: { solver: "geometry.clearance", target: "A1", output: "overallHeight" } },
        bound({ solver: "joint.bolt-shear", target: "J1", output: "capacity" }),
      ])],
    });
    assert.equal(res.errors.length, 0);
    assert.equal(res.warnings.length, 0);
    assert.equal(res.checked.requirements, 2);
    assert.equal(res.checked.solversConsulted, 2);
  });
  it("a valid document passes with empty lists and honest counts", () => {
    const res = validateIrAgainstSolvers({
      solvers: SOLVERS,
      documents: [doc([bound({ solver: "mass.assembly", target: "A1", output: "mass" })])],
    });
    assert.deepEqual(res.errors, []);
    assert.deepEqual(res.warnings, []);
    assert.deepEqual(res.unverifiable, []);
    assert.deepEqual(res.checked, { documents: 1, requirements: 1, solversConsulted: 1 });
  });
  it("a malformed requirement is unverifiable (owned by the within-model pass), not duplicated as an error", () => {
    const res = validateIrAgainstSolvers({
      solvers: SOLVERS,
      documents: [doc([{ id: "R9", of: { target: "A1" } }])],
    });
    assert.equal(res.errors.length, 0);
    assert.deepEqual(res.unverifiable.map((u) => u.kind), ["requirement_shape"]);
    assert.equal(res.checked.requirements, 0);
  });
});
