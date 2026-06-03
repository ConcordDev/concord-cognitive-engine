// tests/depth/audit-behavior.test.js — REAL behavioral tests (audit/GRC lens-actions).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("audit — risk math", () => {
  it("riskScore: returns a leveled risk with components", async () => {
    const r = await lensRun("audit", "riskScore", { data: { controls: [{ effectiveness: 0.8 }], inherentRisks: [{ score: 9 }] }, params: { priorRiskLevel: "high" } });
    assert.equal(r.ok, true);
    assert.ok(typeof r.result.riskLevel === "string");
    assert.ok(r.result.components && typeof r.result.components.controlRisk === "number");
  });
});

describe("audit — CRUD", () => {
  let ctx; before(async () => { ctx = await depthCtx("audit-crud"); });
  it("evidenceAdd: rejects evidence for a control that doesn't exist (referential integrity)", async () => {
    // real validation behavior — evidence must attach to an adopted control,
    // so a bogus controlId is refused rather than silently orphaned.
    const added = await lensRun("audit", "evidenceAdd", { params: { controlId: "NOPE-999", title: "orphan" } }, ctx);
    // lens.run dispatches ok; the handler's refusal is nested in result.
    assert.equal(added.result.ok, false);
    assert.match(String(added.result.error), /control not found/i);
  });
  it("evidenceList: returns the evidence ledger shape (empty until controls exist)", async () => {
    const list = await lensRun("audit", "evidenceList", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.equal(typeof list.result.total, "number");
    assert.ok(Array.isArray(list.result.evidence));
  });
  it("controlList: returns controls + a compliance-rate summary", async () => {
    const r = await lensRun("audit", "controlList", { params: {} }, ctx);
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.controls));
    assert.equal(typeof r.result.summary.complianceRate, "number");
    assert.equal(r.result.summary.total, r.result.controls.length);
  });
});
