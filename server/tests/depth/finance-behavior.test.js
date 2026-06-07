// tests/depth/finance-behavior.test.js — REAL behavioral tests for the
// finance domain (registerLensAction family, via lensRun). Money math is
// recomputed from server/domains/finance.js source and asserted to the exact
// value; CRUD round-trips (accounts / goals / bills / transactions) prove
// create → read-back; validation rejections pin the guard clauses.
//
// Calc actions read artifact.data (pass { data }); CRUD actions read params
// (pass { params } + a shared ctx so user-scoped STATE round-trips).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("finance — analytical calcs (exact recomputed values)", () => {
  it("compoundInterest: 10000 @ 6%/yr, 2yr, no contrib → 10000 * 1.005^24", async () => {
    const r = await lensRun("finance", "compoundInterest", { data: { principal: 10000, annualRate: 0.06, years: 2, monthlyContribution: 0 } });
    assert.equal(r.ok, true);
    // 24 monthly compounds at 0.06/12 = 0.005 → 10000 * 1.005^24 = 11271.60
    assert.equal(r.result.finalBalance, 11271.6);
    assert.equal(r.result.totalContributed, 10000);
    assert.equal(r.result.totalInterest, 1271.6);     // 11271.6 − 10000
    assert.equal(r.result.interestPercent, 11);       // round(1271.6/11271.6*100)
    assert.equal(r.result.annualRate, "6.0%");
  });

  it("compoundInterest: monthly DCA — 100/mo @ 12%/yr, 1yr, principal 0", async () => {
    const r = await lensRun("finance", "compoundInterest", { data: { principal: 0, annualRate: 0.12, years: 1, monthlyContribution: 100 } });
    assert.equal(r.ok, true);
    // 12 deposits of 100 compounding at 0.01/mo → 1268.25; contributed 1200
    assert.equal(r.result.finalBalance, 1268.25);
    assert.equal(r.result.totalContributed, 1200);
    assert.equal(r.result.totalInterest, 68.25);
  });

  it("budgetTracker: savingsRate + per-category over-budget detection", async () => {
    const r = await lensRun("finance", "budgetTracker", { data: { monthlyIncome: 5000, categories: [
      { name: "Rent", budget: 2000, spent: 2000 },
      { name: "Food", budget: 600, spent: 700 },
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalSpent, 2700);
    assert.equal(r.result.totalBudgeted, 2600);
    assert.equal(r.result.remaining, 2300);           // 5000 − 2700
    assert.equal(r.result.savingsRate, 46);           // round(2300/5000*100)
    const food = r.result.categories.find((c) => c.category === "Food");
    assert.equal(food.percentUsed, 117);              // round(700/600*100)
    assert.equal(food.status, "over-budget");         // 700 > 600
    assert.deepEqual(r.result.overBudget, ["Food"]);
  });

  it("portfolioAnalysis: allocation % + return on cost basis", async () => {
    const r = await lensRun("finance", "portfolioAnalysis", { data: { holdings: [
      { symbol: "AAA", value: 6000, gainLoss: 500, type: "equity" },
      { symbol: "BBB", value: 4000, gainLoss: -100, type: "bond" },
    ] } });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalValue, 10000);
    assert.equal(r.result.totalGainLoss, 400);        // 500 + (−100)
    assert.equal(r.result.returnPercent, 4.17);       // round(400/(10000−400)*10000)/100
    const aaa = r.result.holdings.find((h) => h.symbol === "AAA");
    assert.equal(aaa.allocation, 60);                 // 6000/10000
    assert.equal(r.result.diversificationScore, "moderate");  // 2 asset types
  });

  it("debtPayoff: months-to-payoff via amortization log formula", async () => {
    const r = await lensRun("finance", "debtPayoff", { data: { debts: [
      { name: "Card", balance: 5000, rate: 0.18, minimumPayment: 200 },
    ] } });
    assert.equal(r.ok, true);
    // ceil(log(1/(1 − 5000*(0.18/12)/200)) / log(1+0.18/12)) = 32 months
    assert.equal(r.result.debts[0].monthsToPayoff, 32);
    assert.equal(r.result.debts[0].totalInterest, 1400);  // 32*200 − 5000
    assert.equal(r.result.firstTarget, "Card");
    assert.equal(r.result.totalDebt, 5000);
  });

  it("tax-estimate: single, $100k wages, standard deduction → 22% marginal", async () => {
    // tax-estimate reads params (not artifact.data) — its handler is (_ctx, _artifact, params)
    const r = await lensRun("finance", "tax-estimate", { params: { wages: 100000, filing: "single", withholding: 0 } });
    assert.equal(r.ok, true);
    // taxable = 100000 − 16100 std = 83900; bracket tax = 1170 + 4326 + 7953 = 13449
    assert.equal(r.result.taxableIncome, 83900);
    assert.equal(r.result.deductionUsed, 16100);
    assert.equal(r.result.totalTax, 13449);
    assert.equal(r.result.marginalRate, 0.22);
    assert.equal(r.result.effectiveRate, 0.134);      // round(13449/100000*1000)/1000
    assert.equal(r.result.owed, 13449);               // withholding 0 → all owed
  });

  it("tax-estimate: long-term gains taxed at the 15% LTCG rate band", async () => {
    const r = await lensRun("finance", "tax-estimate", { params: { wages: 100000, longTermGains: 10000, filing: "single", withholding: 0 } });
    assert.equal(r.ok, true);
    // taxableOrdinary 83900 is in [48750, 533400) → ltcgRate 0.15
    assert.equal(r.result.ltcgRate, 0.15);
    assert.equal(r.result.ltcgTax, 1500);             // 10000 * 0.15
  });
});

