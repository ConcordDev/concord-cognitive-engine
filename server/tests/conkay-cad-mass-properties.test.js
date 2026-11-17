// server/tests/conkay-cad-mass-properties.test.js
//
// SX-CAD-03 — cad.mass-properties-brep acceptance tests.
// Reference case: the cube inertia closed form (the catalogue's named
// case): a cube of side a and mass m has I = (1/6) m a^2 about any
// centroidal axis. Expected values are the textbook closed forms,
// computed here from first principles, never read back from the solver.
//
// Adversarial legs: INVALID_INPUT naming the field for negative / NaN /
// 1e300 dimensions; NOT_COMPUTED naming the missing field; an unknown
// material is refused, never assigned a density; a freeform shape is
// NOT_COMPUTED naming the OCC path, never approximated and labelled
// exact. Honesty legs run through the SC-05 helper.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { massPropertiesBrep } from "../lib/conkay/cad/mass-properties-brep.js";
import { getSolver, listSolvers, envelope } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertEchoIntegrity, assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const rel = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

describe("SX-CAD-03 — reference cases (closed forms)", () => {
  it("unit cube: volume, mass, and I = (1/6) m a^2", () => {
    const r = massPropertiesBrep({ shape: "box", dims: { length: 1, width: 1, height: 1 }, densityKgM3: 6000 });
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.volumeM3, 1);
    assert.equal(r.outputs.massKg, 6000);
    assert.ok(rel(r.outputs.inertiaKgM2.Ixx, 1000));
    assert.ok(rel(r.outputs.inertiaKgM2.Iyy, 1000));
    assert.ok(rel(r.outputs.inertiaKgM2.Izz, 1000));
    assert.deepEqual(r.outputs.centroidM, [0, 0, 0]);
    assert.equal(r.outputs.areaM2, 6);
  });

  it("box: Ixx = m/12 (w^2 + h^2) with material-library density", () => {
    const r = massPropertiesBrep({ shape: "box", dims: { length: 2, width: 0.5, height: 0.25 }, material: "steel" });
    const m = 2 * 0.5 * 0.25 * 7850;
    assert.ok(rel(r.outputs.massKg, m));
    assert.ok(rel(r.outputs.inertiaKgM2.Ixx, (m / 12) * (0.5 ** 2 + 0.25 ** 2)));
    assert.match(r.outputs.densitySource, /steel/);
  });

  it("cylinder: Izz = (1/2) m r^2, centroid at h/2", () => {
    const r = massPropertiesBrep({ shape: "cylinder", dims: { radius: 0.1, height: 0.5 }, densityKgM3: 2700 });
    const m = Math.PI * 0.01 * 0.5 * 2700;
    assert.ok(rel(r.outputs.massKg, m));
    assert.ok(rel(r.outputs.inertiaKgM2.Izz, 0.5 * m * 0.01));
    assert.deepEqual(r.outputs.centroidM, [0, 0, 0.25]);
  });

  it("sphere: I = (2/5) m r^2 on every axis", () => {
    const r = massPropertiesBrep({ shape: "sphere", dims: { radius: 0.3 }, densityKgM3: 1000 });
    const m = (4 / 3) * Math.PI * 0.027 * 1000;
    assert.ok(rel(r.outputs.inertiaKgM2.Ixx, 0.4 * m * 0.09));
    assert.ok(rel(r.outputs.inertiaKgM2.Izz, 0.4 * m * 0.09));
  });

  it("tube: Izz = (1/2) m (R^2 + r^2)", () => {
    const r = massPropertiesBrep({ shape: "tube", dims: { outerRadius: 0.2, innerRadius: 0.15, height: 1 }, densityKgM3: 7850 });
    const m = Math.PI * (0.04 - 0.0225) * 7850;
    assert.ok(rel(r.outputs.massKg, m));
    assert.ok(rel(r.outputs.inertiaKgM2.Izz, 0.5 * m * (0.04 + 0.0225)));
  });

  it("behavioural sweep: doubling a box edge doubles volume and mass", () => {
    const a = massPropertiesBrep({ shape: "box", dims: { length: 1, width: 1, height: 1 }, densityKgM3: 1000 });
    const b = massPropertiesBrep({ shape: "box", dims: { length: 2, width: 1, height: 1 }, densityKgM3: 1000 });
    assert.ok(rel(b.outputs.volumeM3, 2 * a.outputs.volumeM3));
    assert.ok(rel(b.outputs.massKg, 2 * a.outputs.massKg));
  });
});

