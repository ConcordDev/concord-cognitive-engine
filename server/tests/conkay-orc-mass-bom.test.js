// server/tests/conkay-orc-mass-bom.test.js
//
// SX-ORC-07 — orc.mass-bom acceptance tests.
// Reference case (the catalogue's named case): assembly mass = the sum
// of the parts; a part with no resolvable material is massless WITH a
// reason — never assigned a stand-in density. Expected values are the
// closed forms per part (cube/cylinder via cad.mass-properties-brep's
// textbook forms), computed here independently.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { massBom } from "../lib/conkay/orc/mass-bom.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertNothingAssumed, assertCitationsDomain } from "./_conkay-honesty.mjs";

const rel = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const CUBE = { shape: "box", dims: { length: 1, width: 1, height: 1 }, densityKgM3: 6000 }; // 6000 kg
const ROD = { shape: "cylinder", dims: { radius: 0.1, height: 0.5 }, densityKgM3: 2700 }; // pi*.01*.5*2700
const ROD_MASS = Math.PI * 0.01 * 0.5 * 2700;

describe("SX-ORC-07 — reference case (assembly mass = sum of parts)", () => {
  it("totals, CG, and inertia roll up exactly", () => {
    const r = massBom({
      parts: [
        { id: "block", massProperties: CUBE, position: [0, 0, 0] },
        { id: "rod", massProperties: ROD, position: [2, 0, 0] },
      ],
    });
    assert.ok(!r.notComputed, r.notComputed);
    const total = 6000 + ROD_MASS;
    assert.ok(rel(r.outputs.totalMassKg, total));
    // CG x = (6000*0 + ROD*(2 + 0)) / total (rod centroid at its base centre + position)
    assert.ok(rel(r.outputs.cgM[0], (ROD_MASS * 2) / total));
    assert.ok(rel(r.outputs.cgM[2], (ROD_MASS * 0.25) / total));
    assert.ok(r.outputs.inertiaAboutCgKgM2.Iyy > 0);
    assert.equal(r.outputs.masslessParts.length, 0);
  });

  it("a part with an unresolvable material is massless WITH its reason — no stand-in density", () => {
    const r = massBom({
      parts: [
        { id: "block", massProperties: CUBE, position: [0, 0, 0] },
        { id: "ghost", massProperties: { shape: "sphere", dims: { radius: 1 }, material: "unobtanium" }, position: [1, 0, 0] },
      ],
    });
    assert.equal(r.outputs.totalMassKg, 6000);
    assert.equal(r.outputs.masslessParts.length, 1);
    assert.equal(r.outputs.masslessParts[0].id, "ghost");
    assert.match(r.outputs.masslessParts[0].reason, /unobtanium/);
    assert.ok(r.warnings.some((w) => /ghost/.test(w)));
  });

  it("budget verdicts: within, and over with contingency applied and named", () => {
    const within = massBom({ parts: [{ id: "block", massProperties: CUBE, position: [0, 0, 0] }], budgetKg: 7000 });
    assert.equal(within.outputs.budget.verdict, "within-budget");
    const over = massBom({
      parts: [{ id: "block", massProperties: CUBE, position: [0, 0, 0] }],
      budgetKg: 6100,
      contingencyFraction: 0.05,
    });
    assert.ok(rel(over.outputs.totalWithContingencyKg, 6300));
    assert.equal(over.outputs.budget.verdict, "over-budget");
    assert.ok(over.warnings.some((w) => /over budget/.test(w)));
  });

  it("a massive part without a position blocks the CG — nothing assumed at the origin", () => {
    const r = massBom({
      parts: [
        { id: "block", massProperties: CUBE, position: [0, 0, 0] },
        { id: "rod", massProperties: ROD },
      ],
    });
    assert.equal(r.outputs.cgM, null);
    assert.match(r.outputs.cgNotComputed, /rod/);
    assert.ok(rel(r.outputs.totalMassKg, 6000 + ROD_MASS), "the mass total still stands");
  });
});

describe("SX-ORC-07 — adversarial + honesty legs", () => {
  it("malformed inputs are INVALID_INPUT / missing, named (SC-05)", async () => {
    await assertNothingAssumed((p) => massBom(p), { parts: [{ id: "b", massProperties: CUBE, position: [0, 0, 0] }] }, ["parts"], "orc.mass-bom");
    assert.match(massBom({ parts: [{ massProperties: CUBE }] }).notComputed, /INVALID_INPUT: parts\[0\]\.id/);
    assert.match(massBom({ parts: [{ id: "b" }] }).notComputed, /missing_input:parts\[0\]\.massProperties/);
    assert.match(massBom({ parts: [{ id: "b", massProperties: CUBE, position: [0, 0] }] }).notComputed, /INVALID_INPUT: parts\[0\]\.position/);
    assert.match(massBom({ parts: [{ id: "b", massProperties: CUBE }], contingencyFraction: 1.5 }).notComputed, /INVALID_INPUT: contingencyFraction/);
    assert.match(massBom({ parts: [{ id: "b", massProperties: CUBE }], budgetKg: -1 }).notComputed, /INVALID_INPUT: budgetKg/);
  });

  it("citations leg: no out-of-domain citations (SC-05 helper)", () => {
    const s = getSolver("orc.mass-bom");
    assertCitationsDomain(massBom({ parts: [{ id: "b", massProperties: CUBE, position: [0, 0, 0] }] }), s, "orc.mass-bom");
  });
});

describe("SX-ORC-07 — registry + IR reachability", () => {
  it("is registered at L2 with declarations", () => {
    const s = listSolvers().find((x) => x.id === "orc.mass-bom");
    assert.ok(s, "orc.mass-bom not in the registry");
    assert.equal(s.fidelity, 2);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "orc7", name: "ORC7" },
      nodes: [
        { id: "A1", kind: "Part", name: "assembly", props: { "orc.mass-bom": { parts: [{ id: "block", massProperties: CUBE, position: [0, 0, 0] }], budgetKg: 7000 } } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.mass-bom@A1");
    assert.ok(env, "no orc.mass-bom envelope");
    assert.equal(env.outputs.totalMassKg, 6000);
    assert.equal(env.outputs.budget.verdict, "within-budget");
  });
});
