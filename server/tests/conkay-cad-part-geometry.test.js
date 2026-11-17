// server/tests/conkay-cad-part-geometry.test.js
//
// SX-CAD-05 — cad.part-geometry acceptance tests.
// Reference case (the catalogue's named case): cube volume exact, and
// every BOM line has a solid — each part record carries volume, area,
// and a material slot. The slot discipline is the ticket's: a resolved
// material/density fills it with the source named; an unresolvable or
// undeclared material leaves it EMPTY with the reason — never assumed.
// Template parameter bounds are the declared validity envelope:
// outside is out_of_envelope naming the bound, never clamped.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { partGeometry } from "../lib/conkay/cad/part-geometry.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const rel = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const BOM = {
  parts: [
    { id: "base", template: "plate", params: { length: 1, width: 1, height: 1 }, densityKgM3: 6000 },
    { id: "axle", template: "shaft", params: { radius: 0.05, height: 0.8 }, material: "steel" },
    { id: "line", template: "pipe", params: { outerRadius: 0.03, innerRadius: 0.025, height: 1.2 } },
    { id: "knob", template: "ball", params: { radius: 0.04 }, material: "unobtanium" },
  ],
};

describe("SX-CAD-05 — reference case (cube exact; every BOM line has a solid)", () => {
  it("instantiates the whole BOM with volumes, areas, and material slots", () => {
    const r = partGeometry(BOM);
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.partCount, 4);
    const P = Object.fromEntries(r.outputs.parts.map((p) => [p.id, p]));
    assert.equal(P.base.volumeM3, 1, "unit cube volume exact");
    assert.equal(P.base.massKg, 6000);
    assert.ok(rel(P.axle.volumeM3, Math.PI * 0.0025 * 0.8));
    assert.equal(P.axle.massKg, P.axle.volumeM3 * 7850, "steel from the material library, source named");
    assert.match(P.axle.materialSlot, /material library: steel/);
    assert.ok(rel(P.line.volumeM3, Math.PI * (0.0009 - 0.000625) * 1.2));
    for (const p of r.outputs.parts) {
      assert.ok(p.volumeM3 > 0 && p.areaM2 > 0, `${p.id} has a solid`);
      assert.ok("materialSlot" in p, `${p.id} carries a material slot`);
    }
  });

  it("unresolved and undeclared materials leave the slot empty WITH the reason — never assumed", () => {
    const r = partGeometry(BOM);
    const P = Object.fromEntries(r.outputs.parts.map((p) => [p.id, p]));
    assert.equal(P.knob.materialSlot, null);
    assert.equal(P.knob.massKg, null);
    assert.match(P.knob.materialNote, /unobtanium/);
    assert.equal(P.line.materialSlot, null);
    assert.match(P.line.materialNote, /no material or density declared/);
    assert.deepEqual(r.outputs.massCoverage, { withMass: 2, withoutMass: 2 });
    assert.equal(r.outputs.totalMassKg, 6000 + P.axle.massKg, "the total covers only the massed parts, and says so");
  });

  it("trend: doubling a plate's dimensions multiplies its volume by 8", () => {
    const one = partGeometry({ parts: [{ id: "p", template: "plate", params: { length: 0.5, width: 0.4, height: 0.3 } }] });
    const two = partGeometry({ parts: [{ id: "p", template: "plate", params: { length: 1, width: 0.8, height: 0.6 } }] });
    assert.ok(rel(two.outputs.parts[0].volumeM3, one.outputs.parts[0].volumeM3 * 8));
  });
});

describe("SX-CAD-05 — envelope + engine honesty", () => {
  it("a parameter outside its template bound is out_of_envelope naming the bound — never clamped", () => {
    const r = partGeometry({ parts: [{ id: "p", template: "plate", params: { length: 11, width: 1, height: 1 } }] });
    assert.match(r.notComputed, /out_of_envelope: parts\[0\]\.params\.length 11 .*\(0, 10\]/);
  });

  it("every run carries the OCC tier NOT_COMPUTED engine_unavailable:sxe-06, screening labelled", () => {
    const r = partGeometry(BOM);
    assert.equal(r.outputs.engineTier.status, "NOT_COMPUTED");
    assert.equal(r.outputs.engineTier.reason, "engine_unavailable:sxe-06");
    assert.equal(r.outputs.screening, true);
  });
});

describe("SX-CAD-05 — adversarial + honesty legs", () => {
  it("malformed inputs are INVALID_INPUT / missing / unknown, named (SC-05)", async () => {
    await assertNothingAssumed((p) => partGeometry(p), BOM, ["parts"], "cad.part-geometry");
    assert.match(partGeometry({ parts: [{ id: "x", template: "wing", params: {} }] }).notComputed, /unknown_template: parts\[0\]\.template "wing"/);
    assert.match(partGeometry({ parts: [{ id: "x", template: "plate", params: { length: 1, width: 1 } }] }).notComputed, /missing_input:parts\[0\]\.params\.height/);
    assert.match(partGeometry({ parts: [{ id: "x", template: "shaft", params: { radius: -0.5, height: 1 } }] }).notComputed, /out_of_envelope: parts\[0\]\.params\.radius/);
    assert.match(partGeometry({ parts: [{ id: "x", template: "ball", params: { radius: NaN } }] }).notComputed, /INVALID_INPUT: parts\[0\]\.params\.radius/);
    assert.match(partGeometry({ parts: [{ id: "x", template: "pipe", params: { outerRadius: 0.02, innerRadius: 0.03, height: 1 } }] }).notComputed, /INVALID_INPUT: parts\[0\].*innerRadius/);
    assert.match(partGeometry({ parts: [BOM.parts[0], BOM.parts[0]] }).notComputed, /duplicates "base"/);
  });

  it("echo + citations legs (SC-05): structured inputs echoed exactly; no out-of-domain citations", () => {
    const r = partGeometry(BOM);
    // assertEchoIntegrity is a scalar-input assertion (Number() reduction);
    // for structured inputs the same property is an exact deep-equal echo.
    assert.deepEqual(r.inputs, BOM, "inputs echoed exactly as submitted");
    assertCitationsDomain(r, getSolver("cad.part-geometry"), "cad.part-geometry");
  });
});

describe("SX-CAD-05 — registry + IR reachability", () => {
  it("is registered at L3 with declarations and the SXE-06 engine dependency", () => {
    const s = listSolvers().find((x) => x.id === "cad.part-geometry");
    assert.ok(s, "cad.part-geometry not in the registry");
    assert.equal(s.fidelity, 3);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
    assert.deepEqual(getSolver("cad.part-geometry").engineDependent, ["sxe-06"]);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "cad5", name: "CAD5" },
      nodes: [
        { id: "B1", kind: "Part", name: "bom", props: { "cad.partGeometry": { parts: [{ id: "base", template: "plate", params: { length: 1, width: 1, height: 1 }, densityKgM3: 6000 }] } } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "cad.part-geometry@B1");
    assert.ok(env, "no cad.part-geometry envelope");
    assert.equal(env.outputs.parts[0].volumeM3, 1);
    assert.equal(env.outputs.engineTier.reason, "engine_unavailable:sxe-06");
  });
});
