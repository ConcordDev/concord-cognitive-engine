// tests/depth/hvac-behavior.test.js
// REAL behavioral tests for the hvac lens-action domain (32 actions).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("hvac — calc actions (exact values)", () => {
  it("loadCalculation: BTU/tonnage scale with conditioned area", async () => {
    const r = await lensRun("hvac", "loadCalculation", { data: { squareFootage: 2000, stories: 2, insulation: "average" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.requiredBTU, 55000);
    assert.equal(r.result.tonnage, 4.6);                      // 55000 / 12000
    const small = await lensRun("hvac", "loadCalculation", { data: { squareFootage: 1000, stories: 1, insulation: "average" } });
    assert.ok(small.result.requiredBTU < r.result.requiredBTU, "less area ⇒ smaller load");
  });

  it("energyAudit: annual cost = monthly × 12, with savings estimate", async () => {
    const r = await lensRun("hvac", "energyAudit", { data: { squareFootage: 2000, monthlyBill: 300, systemAge: 15 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.annualCost, 3600);                  // 300 × 12
    assert.equal(r.result.costPerSqFt, 1.8);                  // 3600 / 2000
    assert.ok(r.result.potentialAnnualSavings > 0, "an aging system shows savings potential");
  });

  it("zoneBalance: returns per-zone deviation analysis", async () => {
    const r = await lensRun("hvac", "zoneBalance", { params: { zones: [{ name: "up" }, { name: "down" }] }, data: { zones: [{ name: "up" }, { name: "down" }] } });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.zones) && r.result.zones.length >= 2);
    assert.equal(typeof r.result.maxDeviation, "number");
  });
});

describe("hvac — CRUD lifecycle", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("hvac-crud"); });

  it("tech-add → tech-list: an added technician is listed", async () => {
    const added = await lensRun("hvac", "tech-add", { params: { name: "Jo", skills: ["ac"] } }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.technician.name, "Jo");
    const id = added.result.technician.id;
    const list = await lensRun("hvac", "tech-list", { params: {} }, ctx);
    assert.ok((list.result.technicians || []).some((t) => t.id === id), "technician listed");
  });

  it("tech roster is user-scoped", async () => {
    await lensRun("hvac", "tech-add", { params: { name: "Max" } }, ctx);
    const other = await depthCtx("hvac-other");
    const list = await lensRun("hvac", "tech-list", { params: {} }, other);
    assert.ok(!(list.result.technicians || []).some((t) => t.name === "Max"), "rosters isolated per user");
  });

  it("dispatch-board: returns the dispatch view", async () => {
    const r = await lensRun("hvac", "dispatch-board", { params: {} }, ctx);
    assert.equal(r.ok, true);
    assert.equal(typeof r.result, "object");
  });
});
