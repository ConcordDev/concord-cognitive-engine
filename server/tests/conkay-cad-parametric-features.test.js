// server/tests/conkay-cad-parametric-features.test.js
//
// SX-CAD-02 — cad.parametric-features acceptance tests.
// Reference case (the catalogue's named case): a constrained sketch
// closes — the perturbed rectangle, under fixed/horizontal/vertical/
// distance constraints, solves to the exact rectangle with residual
// within the declared tolerance and DOF-by-count 0. Expected values
// are the constraint declarations themselves, never the solver's own
// output. The OCC tier (SXE-21) is absent: every run must carry it
// NOT_COMPUTED engine_unavailable:sxe-21 beside the labelled
// screening solve.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parametricFeatures } from "../lib/conkay/cad/parametric-features.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const RECT = {
  points: [
    { id: "P1", x: 0.1, y: -0.1 },
    { id: "P2", x: 2.8, y: 0.2 },
    { id: "P3", x: 3.2, y: 1.8 },
    { id: "P4", x: -0.2, y: 2.1 },
  ],
  constraints: [
    { type: "fixed", point: "P1", x: 0, y: 0 },
    { type: "horizontal", a: "P1", b: "P2" },
    { type: "vertical", a: "P2", b: "P3" },
    { type: "horizontal", a: "P3", b: "P4" },
    { type: "vertical", a: "P4", b: "P1" },
    { type: "distance", a: "P1", b: "P2", value: 3 },
    { type: "distance", a: "P2", b: "P3", value: 2 },
  ],
};
const near = (a, b) => Math.abs(a - b) <= 1e-9;

describe("SX-CAD-02 — reference case (the constrained sketch closes)", () => {
  it("solves the perturbed rectangle to the exact declared rectangle", () => {
    const r = parametricFeatures(RECT);
    assert.ok(!r.notComputed, r.notComputed);
    const P = Object.fromEntries(r.outputs.solvedPoints.map((p) => [p.id, p]));
    assert.ok(near(P.P1.x, 0) && near(P.P1.y, 0));
    assert.ok(near(P.P2.x, 3) && near(P.P2.y, 0));
    assert.ok(near(P.P3.x, 3) && near(P.P3.y, 2));
    assert.ok(near(P.P4.x, 0) && near(P.P4.y, 2));
    assert.ok(r.outputs.maxResidual <= 1e-9);
    assert.equal(r.outputs.dofByCount, 0, "8 point DOF - 8 scalar constraint equations");
  });

  it("is deterministic: two runs are deep-equal", () => {
    assert.deepEqual(parametricFeatures(RECT).outputs, parametricFeatures(RECT).outputs);
  });

  it("coincident + fixed pulls both points to the anchor", () => {
    const r = parametricFeatures({
      points: [{ id: "A", x: 5, y: 5 }, { id: "B", x: 9, y: 1 }],
      constraints: [
        { type: "fixed", point: "A", x: 1, y: 2 },
        { type: "coincident", a: "A", b: "B" },
      ],
    });
    const P = Object.fromEntries(r.outputs.solvedPoints.map((p) => [p.id, p]));
    assert.ok(near(P.B.x, 1) && near(P.B.y, 2));
  });

  it("trend: the solved distance tracks the declared value across a sweep", () => {
    for (const d of [1.5, 3, 4.25]) {
      const r = parametricFeatures({
        points: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 1, y: 0 }],
        constraints: [
          { type: "fixed", point: "A", x: 0, y: 0 },
          { type: "distance", a: "A", b: "B", value: d },
        ],
      });
      const B = r.outputs.solvedPoints.find((p) => p.id === "B");
      assert.ok(Math.abs(Math.hypot(B.x, B.y) - d) <= 1e-9, `distance ${d}`);
    }
  });
});

describe("SX-CAD-02 — engine honesty + convergence discipline", () => {
  it("every run carries the OCC tier NOT_COMPUTED engine_unavailable:sxe-21, screening labelled", () => {
    const r = parametricFeatures(RECT);
    assert.equal(r.outputs.engineTier.status, "NOT_COMPUTED");
    assert.equal(r.outputs.engineTier.reason, "engine_unavailable:sxe-21");
    assert.equal(r.outputs.screening, true);
    assert.ok(r.warnings.some((w) => /sxe-21/.test(w)));
  });

  it("contradictory constraints are solver_not_converged, never a settled lie", () => {
    const r = parametricFeatures({
      points: [{ id: "A", x: 0, y: 0 }, { id: "B", x: 1, y: 0 }],
      constraints: [
        { type: "distance", a: "A", b: "B", value: 1 },
        { type: "distance", a: "A", b: "B", value: 5 },
      ],
    });
    assert.match(r.notComputed, /solver_not_converged/);
  });
});

describe("SX-CAD-02 — adversarial + honesty legs", () => {
  it("malformed inputs are INVALID_INPUT / missing, named (SC-05)", async () => {
    await assertNothingAssumed((p) => parametricFeatures(p), RECT, ["points"], "cad.parametric-features");
    assert.match(parametricFeatures({ points: [{ id: "A", x: 0, y: 0 }, { id: "A", x: 1, y: 1 }] }).notComputed, /INVALID_INPUT: points\[1\]\.id duplicates/);
    assert.match(parametricFeatures({ points: [{ id: "A", x: NaN, y: 0 }] }).notComputed, /INVALID_INPUT: points\[0\] coordinates/);
    assert.match(parametricFeatures({ points: RECT.points, constraints: [{ type: "tangent", a: "P1", b: "P2" }] }).notComputed, /INVALID_INPUT: constraints\[0\]\.type/);
    assert.match(parametricFeatures({ points: RECT.points, constraints: [{ type: "distance", a: "P1", b: "ZZ", value: 1 }] }).notComputed, /unknown point "ZZ"/);
    assert.match(parametricFeatures({ points: RECT.points, constraints: [{ type: "distance", a: "P1", b: "P2", value: -2 }] }).notComputed, /INVALID_INPUT: constraints\[0\]\.value/);
  });

  it("echo integrity + citations legs (SC-05)", () => {
    const r = parametricFeatures(RECT);
    // The helper's assertEchoIntegrity reduces values via Number() — it is a
    // scalar-input assertion and cannot compare array/object inputs (both
    // sides go NaN). For this solver's structured inputs the same SC-05
    // property — inputs used == inputs submitted, nothing substituted — is
    // asserted as an exact deep-equal echo instead. Helper unchanged.
    assert.deepEqual(r.inputs, RECT, "inputs echoed exactly as submitted");
    assertCitationsDomain(r, getSolver("cad.parametric-features"), "cad.parametric-features");
  });
});

describe("SX-CAD-02 — registry + IR reachability", () => {
  it("is registered at L2 with declarations and the SXE-21 engine dependency", () => {
    const s = listSolvers().find((x) => x.id === "cad.parametric-features");
    assert.ok(s, "cad.parametric-features not in the registry");
    assert.equal(s.fidelity, 2);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
    assert.deepEqual(getSolver("cad.parametric-features").engineDependent, ["sxe-21"]);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "cad2", name: "CAD2" },
      nodes: [
        { id: "S1", kind: "Part", name: "sketch", props: { "cad.parametricFeatures": RECT } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "cad.parametric-features@S1");
    assert.ok(env, "no cad.parametric-features envelope");
    assert.equal(env.outputs.dofByCount, 0);
    assert.equal(env.outputs.engineTier.reason, "engine_unavailable:sxe-21");
  });
});
