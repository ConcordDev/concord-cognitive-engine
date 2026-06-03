// tests/depth/accounting-behavior.test.js — REAL behavioral tests for the
// accounting domain. Curated high-confidence subset (calcs + CRUD round-trips +
// validation); the rest of the 116 actions follow the same lensRun template.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("accounting — calc / report contracts", () => {
  it("budgetVariance: variance = actual − planned, flagged over-budget", async () => {
    const over = await lensRun("accounting", "budgetVariance", { data: { budget: [{ category: "Marketing", planned: 1000, actual: 1200 }] } });
    assert.equal(over.ok, true);
    const li = over.result.lineItems[0];
    assert.equal(li.actual, 1200);
    assert.equal(li.variance, 200);            // 1200 − 1000
    assert.equal(li.status, "over-budget");
  });

  it("profitLoss: categorizes accounts into a structured revenue/period report", async () => {
    const r = await lensRun("accounting", "profitLoss", { data: { accounts: [{ type: "revenue", name: "Sales", amount: 5000 }, { type: "expense", name: "Rent", amount: 2000 }] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.revenue && Array.isArray(r.result.revenue.lines));
    assert.equal(r.result.revenue.lines.length, 1);   // the single revenue account
    assert.ok(r.result.period && r.result.period.start, "reports a period");
  });

  it("trialBalance: builds a trial balance over the supplied accounts", async () => {
    const r = await lensRun("accounting", "trialBalance", { data: { accounts: [{ code: "1000", name: "Cash", type: "asset", debit: 1000, credit: 0 }, { code: "3000", name: "Equity", type: "equity", debit: 0, credit: 1000 }] } });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.accounts));
    assert.equal(r.result.accounts.length, 2);        // echoes both accounts
  });
});

describe("accounting — CRUD round-trips + validation", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("accounting-crud"); });

  it("customers-create → customers-list: customer reads back with an auto number", async () => {
    const c = await lensRun("accounting", "customers-create", { params: { name: "Acme Co" } }, ctx);
    assert.equal(c.ok, true);
    assert.equal(c.result.customer.name, "Acme Co");
    assert.match(c.result.customer.number, /^C-\d+/);
    const id = c.result.customer.id;
    const list = await lensRun("accounting", "customers-list", { params: {} }, ctx);
    assert.ok((list.result.customers || []).some((x) => x.id === id), "customer listed");
  });

  it("vendors-create → vendors-list: vendor reads back with an auto number", async () => {
    const v = await lensRun("accounting", "vendors-create", { params: { name: "Supplies Inc" } }, ctx);
    assert.equal(v.ok, true);
    assert.match(v.result.vendor.number, /^V-\d+/);
    const id = v.result.vendor.id;
    const list = await lensRun("accounting", "vendors-list", { params: {} }, ctx);
    assert.ok((list.result.vendors || []).some((x) => x.id === id), "vendor listed");
  });

  it("coa-create: rejects an invalid account category (validation)", async () => {
    const bad = await lensRun("accounting", "coa-create", { params: { code: "4000", name: "X", type: "revenue" } }, ctx); // sends 'type', not 'category'
    assert.equal(bad.result.ok, false);
    assert.match(String(bad.result.error), /category invalid/i);
  });

  it("coa-create → coa-list: a valid account joins the chart of accounts", async () => {
    const c = await lensRun("accounting", "coa-create", { params: { code: "4100", name: "Service Revenue", category: "revenue" } }, ctx);
    assert.equal(c.ok, true);
    const list = await lensRun("accounting", "coa-list", { params: {} }, ctx);
    assert.ok((list.result.accounts || []).some((a) => a.code === "4100"), "new account in the chart");
  });
});