describe("finance — CRUD round-trips (shared user ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("finance-crud"); });

  it("accounts-link → accounts-list reads it back + computes net worth", async () => {
    const checking = await lensRun("finance", "accounts-link", { params: { institution: "Chase", name: "Checking", kind: "checking", balance: 3000 } }, ctx);
    assert.equal(checking.ok, true);
    const acctId = checking.result.account.id;
    assert.ok(acctId);
    const card = await lensRun("finance", "accounts-link", { params: { institution: "Amex", name: "Card", kind: "credit", balance: -500 } }, ctx);
    const cardId = card.result.account.id;
    const list = await lensRun("finance", "accounts-list", {}, ctx);
    assert.ok(list.result.accounts.some((a) => a.id === acctId));
    assert.ok(list.result.accounts.some((a) => a.id === cardId));
    // assets sum positives (3000), liabilities = |negatives| (500), netWorth 2500
    assert.equal(list.result.totalAssets, 3000);
    assert.equal(list.result.totalLiabilities, 500);
    assert.equal(list.result.netWorth, 2500);
  });

  it("goals-create → goals-contribute → goals-list reflects new saved + progress", async () => {
    const g = await lensRun("finance", "goals-create", { params: { name: "Emergency Fund", target: 10000, initialSaved: 2000, monthlyContribution: 500 } }, ctx);
    assert.equal(g.ok, true);
    const goalId = g.result.goal.id;
    const contrib = await lensRun("finance", "goals-contribute", { params: { id: goalId, amount: 500 } }, ctx);
    assert.equal(contrib.result.goal.saved, 2500);    // 2000 + 500
    const list = await lensRun("finance", "goals-list", {}, ctx);
    const found = list.result.goals.find((x) => x.id === goalId);
    assert.equal(found.saved, 2500);
    assert.equal(found.remaining, 7500);              // 10000 − 2500
    assert.equal(found.progressPct, 25);              // 2500/10000
  });

  it("transactions-ingest auto-categorises by merchant rule → transactions-list totals", async () => {
    const tx = await lensRun("finance", "transactions-ingest", { params: { description: "NETFLIX.COM subscription", amount: -15.99 } }, ctx);
    assert.equal(tx.ok, true);
    // ruleBasedCategorize maps netflix → Entertainment
    assert.equal(tx.result.transaction.category, "Entertainment");
    assert.equal(tx.result.transaction.autoCategorised, true);
    const txId = tx.result.transaction.id;
    const list = await lensRun("finance", "transactions-list", {}, ctx);
    assert.ok(list.result.transactions.some((t) => t.id === txId));
    assert.ok(list.result.totalSpend >= 15.99);       // the debit is counted as spend
  });

  it("bills-add → bills-pay marks paid → bills-list reads back", async () => {
    const b = await lensRun("finance", "bills-add", { params: { name: "Electric", amount: 120, dueDay: 15, cadence: "monthly" } }, ctx);
    assert.equal(b.ok, true);
    const billId = b.result.bill.id;
    assert.equal(b.result.bill.paidThisCycle, false);
    const paid = await lensRun("finance", "bills-pay", { params: { id: billId } }, ctx);
    assert.equal(paid.result.bill.paidThisCycle, true);
    const list = await lensRun("finance", "bills-list", {}, ctx);
    const found = list.result.bills.find((x) => x.id === billId);
    assert.equal(found.paidThisCycle, true);
  });
});

describe("finance — validation rejections", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("finance-reject"); });

  it("goals-create without a name is rejected", async () => {
    const bad = await lensRun("finance", "goals-create", { params: { target: 1000 } }, ctx);
    assert.equal(bad.result.ok, false);               // lens.run wraps handler {ok:false}
    assert.ok(bad.result.error.includes("name required"));
  });

  it("holdings-add with zero shares is rejected", async () => {
    const bad = await lensRun("finance", "holdings-add", { params: { symbol: "VOO", shares: 0, price: 400 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("symbol, shares, price required"));
  });

  it("accounts-unlink on a missing account is rejected", async () => {
    const bad = await lensRun("finance", "accounts-unlink", { params: { id: "does-not-exist" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("account not found"));
  });
});
