// server/tests/conkay-cad-assembly-constraints.test.js
//
// SX-CAD-06 — cad.assembly-constraints acceptance tests.
// Reference case (the catalogue's named case): a 4-bar assembly has
// DOF = 1 — ground + 3 moving links, 4 revolute joints, planar
// Grübler-Kutzbach: 3(4-1) - 2*4 = 1. The expected value is the
// textbook criterion applied by hand, never the solver's own output.
// Over-constraint is detected and named by count, with the
// special-geometry caveat carried in the outputs.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assemblyConstraints } from "../lib/conkay/cad/assembly-constraints.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const FOUR_BAR = {
  mechanism: "planar",
  links: [
    { id: "ground", ground: true },
    { id: "crank" },
    { id: "coupler" },
    { id: "rocker" },
  ],
  joints: [
    { type: "revolute", links: ["ground", "crank"] },
    { type: "revolute", links: ["crank", "coupler"] },
    { type: "revolute", links: ["coupler", "rocker"] },
    { type: "revolute", links: ["rocker", "ground"] },
  ],
};

describe("SX-CAD-06 — reference case (4-bar assembly DOF = 1)", () => {
  it("counts the 4-bar at exactly one degree of freedom", () => {
    const r = assemblyConstraints(FOUR_BAR);
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.dof, 1);
    assert.equal(r.outputs.classification, "mechanism");
    assert.equal(r.outputs.constraintSum, 8);
  });

  it("a locked triangle counts as a structure; one extra joint over-constrains it, named", () => {
    const tri = {
      mechanism: "planar",
      links: [{ id: "g", ground: true }, { id: "a" }, { id: "b" }],
      joints: [
        { type: "revolute", links: ["g", "a"] },
        { type: "revolute", links: ["a", "b"] },
        { type: "revolute", links: ["b", "g"] },
      ],
    };
    assert.equal(assemblyConstraints(tri).outputs.dof, 0);
    const over = assemblyConstraints({ ...tri, joints: [...tri.joints, { type: "revolute", links: ["g", "b"] }] });
    assert.equal(over.outputs.dof, -2);
    assert.equal(over.outputs.classification, "over-constrained-by-count");
    assert.ok(over.warnings.some((w) => /over-constrained/.test(w)));
    assert.equal(over.outputs.redundantCandidates.length, 1, "the duplicate b-g revolute is named as a redundancy candidate");
  });

  it("spatial accounting: a door on two hinges counts DOF by the spatial criterion", () => {
    const r = assemblyConstraints({
      mechanism: "spatial",
      links: [{ id: "frame", ground: true }, { id: "door" }],
      joints: [
        { type: "revolute", links: ["frame", "door"] },
        { type: "revolute", links: ["frame", "door"] },
      ],
    });
    // 6(1) - 5 - 5 = -4 by count: the classic aligned-hinge redundancy,
    // reported as over-constrained BY COUNT with the caveat in dofNote.
    assert.equal(r.outputs.dof, -4);
    assert.match(r.outputs.dofNote, /not a rank proof/);
  });

  it("trend: an added link pinned by two revolute joints consumes its freedom (DOF 1 -> 0)", () => {
    const five = assemblyConstraints({
      ...FOUR_BAR,
      links: [...FOUR_BAR.links, { id: "extra" }],
      joints: [...FOUR_BAR.joints, { type: "revolute", links: ["coupler", "extra"] }, { type: "revolute", links: ["extra", "ground"] }],
    });
    assert.equal(five.outputs.dof, 0, "3*(5-1) - 2*6 = 0");
  });
});

describe("SX-CAD-06 — engine honesty + adversarial legs", () => {
  it("every run carries the geometric tier NOT_COMPUTED engine_unavailable:sxe-01, screening labelled", () => {
    const r = assemblyConstraints(FOUR_BAR);
    assert.equal(r.outputs.engineTier.status, "NOT_COMPUTED");
    assert.equal(r.outputs.engineTier.reason, "engine_unavailable:sxe-01");
    assert.equal(r.outputs.screening, true);
  });

  it("malformed inputs are INVALID_INPUT / missing, named (SC-05)", async () => {
    await assertNothingAssumed((p) => assemblyConstraints(p), FOUR_BAR, ["mechanism", "links"], "cad.assembly-constraints");
    assert.match(assemblyConstraints({ mechanism: "flat", links: FOUR_BAR.links }).notComputed, /INVALID_INPUT: mechanism/);
    assert.match(assemblyConstraints({ mechanism: "planar", links: [{ id: "a" }, { id: "b" }] }).notComputed, /exactly one link must be marked ground \(got 0\)/);
    assert.match(assemblyConstraints({ mechanism: "planar", links: FOUR_BAR.links, joints: [{ type: "spherical", links: ["ground", "crank"] }] }).notComputed, /not in the planar vocabulary/);
    assert.match(assemblyConstraints({ mechanism: "planar", links: FOUR_BAR.links, joints: [{ type: "revolute", links: ["ground", "ghost"] }] }).notComputed, /unknown link "ghost"/);
    assert.match(assemblyConstraints({ mechanism: "planar", links: FOUR_BAR.links, joints: [{ type: "revolute", links: ["crank", "crank"] }] }).notComputed, /two distinct links/);
  });

  it("echo + citations legs (SC-05): structured inputs echoed exactly; no out-of-domain citations", () => {
    const r = assemblyConstraints(FOUR_BAR);
    assert.deepEqual(r.inputs, FOUR_BAR, "inputs echoed exactly as submitted");
    assertCitationsDomain(r, getSolver("cad.assembly-constraints"), "cad.assembly-constraints");
  });
});

describe("SX-CAD-06 — registry + IR reachability", () => {
  it("is registered at L3 with declarations and the SXE-01 engine dependency", () => {
    const s = listSolvers().find((x) => x.id === "cad.assembly-constraints");
    assert.ok(s, "cad.assembly-constraints not in the registry");
    assert.equal(s.fidelity, 3);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
    assert.deepEqual(getSolver("cad.assembly-constraints").engineDependent, ["sxe-01"]);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "cad6", name: "CAD6" },
      nodes: [
        { id: "M1", kind: "Part", name: "linkage", props: { "cad.assemblyConstraints": FOUR_BAR } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "cad.assembly-constraints@M1");
    assert.ok(env, "no cad.assembly-constraints envelope");
    assert.equal(env.outputs.dof, 1);
  });
});
