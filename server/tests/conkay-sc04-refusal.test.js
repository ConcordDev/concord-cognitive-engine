// SC-04: the refusal leg. A bare number on a dimensional input — in any of
// parseQuantity's three bare forms — is REFUSED at the solve.direct
// boundary, naming the field. Unit-carrying values convert exactly. The
// design-IR/chat authoring path keeps its deliberate bare-SI coercion:
// parseQuantity is untouched and the contrast is pinned by the last test.
//
// Run: node --test tests/conkay-sc04-refusal.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { solveDirect, validateDirectInputs } from "../lib/conkay/solve-direct.js";
import { openDesign } from "../lib/conkay/index.js";
import { conkaySolveMcp } from "../lib/mcp-execution-bridge.js";

const ACTOR = { id: "u-sc04", userId: "u-sc04", role: "member", scopes: [] };

const GEOMETRY = { shape: "i-beam", length: "4 m", height: "300 mm", flangeWidth: "150 mm", flangeThickness: "12 mm", webThickness: "8 mm" };
const beamSpec = (over = {}) => ({
  node: { kind: "Beam", material: "steel-a992", props: { support: "simply-supported" }, geometry: { ...GEOMETRY, ...(over.geometry || {}) }, ...(over.node || {}) },
  loadCases: [{ id: "LC1", loads: [{ pointLoad: "60 kN", ...(over.load || {}) }] }],
});

describe("SC-04: bare dimensional inputs are refused at the direct boundary", () => {
  it("bare number: length: 4 (the catalogue case, silently metres pre-fix)", async () => {
    const r = await solveDirect("beam.fea", beamSpec({ geometry: { length: 4 } }));
    assert.equal(r.ok, false, JSON.stringify(r));
    assert.equal(r.reason, "invalid_input");
    assert.equal(r.field, "node.geometry.length");
    assert.match(r.error, /bare number on a dimensional input/);
    assert.match(r.error, /length/);
  });

  it("unit-less string: length: \"4\"", async () => {
    const r = await solveDirect("beam.fea", beamSpec({ geometry: { length: "4" } }));
    assert.equal(r.ok, false);
    assert.equal(r.field, "node.geometry.length");
  });

  it("unit-less object: length: { value: 4 }", async () => {
    const r = await solveDirect("beam.fea", beamSpec({ geometry: { length: { value: 4 } } }));
    assert.equal(r.ok, false);
    assert.equal(r.field, "node.geometry.length");
  });

  it("bare load: pointLoad: 60000", async () => {
    const r = await solveDirect("beam.fea", beamSpec({ load: { pointLoad: 60000 } }));
    assert.equal(r.ok, false);
    assert.equal(r.field, "loadCases.LC1.loads.pointLoad");
    assert.match(r.error, /bare number on a dimensional input/);
  });

  it("bare typed prop: mass: 2 on a Part", () => {
    const v = validateDirectInputs({ node: { kind: "Part", material: "steel-a992", props: { mass: 2 } } });
    assert.equal(v.ok, false);
    assert.equal(v.field, "node.props.mass");
  });

  it("bare position axis: position.x: 1", () => {
    const v = validateDirectInputs({ node: { kind: "Part", material: "steel-a992", position: { x: 1, y: "0 m", z: "0 m" } } });
    assert.equal(v.ok, false);
    assert.equal(v.field, "node.position.x");
  });

  it("the bridge refuses a bare dimensional input the same way", async () => {
    const r = await conkaySolveMcp(null, { solver_id: "beam.fea", inputs: beamSpec({ geometry: { length: 4 } }) }, null, { actor: ACTOR });
    assert.equal(r.ok, false, JSON.stringify(r).slice(0, 300));
    assert.equal(r.reason, "invalid_input");
    assert.equal(r.field, "node.geometry.length");
  });

  it("a missing node is refused, not crashed", async () => {
    const r = await solveDirect("beam.fea", {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_input");
  });
});

describe("SC-04: declared units convert exactly; dimensionless values pass", () => {
  it("\"4000 mm\" and the exact foot value reproduce \"4 m\" bit-for-bit", async () => {
    const base = await solveDirect("beam.fea", beamSpec());
    const mm = await solveDirect("beam.fea", beamSpec({ geometry: { length: "4000 mm" } }));
    const ft = await solveDirect("beam.fea", beamSpec({ geometry: { length: "13.123359580052493 ft" } }));
    assert.equal(base.status, "PASS");
    assert.equal(mm.status, "PASS", JSON.stringify(mm).slice(0, 300));
    assert.equal(ft.status, "PASS", JSON.stringify(ft).slice(0, 300));
    assert.equal(mm.results[0].outputs.maxDeflection.value, base.results[0].outputs.maxDeflection.value);
    assert.equal(ft.results[0].outputs.maxDeflection.value, base.results[0].outputs.maxDeflection.value);
  });

  it("object form with a unit: length: { value: 4000, unit: \"mm\" }", async () => {
    const r = await solveDirect("beam.fea", beamSpec({ geometry: { length: { value: 4000, unit: "mm" } } }));
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    assert.equal(r.status, "PASS");
  });

  it("dimensionless props and strings pass bare", async () => {
    const spec = beamSpec();
    spec.node.props = { support: "simply-supported", bays: 3, ratio: 0.5 };
    const v = validateDirectInputs(spec);
    assert.equal(v.ok, true, JSON.stringify(v));
    const r = await solveDirect("beam.fea", spec);
    assert.equal(r.status, "PASS", JSON.stringify(r).slice(0, 300));
  });

  it("a wrong-dimension unit still errors honestly (not a refusal, a bad input)", async () => {
    const r = await solveDirect("beam.fea", beamSpec({ geometry: { length: "4 kg" } }));
    assert.equal(r.ok, false);
    assert.equal(r.field, "node.geometry.length");
    assert.match(r.error, /expected a length/);
  });
});

describe("SC-04: the design-authoring path is untouched by design", () => {
  it("openDesign still coerces a bare IR length (chat/IR convention intact)", async () => {
    const ir = {
      design: { id: "frame" },
      nodes: [{ id: "G1", kind: "Beam", material: "steel-a992", props: { support: "simply-supported" }, geometry: { ...GEOMETRY, length: 4 } }],
      loadCases: [{ id: "LC1", loads: [{ target: "G1", pointLoad: "60 kN" }] }],
    };
    const opened = openDesign(ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors || []));
    await opened.session.settle();
    const env = opened.session.results().find((e) => e.solver?.id === "beam.fea");
    assert.equal(env.status, "PASS");
    // The same bare value the direct boundary refuses, solved here: the
    // refusal is a property of the entry, not of the number.
    const direct = await solveDirect("beam.fea", beamSpec({ geometry: { length: 4 } }));
    assert.equal(direct.ok, false);
  });
});
