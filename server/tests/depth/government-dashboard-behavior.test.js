// tests/depth/government-dashboard-behavior.test.js — REAL behavioral tests for the
// government civic-dashboard action macros (lens-audit Batch E: 12 dashboard buttons hit
// no macro and fell to the AI catch-all until these deterministic macros landed).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

describe("government.budget_report", () => {
  it("computes utilization from line items", async () => {
    const r = await lensRun("government", "budget_report", {
      data: { budget: 100000, lineItems: [{ category: "roads", amount: 40000, spent: 30000 }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalBudget, 100000);
    assert.equal(r.result.spent, 30000);
    assert.equal(r.result.remaining, 70000);
    assert.equal(r.result.utilizationPct, 30);
  });
});

describe("government.compliance_check", () => {
  it("scores compliance and lists violations", async () => {
    const r = await lensRun("government", "compliance_check", {
      data: { requirements: [{ name: "fire", met: true }, { name: "ada", met: false }] },
    });
    assert.equal(r.result.compliancePct, 50);
    assert.equal(r.result.compliant, false);
    assert.deepEqual(r.result.violations, ["ada"]);
    assert.equal(r.result.verdict, "non_compliant");
  });
});

describe("government.fine_calculation", () => {
  it("adds late fee to base × violations", async () => {
    const r = await lensRun("government", "fine_calculation", {
      data: { baseFine: 150, daysPastDue: 10, violationCount: 2, lateFeeRate: 0.02 },
    });
    assert.equal(r.result.baseFine, 150);
    assert.equal(r.result.lateFee, 30);    // 150 * 0.02 * 10
    assert.equal(r.result.total, 330);     // 150*2 + 30
  });
});

describe("government.permit_fee_estimate", () => {
  it("estimates a building permit fee from valuation", async () => {
    const r = await lensRun("government", "permit_fee_estimate", { data: { permitType: "building", valuation: 200000 } });
    assert.equal(r.result.baseFee, 250);
    assert.equal(r.result.valuationFee, 1000);  // 0.5% of 200k
    assert.ok(r.result.totalEstimate > 1250);
  });
});

describe("government.redaction_review", () => {
  it("flags inline PII (SSN, email) and sensitive field keys", async () => {
    const r = await lensRun("government", "redaction_review", {
      data: { content: "SSN 123-45-6789 contact a@b.com", ssn: "x" },
    });
    assert.ok(r.result.inlinePiiMatches >= 2);
    assert.ok(r.result.sensitiveFields.includes("ssn"));
    assert.equal(r.result.status, "needs_redaction");
  });
});

describe("government.milestone_update", () => {
  it("advances to the next milestone and computes progress", async () => {
    const r = await lensRun("government", "milestone_update", {
      data: { milestones: [{ name: "Design" }, { name: "Build" }], currentMilestone: 0 },
    });
    assert.equal(r.result.currentMilestone, 1);
    assert.equal(r.result.currentName, "Design");
    assert.equal(r.result.percentComplete, 50);
  });
});
