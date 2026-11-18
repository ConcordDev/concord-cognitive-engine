// server/tests/conkay-orc-chain-run.test.js
//
// SXC-26 — orc.chain-run acceptance tests.
// Golden end-to-end case (the catalogue's named case): the robot
// brief runs every link of the system chain and the run signs ONE
// chain receipt (SX-CHAIN-RECEIPT) hashing every link. Expected
// values are stated independently: two 0.1 m cubes at 1000 kg/m^3
// total exactly 2 kg, inside the brief's 20 kg bound; the BOM
// tree over the same cubes totals the same 2 kg, so every seam
// holds. The failure legs are the receipt's edges: a seam
// violation with every link green, and a stop at the first
// NOT_COMPUTED link naming step + reason.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chainRun } from "../lib/conkay/orc/chain-run.js";
import { verifyChainReceipt, linkReceipt } from "../lib/conkay/chain/receipt.js";
import { massPropertiesBrep } from "../lib/conkay/cad/mass-properties-brep.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertCitationsDomain } from "./_conkay-honesty.mjs";

const CUBE = { shape: "box", dims: { length: 0.1, width: 0.1, height: 0.1 }, densityKgM3: 1000 };
const GOLDEN = {
  text: "a bipedal robot that weighs 20 kg, does 3 m/s",
  system: { id: "chain-rig", name: "Chain rig" },
  parts: [
    { id: "block-a", massProperties: CUBE, position: [0, 0, 0.05] },
    { id: "block-b", massProperties: CUBE, position: [0.2, 0, 0.05] },
  ],
  bomItems: [
    { id: "assembly", qty: 1, children: [
      { id: "block-a", qty: 1, massProperties: CUBE, unitCost: 10 },
      { id: "block-b", qty: 1, massProperties: CUBE, unitCost: 10 },
    ] },
  ],
  currency: "USD",
  integration: { power: { suppliedW: 100, consumedW: 90, lossesW: 10 } },
  needs: [{ property: "allowableStress", gapKind: "missing", forSolver: "struct.beam-bending" }],
};

describe("SXC-26 — golden end-to-end (every link runs; ONE receipt, SIGNED)", () => {
  it("runs the full chain and signs, with every seam holding", () => {
    const r = chainRun(GOLDEN);
    assert.ok(!r.notComputed, r.notComputed);
    const receipt = r.outputs.chainReceipt;
    assert.equal(receipt.status, "SIGNED");
    assert.deepEqual(r.outputs.stepsRun, ["intent", "requirements", "architecture", "parts-cad", "mass-bom", "bom", "integration", "gaps", "report"]);
    assert.ok(receipt.seams.every((s) => s.status === "HOLDS" || s.status === "NOT_APPLICABLE"));
    const budget = receipt.seams.find((s) => s.id === "mass-budget");
    assert.equal(budget.status, "HOLDS");
    assert.ok(Math.abs(budget.toValue - 2) <= 1e-9, "two 1 kg cubes");
    assert.equal(budget.fromValue, 20, "the brief's mass bound, mapped through the requirements link");
    // The fallback hole is IN the artifact, named — not hidden.
    const fb = receipt.skipped.find((s) => s.step === "fallback");
    assert.ok(fb && /F10/.test(fb.reason));
    assert.equal(r.outputs.report.completeness, "COMPLETE");
  });

  it("the receipt verifies against a recomputation of its links", () => {
    const r = chainRun(GOLDEN);
    const receipt = r.outputs.chainReceipt;
    // Recompute the parts-cad link from its producing solver and verify.
    const cadParts = GOLDEN.parts.map((p) => { const mp = massPropertiesBrep(p.massProperties); return { id: p.id, massKg: mp.outputs.massKg, volumeM3: mp.outputs.volumeM3, material: mp.outputs.material ?? null }; });
    const cad = linkReceipt({ step: "parts-cad", solver: "cad.mass-properties-brep", inputs: { parts: GOLDEN.parts }, outputs: { parts: cadParts, totalMassKg: cadParts.reduce((s, r) => s + r.massKg, 0) } });
    const v = verifyChainReceipt(receipt, [cad]);
    assert.ok(v.reasons.some((x) => /was not recomputed/.test(x)), "verification names the links it could not recompute");
    assert.ok(!v.reasons.some((x) => /parts-cad .* different hash/.test(x)), "the recomputed parts-cad link matches its receipt hash");
  });
});

