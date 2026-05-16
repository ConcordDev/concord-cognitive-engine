// Contract tests for the finance-lens parity macros in server/domains/finance.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFinanceActions from "../domains/finance.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`finance.${name}`);
  assert.ok(fn, `finance.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerFinanceActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const userA = "user_a";
const userB = "user_b";
const ctxA = { actor: { userId: userA }, userId: userA };
const ctxB = { actor: { userId: userB }, userId: userB };

describe("finance.envelopes-* + monthly-income", () => {
  it("scoped per user, set + list + delete cycle", () => {
    call("monthly-income-set", ctxA, { monthlyIncome: 8000 });
    const c1 = call("envelopes-create", ctxA, { category: "Groceries", monthlyTarget: 600 });
    assert.equal(c1.ok, true);
    call("envelopes-create", ctxA, { category: "Dining", monthlyTarget: 250 });

    const list = call("envelopes-list", ctxA, {});
    assert.equal(list.result.envelopes.length, 2);
    assert.equal(list.result.monthlyIncome, 8000);

    // Other user isolated
    assert.equal(call("envelopes-list", ctxB, {}).result.envelopes.length, 0);

    const del = call("envelopes-delete", ctxA, { id: c1.result.envelope.id });
    assert.equal(del.ok, true);
    assert.equal(call("envelopes-list", ctxA, {}).result.envelopes.length, 1);
  });

  it("rejects empty category", () => {
    assert.equal(call("envelopes-create", ctxA, { category: "", monthlyTarget: 100 }).ok, false);
  });
});

describe("finance.net-worth-history", () => {
  it("seeds synthetic snapshots when none exist", () => {
    const r = call("net-worth-history", ctxA, { range: "1Y" });
    assert.equal(r.ok, true);
    assert.ok(r.result.snapshots.length > 0);
    for (const s of r.result.snapshots) {
      assert.ok(typeof s.cash === "number");
      assert.ok(typeof s.total === "number");
      // Total may differ by ±1 due to per-component rounding in the synthetic seeder.
      const expected = s.cash + s.investments + s.realEstate + s.crypto - s.liabilities;
      assert.ok(Math.abs(s.total - expected) <= 2, `total ${s.total} vs sum ${expected}`);
    }
  });

  it("manual snapshot persists and feeds history", () => {
    const r = call("net-worth-snapshot", ctxA, { cash: 5000, investments: 80000, realEstate: 0, crypto: 1000, liabilities: 10000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.snapshot.total, 76000);
    const hist = call("net-worth-history", ctxA, { range: "all" });
    assert.ok(hist.result.snapshots.length >= 1);
    assert.ok(hist.result.snapshots.some(s => s.total === 76000));
  });
});

describe("finance.investment-checkup", () => {
  it("returns allocation drift + concentration + fees + score for sample portfolio", () => {
    const r = call("investment-checkup", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.allocation));
    assert.equal(r.result.allocation.length, 5);
    for (const a of r.result.allocation) {
      assert.ok(typeof a.current === "number");
      assert.ok(["buy", "sell", "hold"].includes(a.rebalanceAction));
    }
    assert.ok(r.result.score >= 0 && r.result.score <= 100);
    assert.ok(r.result.totalAnnualFeeUsd >= 0);
  });
});

describe("finance.tax-estimate (IRS 2026 brackets)", () => {
  it("computes single-filer tax correctly at $85k wages, standard deduction", () => {
    const r = call("tax-estimate", ctxA, { wages: 85000, filing: "single", withholding: 12000 });
    assert.equal(r.ok, true);
    // After 16100 standard deduction → taxable 68900
    assert.equal(r.result.taxableIncome, 68900);
    // 10% on first 11700 + 12% on (47750-11700) + 22% on (68900-47750)
    //   = 1170 + 4326 + 4653 = 10149
    assert.ok(Math.abs(r.result.totalTax - 10149) < 5);
    assert.equal(r.result.marginalRate, 0.22);
    assert.ok(r.result.refund !== null);  // 12000 > 10149
  });

  it("computes married-jointly tax at $200k correctly", () => {
    const r = call("tax-estimate", ctxA, { wages: 200000, filing: "married_jointly", withholding: 20000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.taxableIncome, 200000 - 32200);  // standard deduction
    assert.ok(r.result.totalTax > 20000);
    assert.ok(r.result.owed !== null);
  });

  it("applies LTCG 0% rate at low income", () => {
    const r = call("tax-estimate", ctxA, { wages: 40000, longTermGains: 5000, filing: "single", withholding: 0 });
    assert.equal(r.result.ltcgRate, 0);
    assert.equal(r.result.ltcgTax, 0);
  });

  it("applies LTCG 15% rate at moderate income", () => {
    const r = call("tax-estimate", ctxA, { wages: 100000, longTermGains: 10000, filing: "single", withholding: 0 });
    assert.equal(r.result.ltcgRate, 0.15);
    assert.equal(r.result.ltcgTax, 1500);
  });

  it("itemized deduction overrides standard when higher", () => {
    const r1 = call("tax-estimate", ctxA, { wages: 100000, filing: "single", deductions: 0, withholding: 0 });
    const r2 = call("tax-estimate", ctxA, { wages: 100000, filing: "single", deductions: 25000, withholding: 0 });
    assert.ok(r2.result.taxableIncome < r1.result.taxableIncome);
  });
});

describe("finance.retirement-monte-carlo", () => {
  it("runs N paths and reports success probability", () => {
    const r = call("retirement-monte-carlo", ctxA, {
      currentAge: 35, retireAge: 67,
      currentSavings: 150000, annualContribution: 20000,
      expectedReturn: 0.07, volatility: 0.15,
      annualSpendInRetirement: 60000, paths: 500,
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.successProbability >= 0 && r.result.successProbability <= 1);
    assert.ok(r.result.medianFinalBalance >= 0);
    assert.ok(r.result.p10Final <= r.result.medianFinalBalance);
    assert.ok(r.result.p90Final >= r.result.medianFinalBalance);
    assert.ok(r.result.trajectories.length > 0);
    assert.equal(r.result.paths, 500);
    assert.equal(r.result.years, 95 - 35);
  });

  it("clamps inputs to safe ranges", () => {
    const r = call("retirement-monte-carlo", ctxA, {
      currentAge: 5, retireAge: 200,
      currentSavings: -1000, annualContribution: -500,
      expectedReturn: 5, volatility: 100,
      annualSpendInRetirement: -1000, paths: 50_000,
    });
    assert.ok(r.result.paths <= 5000);
    assert.ok(r.result.years > 0);
  });
});

describe("finance.subscriptions-detect + cancel", () => {
  it("seeds + lists demo subscriptions; cancel marks as cancelled", () => {
    const r = call("subscriptions-detect", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.subscriptions.length >= 5);
    const first = r.result.subscriptions[0];

    const cancelled = call("subscriptions-cancel", ctxA, { id: first.id });
    assert.equal(cancelled.ok, true);

    const after = call("subscriptions-detect", ctxA, {});
    assert.equal(after.result.subscriptions.find(s => s.id === first.id).status, "cancelled");
  });

  it("rejects unknown subscription id", () => {
    call("subscriptions-detect", ctxA, {});
    assert.equal(call("subscriptions-cancel", ctxA, { id: "nope" }).ok, false);
  });
});

describe("finance.categorize-transaction", () => {
  it("falls back to rule-based categorisation when LLM unavailable", async () => {
    const r = await call("categorize-transaction", ctxA, { description: "WHOLE FOODS MARKET", amount: 87.20 });
    assert.equal(r.ok, true);
    assert.equal(r.result.category, "Groceries");
    assert.equal(r.result.source, "rules");
  });

  it("routes to utility brain when available", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({ text: '{"category":"Dining","confidence":0.92}' }) },
    };
    const r = await call("categorize-transaction", ctx, { description: "BLUE BOTTLE COFFEE", amount: 6.5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.category, "Dining");
    assert.equal(r.result.confidence, 0.92);
    assert.equal(r.result.source, "utility-brain");
  });

  it("rejects empty description", async () => {
    const r = await call("categorize-transaction", ctxA, { description: "" });
    assert.equal(r.ok, false);
  });

  it("falls back to rules when LLM returns garbage", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({ text: "no idea" }) },
    };
    const r = await call("categorize-transaction", ctx, { description: "Uber Eats", amount: 28 });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "rules");
  });
});

describe("finance.weekly-commentary", () => {
  it("graceful fallback when LLM unavailable", async () => {
    const r = await call("weekly-commentary", ctxA, { totalSpent: 1200, totalIncome: 5000 });
    assert.equal(r.ok, true);
    assert.match(r.result.text, /unavailable/i);
  });

  it("returns text from conscious brain when configured", async () => {
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async () => ({ text: "Healthy week — savings rate 76%." }) },
    };
    const r = await call("weekly-commentary", ctx, { totalSpent: 1200, totalIncome: 5000, topCategories: [{ category: "Groceries", amount: 400 }] });
    assert.equal(r.ok, true);
    assert.match(r.result.text, /76%/);
  });
});

describe("regression: pre-existing analytical macros still work", () => {
  it("portfolioAnalysis returns totals", () => {
    const r = ACTIONS.get("finance.portfolioAnalysis")(ctxA, { data: { holdings: [{ symbol: "AAPL", shares: 10, value: 1500, type: "equity" }] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalValue, 1500);
  });

  it("compoundInterest projects out 10 years", () => {
    const r = ACTIONS.get("finance.compoundInterest")(ctxA, { data: { principal: 10000, annualRate: 0.07, years: 10, monthlyContribution: 500 } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.timeline.length, 10);
    assert.ok(r.result.finalBalance > 10000);
  });
});
