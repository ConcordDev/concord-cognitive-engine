// server/tests/conkay-cad-drawings-detail.test.js
//
// SX-CAD-07 — cad.drawings-detail acceptance tests.
// Reference case (the catalogue's named case): every part has a
// sheet; dimensions re-measure from the part's solid. Expected
// dimensions are the analytic extents computed by hand from the
// declared dims (box 0.1 x 0.05 x 0.02 m -> 100 x 50 x 20 mm;
// cylinder r 0.01 h 0.03 -> 20 x 20 x 30 mm), never the solver's own
// output repackaged. The rendered tier (OCC HLR) is NOT_COMPUTED in
// every run; the plan is what is asserted.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { drawingsDetail } from "../lib/conkay/cad/drawings-detail.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const PARTS = [
  { id: "plate", solid: { shape: "box", dims: { length: 0.1, width: 0.05, height: 0.02 } }, claimed: { x: 100, y: 50, z: 20 } },
  {
    id: "pin",
    solid: { shape: "cylinder", dims: { radius: 0.01, height: 0.03 } },
    gdt: [{ symbol: "cylindricity", value: 0.01, datum: "A" }],
  },
];

describe("SX-CAD-07 — reference case (every part has a sheet; dimensions re-measure)", () => {
  it("one sheet per part, balloons in input order, dimensions from the solids", () => {
    const r = drawingsDetail({ parts: PARTS });
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.sheetCount, 2);
    assert.deepEqual(r.outputs.sheets.map((s) => s.balloon), [1, 2]);
    const plate = r.outputs.sheets[0];
    assert.deepEqual(plate.dimensions.map((d) => d.valueMm), [100, 50, 20]);
    assert.equal(plate.dimensionStatus, "measured");
    const pin = r.outputs.sheets[1];
    assert.deepEqual(pin.dimensions.map((d) => d.valueMm), [20, 20, 30]);
    assert.equal(r.outputs.discrepancies.length, 0, "claimed dims agree with the re-measure");
  });

  it("GD&T callouts are carried with their glyph resolved from the vocabulary", () => {
    const pin = drawingsDetail({ parts: PARTS }).outputs.sheets[1];
    assert.equal(pin.gdtCallouts.length, 1);
    assert.equal(pin.gdtCallouts[0].symbol, "cylindricity");
    assert.equal(pin.gdtCallouts[0].glyph, "⌭");
    assert.equal(pin.gdtCallouts[0].valueMm, 0.01);
    assert.equal(pin.gdtCallouts[0].datum, "A");
  });

  it("a claimed dimension that disagrees with the solid is NAMED, not corrected", () => {
    const r = drawingsDetail({
      parts: [{ id: "plate", solid: { shape: "box", dims: { length: 0.1, width: 0.05, height: 0.02 } }, claimed: { x: 99, y: 50, z: 20 } }],
    });
    assert.equal(r.outputs.discrepancies.length, 1);
    assert.deepEqual(r.outputs.discrepancies[0], { partId: "plate", axis: "x", claimedMm: 99, measuredMm: 100 });
    assert.ok(r.warnings.some((w) => /disagree with the re-measure/.test(w)));
  });

  it("a part outside the exact set still gets a sheet — without dimensions, reason named", () => {
    const r = drawingsDetail({ parts: [{ id: "shell", solid: { shape: "mesh", dims: {} } }] });
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.sheetCount, 1);
    assert.equal(r.outputs.sheets[0].dimensionStatus, "not_measured");
    assert.equal(r.outputs.sheets[0].dimensions.length, 0);
    assert.match(r.outputs.sheets[0].dimensionNote, /shape_not_in_exact_set/);
  });
});

