// SC-05 — the input-integrity guard, armed on the production IR path.
//
// Batch #2384's guard lives in envelope() (physics/registry.js) and fires
// only when the caller passes `supplied`/`ignored`. The direct path arms
// it (solver-input-integrity.test.js); the production path — MCP
// conkay_solve -> openDesign -> DesignEngine.ensure() — never did, so on
// the path every production solve takes, a solver echoing a different
// number than the design declares still reported PASS (B2's
// EQUIV-EVIDENCE.md §2: tampered E echo PASS on the graph path,
// NOT_COMPUTED on the armed path). The fix threads the design's declared
// values as `supplied` through DesignEngine.ensure() into envelope().
// These legs run the REAL production shape (openDesign -> ensure) with
// test-only solvers that read the design honestly or substitute against
// it, plus the shipped beam.fea on the evidence design.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { openDesign } from "../lib/conkay/index.js";
import { registerSolver } from "../lib/conkay/physics/registry.js";

const near = (a, b, rel = 1e-9) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

// The evidence design (B2's equiv-checks beamIR, verbatim): a simply
// supported i-beam, library steel-a992 (E = 200 GPa), 60 kN point load.
const beamIR = () => ({
  design: { id: "frame" },
  nodes: [{ id: "G1", kind: "Beam", material: "steel-a992", props: { support: "simply-supported" },
    geometry: { shape: "i-beam", length: "4 m", height: "300 mm", flangeWidth: "150 mm", flangeThickness: "12 mm", webThickness: "8 mm" } }],
  loadCases: [{ id: "LC1", loads: [{ target: "G1", pointLoad: "60 kN" }] }],
});

const beamTargets = (g) => g.nodesOfKind("Beam").map((n) => n.id);

// Reads the design through the context and echoes exactly what it read.
registerSolver({
  id: "test.sc05-honest", version: "0.0.0", domain: "structural.bending", fidelity: 1,
  method: "test-only SC-05 probe: echoes the design's declared values verbatim",
  targets: beamTargets,
  run(ctx, id) {
    const g = ctx.get(id, "geometry");
    const mat = ctx.material(id);
    const loads = ctx.loadsOn(id);
    return {
      inputs: {
        E: { value: mat.youngsModulusPa, unit: "Pa" },
        yield: { value: mat.yieldPa, unit: "Pa" },
        length: { value: g.length, unit: "m" },
        ...Object.fromEntries(loads.map((l) => [`pointLoad.${l.loadCase}`, { value: l.pointLoad, unit: "N" }])),
        // A derived value under a name the design never declares: the
        // guard is conservative about unsupplied names and must not fire.
        sectionModulus: { value: 4.5e-4, unit: "m^3" },
      },
      outputs: { usedE: { value: mat.youngsModulusPa, unit: "Pa" } },
      margins: [], warnings: [], assumptions: [],
    };
  },
});

// Reads E from the design's material, then echoes (and uses) 190 GPa.
registerSolver({
  id: "test.sc05-substitutor", version: "0.0.0", domain: "structural.bending", fidelity: 1,
  method: "test-only SC-05 probe: substitutes E against the design",
  targets: beamTargets,
  run(ctx, id) {
    const mat = ctx.material(id);
    void mat.youngsModulusPa; // read, then ignored — the substitution
    return {
      inputs: { E: { value: 190e9, unit: "Pa" } },
      outputs: { usedE: { value: 190e9, unit: "Pa" } },
      margins: [], warnings: [], assumptions: [],
    };
  },
});

// Echoes the beam twice as long as the design declares.
registerSolver({
  id: "test.sc05-geom-substitutor", version: "0.0.0", domain: "structural.bending", fidelity: 1,
  method: "test-only SC-05 probe: substitutes a geometry value against the design",
  targets: beamTargets,
  run(ctx, id) {
    const g = ctx.get(id, "geometry");
    return {
      inputs: { length: { value: g.length * 2, unit: "m" } },
      outputs: {}, margins: [], warnings: [], assumptions: [],
    };
  },
});

// Echoes half the point load the design declares.
registerSolver({
  id: "test.sc05-load-substitutor", version: "0.0.0", domain: "structural.bending", fidelity: 1,
  method: "test-only SC-05 probe: substitutes a load value against the design",
  targets: beamTargets,
  run(ctx, id) {
    const loads = ctx.loadsOn(id);
    return {
      inputs: Object.fromEntries(loads.map((l) => [`pointLoad.${l.loadCase}`, { value: l.pointLoad / 2, unit: "N" }])),
      outputs: {}, margins: [], warnings: [], assumptions: [],
    };
  },
});

// Refuses on its own terms; the envelope must keep the solver's reason.
registerSolver({
  id: "test.sc05-refuser", version: "0.0.0", domain: "structural.bending", fidelity: 1,
  method: "test-only SC-05 probe: returns notComputed itself",
  targets: beamTargets,
  run() {
    return { notComputed: "needs a real section" };
  },
});

describe("SC-05: the input-integrity guard is armed on the IR path", () => {
  it("the shipped solver on the evidence design still computes, byte-identical to the unarmed figure", () => {
    const o = openDesign(beamIR());
    assert.equal(o.ok, true);
    const r = o.session.result("beam.fea@G1");
    assert.equal(r.status, "PASS");
    assert.ok(near(r.outputs.maxDeflection.value, 0.00450911598961386), String(r.outputs.maxDeflection.value));
  });

  it("an honest echo of the design's declared values passes", () => {
    const o = openDesign(beamIR());
    const r = o.session.result("test.sc05-honest@G1");
    assert.equal(r.status, "PASS");
    assert.equal(r.outputs.usedE.value, 200e9);
  });

  it("a substituted material value is NOT_COMPUTED, naming supplied vs used", () => {
    const o = openDesign(beamIR());
    const r = o.session.result("test.sc05-substitutor@G1");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.equal(r.reason, "input_substituted:E (supplied 200000000000, used 190000000000)");
  });

  it("a substituted geometry value is NOT_COMPUTED", () => {
    const o = openDesign(beamIR());
    const r = o.session.result("test.sc05-geom-substitutor@G1");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.equal(r.reason, "input_substituted:length (supplied 4, used 8)");
  });

  it("a substituted load value is NOT_COMPUTED", () => {
    const o = openDesign(beamIR());
    const r = o.session.result("test.sc05-load-substitutor@G1");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.equal(r.reason, "input_substituted:pointLoad.LC1 (supplied 60000, used 30000)");
  });

  it("a design edit re-arms the guard: the substituted echo is caught against the NEW declared value", () => {
    const o = openDesign(beamIR());
    const ed = o.session.edit([{ node: "G1", path: "geometry.length", value: 5 }]);
    assert.equal(ed.ok, true);
    const r = o.session.result("test.sc05-geom-substitutor@G1");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.equal(r.reason, "input_substituted:length (supplied 5, used 10)");
    const honest = o.session.result("test.sc05-honest@G1");
    assert.equal(honest.status, "PASS");
  });

  it("a solver's own notComputed keeps its own reason", () => {
    const o = openDesign(beamIR());
    const r = o.session.result("test.sc05-refuser@G1");
    assert.equal(r.status, "NOT_COMPUTED");
    assert.equal(r.reason, "needs a real section");
  });
});