describe("SX-CAD-03 — adversarial + honesty legs", () => {
  it("negative / NaN / 1e300 dimensions are INVALID_INPUT naming the field", () => {
    for (const bad of [-1, NaN, 1e300]) {
      const r = massPropertiesBrep({ shape: "cylinder", dims: { radius: bad, height: 1 }, densityKgM3: 1000 });
      assert.match(r.notComputed, /INVALID_INPUT: dims\.radius/);
    }
  });

  it("missing dimension and missing density are NOT_COMPUTED naming the field (SC-05)", async () => {
    await assertNothingAssumed(
      (p) => massPropertiesBrep(p),
      { shape: "box", dims: { length: 1, width: 1, height: 1 }, densityKgM3: 1000 },
      ["densityKgM3"],
      "cad.mass-properties-brep"
    );
    const r = massPropertiesBrep({ shape: "box", dims: { length: 1, width: 1 }, densityKgM3: 1000 });
    assert.match(r.notComputed, /missing_input:dims\.height/);
  });

  it("an unknown material is refused — no density is assumed", () => {
    const r = massPropertiesBrep({ shape: "sphere", dims: { radius: 1 }, material: "unobtanium" });
    assert.match(r.notComputed, /unobtanium/);
  });

  it("a freeform shape is NOT_COMPUTED naming the OCC path, never approximated", () => {
    const r = massPropertiesBrep({ shape: "freeform-sweep", dims: { radius: 1 }, densityKgM3: 1000 });
    assert.match(r.notComputed, /shape_not_in_exact_set/);
    assert.match(r.notComputed, /OCC/);
  });

  it("a tube with inner >= outer radius is INVALID_INPUT", () => {
    const r = massPropertiesBrep({ shape: "tube", dims: { outerRadius: 0.1, innerRadius: 0.2, height: 1 }, densityKgM3: 1000 });
    assert.match(r.notComputed, /INVALID_INPUT: dims\.innerRadius/);
  });

  it("echo integrity + citations through the envelope (SC-05)", () => {
    const s = getSolver("cad.mass-properties-brep");
    const raw = massPropertiesBrep({ shape: "box", dims: { length: 1, width: 1, height: 1 }, densityKgM3: 6000 });
    assertEchoIntegrity(raw, { densityKgM3: 6000 }, "cad.mass-properties-brep");
    const env = envelope(s, "P1", raw, { runtimeMs: 1, revision: 0, supplied: { densityKgM3: 6000 }, ignored: [] });
    assert.equal(env.status, "PASS");
    assertCitationsDomain(env, s, "cad.mass-properties-brep");
  });
});

describe("SX-CAD-03 — registry + IR reachability", () => {
  it("is registered at L2 with declarations", () => {
    const s = listSolvers().find((x) => x.id === "cad.mass-properties-brep");
    assert.ok(s, "cad.mass-properties-brep not in the registry");
    assert.equal(s.fidelity, 2);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "cad3", name: "CAD3" },
      nodes: [
        {
          id: "P1",
          kind: "Part",
          name: "block",
          props: { "cad.massProperties": { shape: "box", dims: { length: 1, width: 1, height: 1 }, densityKgM3: 6000 } },
        },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "cad.mass-properties-brep@P1");
    assert.ok(env, "no cad.mass-properties-brep envelope");
    assert.equal(env.status, "PASS");
    assert.equal(env.outputs.massKg, 6000);
  });
});