describe("SXC-26 — the receipt's edges", () => {
  it("SEAM VIOLATION with every link green: the BOM counts a cube twice the mass roll-up never saw", () => {
    const bad = structuredClone(GOLDEN);
    bad.bomItems[0].children[0].qty = 2;
    const r = chainRun(bad);
    assert.equal(r.outputs.chainReceipt.status, "SEAM_VIOLATION");
    assert.equal(r.outputs.stoppedAt, null, "no link stopped — the chain failed at a seam, exactly the founder-rule case");
    const seam = r.outputs.chainReceipt.seams.find((s) => s.id === "mass-total-agreement");
    assert.equal(seam.status, "VIOLATED");
  });

  it("stops at the first NOT_COMPUTED link, naming step + reason; later links never run", () => {
    const bad = structuredClone(GOLDEN);
    bad.parts[0].massProperties = { shape: "box", dims: { length: 0.1, width: 0.1, height: 0.1 }, material: "unobtanium" };
    const r = chainRun(bad);
    const receipt = r.outputs.chainReceipt;
    assert.equal(receipt.status, "INCOMPLETE");
    assert.equal(r.outputs.stoppedAt.step, "parts-cad");
    assert.match(r.outputs.stoppedAt.reason, /unobtanium/);
    assert.ok(!r.outputs.stepsRun.includes("report"), "the report link never ran");
    assert.equal(r.outputs.report, null);
  });

  it("an over-budget design computes every link and still must not sign (mass-budget seam)", () => {
    const heavy = structuredClone(GOLDEN);
    heavy.text = "a bipedal robot that weighs 1 kg, does 3 m/s";
    const r = chainRun(heavy);
    assert.equal(r.outputs.chainReceipt.status, "SEAM_VIOLATION");
    assert.equal(r.outputs.chainReceipt.seams.find((s) => s.id === "mass-budget").status, "VIOLATED");
  });

  it("malformed chain inputs are NOT_COMPUTED, named (SC-05)", () => {
    assert.match(chainRun({}).notComputed, /missing_input:text/);
    assert.match(chainRun({ text: "x" }).notComputed, /missing_input:system\.id/);
    assert.match(chainRun({ text: "x", system: { id: "s" } }).notComputed, /missing_input:parts/);
    assert.match(chainRun({ text: "x", system: { id: "s" }, parts: [{}], bomItems: [{}] }).notComputed, /missing_input:integration/);
  });

  it("citations leg (SC-05): no out-of-domain citations", () => {
    const r = chainRun(GOLDEN);
    assertCitationsDomain(r, getSolver("orc.chain-run"), "orc.chain-run");
  });
});

describe("SXC-26 — registry + IR reachability (ConKay chat / MCP path)", () => {
  it("is registered with declarations and no engine dependency of its own", () => {
    const s = listSolvers().find((x) => x.id === "orc.chain-run");
    assert.ok(s, "orc.chain-run not in the registry");
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
    assert.deepEqual(getSolver("orc.chain-run").engineDependent, []);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "sxc26", name: "SXC26" },
      nodes: [
        { id: "A1", kind: "Assembly", name: "chain", props: { "orc.chainRun": GOLDEN } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.chain-run@A1");
    assert.ok(env, "no orc.chain-run envelope");
    assert.equal(env.outputs.chainReceipt.status, "SIGNED");
  });
});
