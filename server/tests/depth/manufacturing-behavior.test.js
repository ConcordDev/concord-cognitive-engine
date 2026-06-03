// tests/depth/manufacturing-behavior.test.js — REAL behavioral tests (manufacturing lens-actions).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("manufacturing — calc actions (exact values)", () => {
  it("oeeCalculate: OEE = availability × performance × quality", async () => {
    // planned 480, downtime 80 → avail 83%; ideal 1 × 400 / 400 → perf 100%; 380/400 → quality 95% → OEE 79
    const r = await lensRun("manufacturing", "oeeCalculate", { params: { plannedTime: 480, downtime: 80, idealCycleTime: 1, totalPieces: 400, goodPieces: 380 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.availability, 83);
    assert.equal(r.result.quality, 95);
    assert.equal(r.result.oee, 79);
  });
  it("oeeCalculate: more good pieces ⇒ higher quality ⇒ higher OEE", async () => {
    const lo = await lensRun("manufacturing", "oeeCalculate", { params: { plannedTime: 480, downtime: 0, idealCycleTime: 1, totalPieces: 400, goodPieces: 300 } });
    const hi = await lensRun("manufacturing", "oeeCalculate", { params: { plannedTime: 480, downtime: 0, idealCycleTime: 1, totalPieces: 400, goodPieces: 400 } });
    assert.ok(hi.result.oee > lo.result.oee);
  });
  it("safetyRate: computes an incident rate from hours worked", async () => {
    const r = await lensRun("manufacturing", "safetyRate", { params: { hoursWorked: 200000, recordableIncidents: 3 } });
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.incidentRate, "number");
  });
  it("work-orders: returns the (possibly empty) work-order list", async () => {
    const r = await lensRun("manufacturing", "work-orders", { params: {} });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.orders));
  });
});

describe("manufacturing — CRUD", () => {
  let ctx; before(async () => { ctx = await depthCtx("mfg-crud"); });
  it("andon-raise → andon-board: a raised andon shows open on the board", async () => {
    const raised = await lensRun("manufacturing", "andon-raise", { params: { station: "Line 1", reason: "jam" } }, ctx);
    assert.equal(raised.ok, true);
    assert.equal(raised.result.alert.status, "open");
    const id = raised.result.alert.id;
    const board = await lensRun("manufacturing", "andon-board", { params: {} }, ctx);
    assert.ok((board.result.alerts || []).some((a) => a.id === id), "the raised alert is on the board");
  });
});
