// tests/depth/manufacturing-workorder-behavior.test.js — REAL behavioral tests for the
// manufacturing work-order / quality / downtime lens-actions (lens-audit Batch B: the
// advanceStep / defectAnalysis / generateTraveler / logDowntime buttons hit no macro
// and fell to the AI catch-all until these deterministic macros landed).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

describe("manufacturing.advanceStep", () => {
  it("advances to the next step and computes progress", async () => {
    const r = await lensRun("manufacturing", "advanceStep", {
      data: { steps: [{ name: "Cut" }, { name: "Weld" }, { name: "Paint" }], currentStep: 1 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.currentStep, 2);
    assert.equal(r.result.totalSteps, 3);
    assert.equal(r.result.status, "in_progress");
    assert.equal(r.result.percentComplete, 67);
    assert.equal(r.result.currentStepName, "Weld");
  });
  it("reports complete on the last step and no_steps_defined when empty", async () => {
    const done = await lensRun("manufacturing", "advanceStep", { data: { steps: [{ name: "A" }], currentStep: 0 } });
    assert.equal(done.result.status, "complete");
    const none = await lensRun("manufacturing", "advanceStep", { data: { steps: [] } });
    assert.equal(none.result.status, "no_steps_defined");
  });
});

describe("manufacturing.defectAnalysis", () => {
  it("classifies defects by type and severity and rates risk", async () => {
    const r = await lensRun("manufacturing", "defectAnalysis", {
      data: { defects: [{ type: "scratch", severity: "minor" }, { type: "crack", severity: "critical" }], inspected: 50 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.defectCount, 2);
    assert.equal(r.result.defectRatePct, 4);          // 2/50
    assert.equal(r.result.bySeverity.critical, 1);
    assert.equal(r.result.riskLevel, "high");          // a critical defect present
    assert.equal(r.result.byType.crack, 1);
  });
});

describe("manufacturing.generateTraveler", () => {
  it("formats a routing traveler with one line per step", async () => {
    const r = await lensRun("manufacturing", "generateTraveler", {
      data: { partNumber: "PN-100", quantity: 5, steps: [{ name: "Mill" }, { name: "Inspect" }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.partNumber, "PN-100");
    assert.equal(r.result.stepCount, 2);
    assert.match(r.result.content, /ROUTING TRAVELER/);
    assert.match(r.result.content, /Mill/);
    assert.match(r.result.content, /Inspect/);
  });
});

describe("manufacturing.logDowntime", () => {
  it("logs downtime and computes availability impact + category", async () => {
    const r = await lensRun("manufacturing", "logDowntime", {
      params: { reason: "maintenance", durationMinutes: 48 },
      data: { machine: "CNC-1", plannedTime: 480 },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.durationMinutes, 48);
    assert.equal(r.result.availabilityImpactPct, 10); // 48/480
    assert.equal(r.result.category, "maintenance");
    assert.ok(String(r.result.downtimeId).startsWith("DT-"));
  });
});
