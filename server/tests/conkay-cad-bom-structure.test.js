// server/tests/conkay-cad-bom-structure.test.js
//
// SX-CAD-08 — cad.bom-structure acceptance tests.
// Reference case (the catalogue's named case): BOM mass = Σ part
// masses through the tree; unpriced stays null. Expected masses are
// computed by hand: a 0.1 m cube at density 1000 kg/m^3 is exactly
// 1 kg; a 0.2 x 0.1 x 0.05 m box at the same density is exactly
// 1 kg. The tree below therefore totals exactly 6 kg.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bomStructure } from "../lib/conkay/cad/bom-structure.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const close = (a, b) => Math.abs(a - b) <= 1e-9;
const MP_A = { shape: "box", dims: { length: 0.1, width: 0.1, height: 0.1 }, densityKgM3: 1000 }; // 1 kg
const MP_B = { shape: "box", dims: { length: 0.2, width: 0.1, height: 0.05 }, densityKgM3: 1000 }; // 1 kg

const TREE = [
  {
    id: "base", qty: 1,
    children: [
      { id: "A", qty: 2, massProperties: MP_A },
      { id: "B", qty: 1, massProperties: MP_B },
    ],
  },
  { id: "A", qty: 3, massProperties: MP_A, unitCost: 5 },
];

describe("SX-CAD-08 — reference case (BOM mass = Σ part masses; unpriced stays null)", () => {
  it("rolls mass up through the tree to exactly 6 kg", () => {
    const r = bomStructure({ items: TREE, currency: "USD" });
    assert.ok(!r.notComputed, r.notComputed);
    assert.ok(close(r.outputs.totalMassKg, 6), `total ${r.outputs.totalMassKg}`);
    const base = r.outputs.lines.find((l) => l.item === "1");
    assert.ok(close(base.unitMassKg, 3), "base unit = 2xA + 1xB = 3 kg");
    assert.ok(close(base.extendedMassKg, 3));
    const topA = r.outputs.lines.find((l) => l.item === "2");
    assert.ok(close(topA.extendedMassKg, 3));
    assert.deepEqual(r.outputs.lines.map((l) => l.item), ["1", "1.1", "1.2", "2"]);
  });

  it("unpriced stays null: the total is null, the priced subtotal is labelled partial", () => {
    const r = bomStructure({ items: TREE, currency: "USD" });
    assert.equal(r.outputs.totalCost, null);
    assert.equal(r.outputs.pricedSubtotal, 15, "only the priced top line: 3 x 5");
    assert.deepEqual(r.outputs.unpricedLines.map((l) => l.item), ["1.1", "1.2", "1"], "named in discovery order — root-cause leaves before the assembly they leave unpriced");
    assert.ok(r.warnings.some((w) => /unpriced stays null/.test(w)));
  });

  it("a fully priced tree totals exactly, and a purchased assembly does not double-count its children", () => {
    const priced = [
      {
        id: "kit", qty: 2, unitCost: 40,
        children: [{ id: "A", qty: 1, massProperties: MP_A, unitCost: 5 }],
      },
      { id: "B", qty: 1, massProperties: MP_B, unitCost: 7 },
    ];
    const r = bomStructure({ items: priced });
    assert.equal(r.outputs.totalCost, 87, "2 x 40 (purchased kit; child cost NOT rolled in) + 1 x 7");
    assert.ok(close(r.outputs.totalMassKg, 3), "mass still rolls through the purchased kit: 2 x 1 + 1");
    const kit = r.outputs.lines.find((l) => l.item === "1");
    assert.equal(kit.unitCost, 40);
  });

  it("an unpriced assembly over fully priced children rolls its cost up per parent unit", () => {
    const r = bomStructure({
      items: [{ id: "asm", qty: 2, children: [{ id: "A", qty: 3, massProperties: MP_A, unitCost: 5 }] }],
    });
    const asm = r.outputs.lines.find((l) => l.item === "1");
    assert.equal(asm.unitCost, 15, "one assembly unit costs 3 x 5");
    assert.equal(asm.extendedCost, 30);
    assert.equal(r.outputs.totalCost, 30);
  });

  it("an unmassed leaf nulls its ancestors and the total — with the reason carried, never zeroed", () => {
    const r = bomStructure({
      items: [{ id: "asm", qty: 1, children: [{ id: "mystery", qty: 1, massProperties: { shape: "box", dims: { length: 0.1, width: 0.1, height: 0.1 }, material: "unobtanium" } }] }],
    });
    assert.equal(r.outputs.totalMassKg, null);
    assert.equal(r.outputs.massedSubtotalKg, 0);
    assert.equal(r.outputs.unmassedLines.length, 2, "the leaf and its ancestor are both named");
    assert.match(r.outputs.unmassedLines[0].reason, /unobtanium/);
  });
});

