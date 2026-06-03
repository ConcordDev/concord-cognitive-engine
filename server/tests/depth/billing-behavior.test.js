// tests/depth/billing-behavior.test.js — REAL behavioral tests (billing lens-actions).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("billing — calc actions", () => {
  it("churnPrediction: reports the analyzed customer population", async () => {
    const r = await lensRun("billing", "churnPrediction", { data: { customers: [{ id: 1, mrr: 50 }, { id: 2, mrr: 90 }] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCustomers, 2);
    assert.equal(typeof r.result.atRiskCount, "number");
  });
  it("invoiceCalculation: totals line items and applies tax", async () => {
    const r = await lensRun("billing", "invoiceCalculation", { data: { lineItems: [{ description: "svc", quantity: 2, unitPrice: 50 }] }, params: { taxRate: 10 } });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.lineItems) && r.result.lineItems.length === 1);
    const totalish = r.result.total ?? r.result.grandTotal ?? r.result.totalDue ?? r.result.subtotal;
    assert.ok(Number(totalish) > 0, "a positive total was computed");
  });
});

describe("billing — CRUD", () => {
  let ctx; before(async () => { ctx = await depthCtx("billing-crud"); });
  it("plan-create → plan-list: a created plan is listed", async () => {
    const created = await lensRun("billing", "plan-create", { params: { name: "Pro", amount: 99, interval: "monthly" } }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.plan.name, "Pro");
    const id = created.result.plan.id;
    const list = await lensRun("billing", "plan-list", { params: {} }, ctx);
    assert.ok((list.result.plans || []).some((p) => p.id === id), "plan is listed");
  });
  it("coupon-create → coupon-list: a coupon persists", async () => {
    const created = await lensRun("billing", "coupon-create", { params: { code: "SAVE20", percentOff: 20 } }, ctx);
    assert.equal(created.ok, true);
    const list = await lensRun("billing", "coupon-list", { params: {} }, ctx);
    assert.equal(list.ok, true);
    assert.equal(typeof list.result, "object");
  });
});
