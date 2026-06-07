// tests/depth/consulting-behavior.test.js — REAL behavioral tests for the
// consulting domain (registerLensAction family, via lensRun). Exact-value calcs
// (scope/utilization/proposal/health) + engagement/timer CRUD round-trips.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("consulting — calc contracts (exact values)", () => {
  it("engagementScope: fee = hours*rate, +15% contingency", async () => {
    const r = await lensRun("consulting", "engagementScope", { data: { hourlyRate: 200, deliverables: [{ name: "Discovery", hours: 10 }, { name: "Build", hours: 10 }] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalHours, 20);
    assert.equal(r.result.subtotal, 4000);          // 20 * 200
    assert.equal(r.result.contingency, 600);        // 4000 * 0.15
    assert.equal(r.result.grandTotal, 4600);
  });

  it("utilizationRate: rate = billable/total", async () => {
    const r = await lensRun("consulting", "utilizationRate", { data: { billableHours: 30, totalHours: 40 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.utilizationRate, 75);     // 30/40
    assert.equal(r.result.variance, 0);             // 75 − 75 target
    assert.equal(r.result.status, "on-target");
  });

  it("proposalScore: completeness = present sections / 6", async () => {
    const r = await lensRun("consulting", "proposalScore", { data: { "executive-summary": "x", methodology: "y", timeline: "z" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.score, 50);               // 3 of 6
    assert.equal(r.result.completeness, "needs-work");
  });

  it("clientHealth: weighted NPS + payment-rate + responsiveness", async () => {
    const r = await lensRun("consulting", "clientHealth", { data: { nps: 50, invoicesPaid: 8, invoicesTotal: 10, avgResponseDays: 2 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.paymentRate, 80);
    assert.equal(r.result.healthScore, 80);         // 22.5 + 32 + 25.71 → 80
    assert.equal(r.result.risk, "low");
  });
});

describe("consulting — engagement + timer CRUD", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("consulting-crud"); });

  it("engagement-create → engagement-list", async () => {
    const c = await lensRun("consulting", "engagement-create", { params: { name: "Acme Redesign", client: "Acme", rate: 200, budgetHours: 100 } }, ctx);
    assert.equal(c.ok, true);
    const engId = c.result.engagement?.id ?? c.result.id;
    assert.ok(engId);
    const list = await lensRun("consulting", "engagement-list", {}, ctx);
    assert.ok(list.result.engagements.some((e) => e.id === engId));
  });

  it("timer-start → (already running) → timer-stop", async () => {
    const created = await lensRun("consulting", "engagement-create", { params: { name: "Timer Eng", rate: 150, budgetHours: 40 } }, ctx);
    const engId = created.result.engagement?.id ?? created.result.id;
    const start = await lensRun("consulting", "timer-start", { params: { engagementId: engId } }, ctx);
    assert.equal(start.ok, true);
    const dupe = await lensRun("consulting", "timer-start", { params: { engagementId: engId } }, ctx);
    assert.equal(dupe.result.ok, false);
    assert.match(dupe.result.error, /already running/);
    const stop = await lensRun("consulting", "timer-stop", {}, ctx);
    assert.equal(stop.ok, true);
  });

  it("validation: engagement-create without a name is rejected", async () => {
    const bad = await lensRun("consulting", "engagement-create", { params: { client: "X" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });
});
