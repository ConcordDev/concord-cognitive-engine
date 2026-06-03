// tests/depth/observe-behavior.test.js — REAL behavioral tests (observe lens-actions).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("observe — SLO math (exact)", () => {
  it("sloCheck: actual below target burns the error budget → critical", async () => {
    const r = await lensRun("observe", "sloCheck", { params: { actualPct: 99.5, targetPct: 99.9, windowDays: 30 } });
    assert.equal(r.ok, true);
    assert.equal(r.result.errorBudgetPct, 0.1);          // 100 − 99.9
    assert.equal(r.result.burnRate, 5);                  // (99.9−99.5)/0.1 × ... = 5×
    assert.equal(r.result.status, "critical");
  });
  it("sloCheck: meeting target is not critical", async () => {
    const r = await lensRun("observe", "sloCheck", { params: { actualPct: 99.95, targetPct: 99.9, windowDays: 30 } });
    assert.equal(r.ok, true);
    assert.notEqual(r.result.status, "critical");
  });
});

describe("observe — CRUD", () => {
  let ctx; before(async () => { ctx = await depthCtx("obs-crud"); });
  it("metricIngest → metricList: an ingested metric is listed", async () => {
    const ing = await lensRun("observe", "metricIngest", { params: { points: [{ metric: "cpu", value: 42, ts: Date.now() }] } }, ctx);
    assert.equal(ing.ok, true);
    assert.ok(ing.result.ingested >= 1, "at least one point ingested");
    const list = await lensRun("observe", "metricList", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.ok(list.result.metrics.some((m) => (m.metric || m.name || m) === "cpu"), "ingested metric appears");
  });
  it("monitorSave: rejects a monitor with no metric (required-field validation)", async () => {
    const saved = await lensRun("observe", "monitorSave", { params: { name: "high-cpu", query: "cpu>90" } }, ctx);
    assert.equal(saved.result.ok, false);
    assert.match(String(saved.result.error), /metric required/i);
  });
  it("monitorList: returns the monitor set with a total count", async () => {
    const list = await lensRun("observe", "monitorList", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.ok(Array.isArray(list.result.monitors));
    assert.equal(list.result.total, list.result.monitors.length);
  });
});