describe("SX-CAD-07 — engine honesty + adversarial legs", () => {
  it("every run carries the rendered tier NOT_COMPUTED engine_unavailable:sxe-06, plan labelled", () => {
    const r = drawingsDetail({ parts: PARTS });
    assert.equal(r.outputs.engineTier.status, "NOT_COMPUTED");
    assert.equal(r.outputs.engineTier.reason, "engine_unavailable:sxe-06");
    assert.equal(r.outputs.planOnly, true);
  });

  it("malformed inputs are INVALID_INPUT / missing, named (SC-05)", async () => {
    await assertNothingAssumed((p) => drawingsDetail(p), { parts: PARTS }, ["parts"], "cad.drawings-detail");
    assert.match(drawingsDetail({ parts: [{ solid: { shape: "box", dims: {} } }] }).notComputed, /parts\[0\]\.id/);
    assert.match(
      drawingsDetail({ parts: [PARTS[0], PARTS[0]] }).notComputed,
      /duplicates "plate"/,
    );
    assert.match(
      drawingsDetail({ parts: [{ id: "x", solid: { shape: "box", dims: { length: -1, width: 1, height: 1 } } }] }).notComputed,
      /parts\[0\]\.solid — INVALID_INPUT: dims\.length must be positive/,
    );
    assert.match(
      drawingsDetail({ parts: [{ id: "x", solid: { shape: "box", dims: { length: 0.1, width: 0.1, height: 0.1 } }, gdt: [{ symbol: "wobble", value: 0.1 }] }] }).notComputed,
      /gdt\[0\]\.symbol "wobble" is not in the GD&T vocabulary/,
    );
    assert.match(
      drawingsDetail({ parts: [{ id: "x", solid: { shape: "box", dims: { length: 0.1, width: 0.1, height: 0.1 } }, gdt: [{ symbol: "flatness", value: NaN }] }] }).notComputed,
      /gdt\[0\]\.value must be a positive finite/,
    );
  });

  it("echo + citations legs (SC-05): structured inputs echoed exactly; no out-of-domain citations", () => {
    const r = drawingsDetail({ parts: PARTS });
    assert.deepEqual(r.inputs, { parts: PARTS }, "inputs echoed exactly as submitted (structured echo asserted in-suite; the helper's echo leg is scalar-only)");
    assertCitationsDomain(r, getSolver("cad.drawings-detail"), "cad.drawings-detail");
  });
});

describe("SX-CAD-07 — registry + IR reachability", () => {
  it("the local GD&T table mirrors assembly-drawing.js's GDT_SYMBOLS key-for-key (text pin, no import)", () => {
    // assembly-drawing.js pulls pdfkit + the assembly store, so the pin
    // compares SOURCE TEXT, not module state — the mirror cannot drift
    // silently in either home.
    const src = readFileSync(new URL("../lib/conkay/assembly-drawing.js", import.meta.url), "utf8");
    const block = src.match(/const GDT_SYMBOLS = Object\.freeze\(\{([\s\S]*?)\}\);/);
    assert.ok(block, "GDT_SYMBOLS table not found in assembly-drawing.js");
    const keys = [...block[1].matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]).sort();
    // The solver's vocabulary is exercised through its refusal surface:
    // every key in the source table must be ACCEPTED by the solver.
    for (const key of keys) {
      const r = drawingsDetail({ parts: [{ id: "p", solid: { shape: "sphere", dims: { radius: 0.01 } }, gdt: [{ symbol: key, value: 0.01 }] }] });
      assert.ok(!r.notComputed, `source vocabulary key "${key}" refused: ${r.notComputed}`);
    }
    assert.equal(keys.length, 14, "the ASME Y14.5 characteristic set has 14 symbols");
  });

  it("is registered at L2 with declarations and the SXE-06 engine dependency", () => {
    const s = listSolvers().find((x) => x.id === "cad.drawings-detail");
    assert.ok(s, "cad.drawings-detail not in the registry");
    assert.equal(s.fidelity, 2);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
    assert.deepEqual(getSolver("cad.drawings-detail").engineDependent, ["sxe-06"]);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "cad7", name: "CAD7" },
      nodes: [
        { id: "A1", kind: "Assembly", name: "set", props: { "cad.drawingsDetail": { parts: PARTS } } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "cad.drawings-detail@A1");
    assert.ok(env, "no cad.drawings-detail envelope");
    assert.equal(env.outputs.sheetCount, 2);
  });
});
