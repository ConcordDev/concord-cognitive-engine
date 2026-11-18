// server/tests/conkay-orc-system-report.test.js
//
// SX-ORC-12 — orc.system-report acceptance tests.
// Reference case (the catalogue's named case): every claim links to
// a receipt. The report is assembled from the REAL upstream solver
// outputs (this suite runs orc.system-architecture, orc.mass-bom,
// cad.bom-structure, orc.integration-checks and orc.research-gaps
// and feeds their outputs in — the assembled chain, not fixtures
// shaped by hand). Expected claim values are the upstream values
// the test states independently (a 0.1 m cube at 1000 kg/m^3 is
// 1 kg; the integration input closes its own power budget).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { systemReport } from "../lib/conkay/orc/system-report.js";
import { systemArchitecture } from "../lib/conkay/orc/system-architecture.js";
import { massBom } from "../lib/conkay/orc/mass-bom.js";
import { bomStructure } from "../lib/conkay/cad/bom-structure.js";
import { integrationChecks } from "../lib/conkay/orc/integration-checks.js";
import { researchGaps } from "../lib/conkay/orc/research-gaps.js";
import { getSolver, listSolvers } from "../lib/conkay/physics/registry.js";
import { openDesign, softenDesignIR } from "../lib/conkay/index.js";
import { assertCitationsDomain } from "./_conkay-honesty.mjs";

const CUBE = { shape: "box", dims: { length: 0.1, width: 0.1, height: 0.1 }, densityKgM3: 1000 };

function upstream() {
  return {
    system: { id: "rig-1", name: "Test rig" },
    architecture: systemArchitecture({ text: "a bipedal robot that weighs 20 kg, does 3 m/s" }).outputs,
    massBom: massBom({ parts: [{ id: "block", massProperties: CUBE, position: [0, 0, 0.05] }] }).outputs,
    bom: bomStructure({ items: [{ id: "block", qty: 1, massProperties: CUBE, unitCost: 12 }], currency: "USD" }).outputs,
    integration: integrationChecks({ power: { suppliedW: 100, consumedW: 90, lossesW: 10 } }).outputs,
    gaps: researchGaps({ needs: [{ property: "allowableStress", gapKind: "missing", forSolver: "struct.beam-bending" }] }).outputs,
  };
}

describe("SX-ORC-12 — reference case (every claim links to a receipt)", () => {
  it("assembles a COMPLETE report; every claim carries solver + evidence", () => {
    const r = systemReport(upstream());
    assert.ok(!r.notComputed, r.notComputed);
    assert.equal(r.outputs.completeness, "COMPLETE");
    assert.equal(r.outputs.unreceipted.length, 0);
    assert.ok(r.outputs.claimCount >= 15, `expected a full claim set, got ${r.outputs.claimCount}`);
    for (const c of r.outputs.claims) {
      assert.ok(c.receipt.solver && c.receipt.evidence, `claim ${c.key} lacks a receipt`);
    }
    const total = r.outputs.claims.find((c) => c.key === "mass.totalKg");
    assert.ok(Math.abs(total.value - 1) <= 1e-9, "the 1 kg cube, copied not recomputed");
    assert.equal(total.receipt.solver, "orc.mass-bom");
    assert.equal(r.outputs.inconsistencies.length, 0, "the two mass roll-ups agree (both 1 kg)");
  });

  it("a mass disagreement between the two roll-ups is NAMED, both values standing", () => {
    const up = upstream();
    up.bom = bomStructure({ items: [{ id: "block", qty: 2, massProperties: CUBE, unitCost: 12 }], currency: "USD" }).outputs;
    const r = systemReport(up);
    assert.equal(r.outputs.completeness, "PARTIAL");
    assert.equal(r.outputs.inconsistencies.length, 1);
    assert.match(r.outputs.inconsistencies[0].detail, /disagree/);
    assert.ok(Math.abs(r.outputs.inconsistencies[0].values.bomStructure - 2) <= 1e-9);
  });

  it("missing sections are named and stamp the report PARTIAL — never silently omitted", () => {
    const up = upstream();
    delete up.integration;
    delete up.gaps;
    const r = systemReport(up);
    assert.equal(r.outputs.completeness, "PARTIAL");
    assert.deepEqual(r.outputs.missingSections, ["integration", "gaps"]);
  });

  it("NOT_COMPUTED values ride as claims: an unpriced BOM total is a PARTIAL claim, not an absence", () => {
    const up = upstream();
    up.bom = bomStructure({ items: [{ id: "block", qty: 1, massProperties: CUBE }], currency: "USD" }).outputs;
    const r = systemReport(up);
    const cost = r.outputs.claims.find((c) => c.key === "bom.totalCost");
    assert.equal(cost.value, null);
    assert.equal(cost.status, "PARTIAL");
    assert.ok(cost.receipt, "even the null claim carries its receipt");
  });

  it("the version diff lists added / removed / changed claims by key", () => {
    const before = upstream();
    const after = upstream();
    after.bom = bomStructure({ items: [{ id: "block", qty: 1, massProperties: CUBE, unitCost: 15 }], currency: "USD" }).outputs;
    delete after.gaps;
    const r = systemReport({ ...after, previous: before });
    const changed = r.outputs.diff.find((d) => d.key === "bom.totalCost");
    assert.equal(changed.change, "changed");
    assert.equal(changed.before, 12);
    assert.equal(changed.after, 15);
    assert.ok(r.outputs.diff.some((d) => d.key === "gaps.queueCount" && d.change === "removed"));
  });
});

describe("SX-ORC-12 — adversarial legs", () => {
  it("malformed inputs are INVALID_INPUT / missing, named (SC-05)", () => {
    assert.match(systemReport({}).notComputed, /missing_input:system\.id/);
    assert.match(systemReport({ system: { id: "x" } }).notComputed, /missing_input:sections/);
    assert.match(systemReport({ system: { id: "x" }, massBom: { parts: [] } }).notComputed, /massBom section does not carry totalMassKg/);
    assert.match(systemReport({ system: { id: "x" }, bom: [] }).notComputed, /INVALID_INPUT: bom must be/);
  });

  it("citations leg (SC-05): no out-of-domain citations", () => {
    const r = systemReport(upstream());
    assertCitationsDomain(r, getSolver("orc.system-report"), "orc.system-report");
  });
});

describe("SX-ORC-12 — registry + IR reachability", () => {
  it("is registered at L1 with declarations and no engine dependency", () => {
    const s = listSolvers().find((x) => x.id === "orc.system-report");
    assert.ok(s, "orc.system-report not in the registry");
    assert.equal(s.fidelity, 1);
    assert.ok(s.regime && s.units && s.tolerance && s.screening === false);
    assert.deepEqual(getSolver("orc.system-report").engineDependent, []);
  });

  it("runs on the IR path against a props-carrying node", () => {
    const ir = softenDesignIR({
      design: { id: "orc12", name: "ORC12" },
      nodes: [
        { id: "A1", kind: "Assembly", name: "rig", props: { "orc.systemReport": upstream() } },
      ],
      edges: [],
    });
    const opened = openDesign(ir.ir);
    assert.equal(opened.ok, true, JSON.stringify(opened.errors));
    const env = opened.session.results().find((e) => e.runId === "orc.system-report@A1");
    assert.ok(env, "no orc.system-report envelope");
    assert.equal(env.outputs.completeness, "COMPLETE");
  });
});