describe("SX-CAD-08 — adversarial legs", () => {
  it("malformed inputs are INVALID_INPUT / missing, named (SC-05)", async () => {
    await assertNothingAssumed((p) => bomStructure(p), { items: TREE }, ["items"], "cad.bom-structure");
    assert.match(bomStructure({ items: [{ id: "A", massProperties: MP_A }] }).notComputed, /missing_input:items qty for "A"/);
    assert.match(bomStructure({ items: [{ id: "A", qty: 0, massProperties: MP_A }] }).notComputed, /qty for "A" .* must be a positive finite/);
    assert.match(bomStructure({ items: [{ id: "A", qty: 1, massProperties: MP_A, unitCost: -1 }] }).notComputed, /unitCost for "A"/);
    assert.match(bomStructure({ items: [{ id: "A", qty: 1, massProperties: MP_A }, { id: "A", qty: 1, massProperties: MP_A }] }).notComputed, /duplicate sibling id "A"/);
    assert.match(
      bomStructure({ items: [{ id: "x", qty: 1, massProperties: MP_A, children: [{ id: "A", qty: 1, massProperties: MP_A }] }] }).notComputed,
      /both children and massProperties/,
    );
    assert.match(bomStructure({ items: [{ id: "leaf", qty: 1 }] }).notComputed, /missing_input:massProperties for leaf "leaf"/);
  });

  it("the same part id under DIFFERENT parents is legitimate — each occurrence counts", () => {
    const r = bomStructure({
      items: [
        { id: "p1", qty: 1, children: [{ id: "A", qty: 1, massProperties: MP_A }] },
        { id: "p2", qty: 1, children: [{ id: "A", qty: 1, massProperties: MP_A }] },
      ],
    });
    assert.ok(!r.notComputed, r.notComputed);
    assert.ok(close(r.outputs.totalMassKg, 2));
  });

  it("echo + citations legs (SC-05): structured inputs echoed exactly; no out-of-domain citations", () => {
    const r = bomStructure({ items: TREE, currency: "USD" });
    assert.deepEqual(r.inputs, { items: TREE, currency: "USD" }, "inputs echoed exactly as submitted");
    assertCitationsDomain(r, getSolver("cad.bom-structure"), "cad.bom-structure");
  });
});

describe("SX-CAD-08 — registry + IR reachability", () => {
  it("is registered at L2 with declarations and NO engine dependency (engine: JS)", () => {
    const s = listSolvers().find((x) => x.id === "cad.bom-structure");
    assert.ok(s, "cad.bom-structure not in the registry");
    assert.equal(s.fidelity, 2);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
    assert.deepEqual(getSolver("cad.bom-structure").engineDependent, []);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "cad8", name: "CAD8" },
      nodes: [
        { id: "A1", kind: "Assembly", name: "cart", props: { "cad.bomStructure": { items: TREE, currency: "USD" } } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "cad.bom-structure@A1");
    assert.ok(env, "no cad.bom-structure envelope");
    assert.ok(close(env.outputs.totalMassKg, 6));
  });
});
