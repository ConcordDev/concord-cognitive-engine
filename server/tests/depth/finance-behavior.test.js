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

describe("finance — net worth + dashboard (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("finance-topup8-nw"); });

  it("net-worth-snapshot: total = cash+inv+realEstate+crypto − liabilities", async () => {
    const r = await lensRun("finance", "net-worth-snapshot", { params: {
      cash: 20000, investments: 80000, realEstate: 300000, crypto: 5000, liabilities: 150000,
    } }, ctx);
    assert.equal(r.ok, true);
    // 20000 + 80000 + 300000 + 5000 − 150000 = 255000
    assert.equal(r.result.snapshot.total, 255000);
    assert.equal(r.result.snapshot.cash, 20000);
    assert.equal(r.result.snapshot.liabilities, 150000);
  });

  it("net-worth-history reads the logged snapshot back (round-trip via .some)", async () => {
    const r = await lensRun("finance", "net-worth-history", { params: { range: "5Y" } }, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.result.snapshots.some((s) => s.total === 255000));
    assert.equal(r.result.total >= 1, true);
  });

  it("net-worth-snapshot clamps negative inputs to 0 (liabilities only subtract)", async () => {
    const r2 = await lensRun("finance", "net-worth-snapshot", { params: {
      cash: -500, investments: 1000, realEstate: 0, crypto: 0, liabilities: 200, date: "2020-01-01",
    } }, ctx);
    assert.equal(r2.ok, true);
    // cash clamps to 0 → 0 + 1000 + 0 + 0 − 200 = 800
    assert.equal(r2.result.snapshot.total, 800);
    assert.equal(r2.result.snapshot.cash, 0);
  });

  it("dashboard-summary: netWorth = cash + investments − credit − loans", async () => {
    const dctx = await depthCtx("finance-topup8-dash");
    await lensRun("finance", "accounts-link", { params: { institution: "Chase", name: "Chk", kind: "checking", balance: 5000 } }, dctx);
    await lensRun("finance", "accounts-link", { params: { institution: "Ally", name: "Sav", kind: "savings", balance: 3000 } }, dctx);
    await lensRun("finance", "accounts-link", { params: { institution: "Amex", name: "Card", kind: "credit", balance: -1200 } }, dctx);
    await lensRun("finance", "holdings-add", { params: { symbol: "VOO", shares: 10, price: 400 } }, dctx);
    const r = await lensRun("finance", "dashboard-summary", {}, dctx);
    assert.equal(r.ok, true);
    // cash 5000+3000=8000, investments 10*400=4000, credit 1200, loans 0 → netWorth 10800
    assert.equal(r.result.breakdown.cash, 8000);
    assert.equal(r.result.breakdown.investments, 4000);
    assert.equal(r.result.breakdown.credit, 1200);
    assert.equal(r.result.netWorth, 10800);
    assert.equal(r.result.buyingPower, 8000);     // cash
    assert.equal(r.result.accountCount, 3);
    assert.equal(r.result.positionCount, 1);
  });
});

describe("finance — holdings + investment-checkup + dividends (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("finance-topup8-hold"); });

  it("holdings-add averages cost basis when adding to an existing symbol", async () => {
    await lensRun("finance", "holdings-add", { params: { symbol: "AAPL", shares: 10, price: 100 } }, ctx);
    const r = await lensRun("finance", "holdings-add", { params: { symbol: "AAPL", shares: 10, price: 200 } }, ctx);
    assert.equal(r.ok, true);
    const aapl = r.result.holdings.find((h) => h.symbol === "AAPL");
    // (10*100 + 10*200)/20 = 150 weighted-average cost basis; 20 shares total
    assert.equal(aapl.shares, 20);
    assert.equal(aapl.costBasis, 150);
  });

  it("investment-checkup: single 100% equity_us holding → drift 50, concentration 100%", async () => {
    const ictx = await depthCtx("finance-topup8-checkup");
    await lensRun("finance", "holdings-add", { params: { symbol: "VTI", shares: 100, price: 100, assetClass: "equity_us", sector: "Broad" } }, ictx);
    const r = await lensRun("finance", "investment-checkup", {}, ictx);
    assert.equal(r.ok, true);
    const usEquity = r.result.allocation.find((a) => a.assetClass === "equity_us");
    // 10000/10000 = 100% current vs 50% target → drift 50, action sell
    assert.equal(usEquity.current, 100);
    assert.equal(usEquity.drift, 50);
    assert.equal(usEquity.rebalanceAction, "sell");
    assert.equal(r.result.concentrationRisk.topHoldingPct, 100);
    // score = 100 − min(40, 50*3) − max(0,(100−20)*1.5) − feePenalty → clamps to 0
    assert.equal(r.result.score, 0);
  });

  it("investment-checkup rejects when the user has no holdings (real data only)", async () => {
    const empty = await depthCtx("finance-topup8-empty");
    const bad = await lensRun("finance", "investment-checkup", {}, empty);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("no holdings"));
  });

  it("dividends-summary: annualDividend = value × yield, portfolioYield exact", async () => {
    const dctx = await depthCtx("finance-topup8-div");
    await lensRun("finance", "holdings-add", { params: { symbol: "SCHD", shares: 100, price: 100, dividendYield: 0.04 } }, dctx);
    const r = await lensRun("finance", "dividends-summary", {}, dctx);
    assert.equal(r.ok, true);
    const schd = r.result.perHolding.find((p) => p.symbol === "SCHD");
    // value 10000 * 0.04 = 400 annual; 400/12 = 33.33 monthly
    assert.equal(schd.annualDividend, 400);
    assert.equal(schd.monthlyDividend, 33.33);
    assert.equal(r.result.totalAnnual, 400);
    assert.equal(r.result.portfolioYieldPct, 4);    // 400/10000 = 4%
  });

  it("tax-loss-candidates: unrealisedLoss = (price − costBasis) × shares; tax benefit at 24%", async () => {
    const tctx = await depthCtx("finance-topup8-tlh");
    const add = await lensRun("finance", "holdings-add", { params: { symbol: "ARKK", shares: 100, price: 50 } }, tctx);
    const holdId = add.result.holdings.find((h) => h.symbol === "ARKK").id;
    // bought at 50 (costBasis), drop price to 30 → loss (30−50)*100 = −2000
    await lensRun("finance", "holdings-update-price", { params: { id: holdId, price: 30 } }, tctx);
    const r = await lensRun("finance", "tax-loss-candidates", { params: { minLoss: 100 } }, tctx);
    assert.equal(r.ok, true);
    const cand = r.result.candidates.find((c) => c.symbol === "ARKK");
    assert.equal(cand.unrealisedLoss, -2000);
    assert.equal(r.result.totalHarvestableLoss, 2000);
    assert.equal(r.result.estimatedTaxBenefit, 480);   // 2000 * 0.24
  });
});

describe("finance — ledger analytics: sankey + monthly-trend + spending-insights (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("finance-topup8-ledger"); });

  it("cashflow-sankey: Income → Spending/Savings split from the real ledger", async () => {
    await lensRun("finance", "transactions-ingest", { params: { description: "Payroll deposit", amount: 4000, date: "2026-03-01" } }, ctx);
    await lensRun("finance", "transactions-ingest", { params: { description: "Whole Foods", amount: -300, date: "2026-03-05", category: "Groceries" } }, ctx);
    await lensRun("finance", "transactions-ingest", { params: { description: "Rent payment", amount: -1700, date: "2026-03-02", category: "Bills" } }, ctx);
    const r = await lensRun("finance", "cashflow-sankey", { params: { month: "2026-03" } }, ctx);
    assert.equal(r.ok, true);
    // income 4000, spend 300+1700=2000, savings 2000
    assert.equal(r.result.income, 4000);
    assert.equal(r.result.totalSpend, 2000);
    assert.equal(r.result.netCashFlow, 2000);
    assert.ok(r.result.links.some((l) => l.source === "income" && l.target === "savings" && l.value === 2000));
    assert.ok(r.result.nodes.some((n) => n.id === "cat:Bills"));
  });

  it("monthly-trend: per-month net + savingsRate exact (uses the wave-8 ledger)", async () => {
    const r = await lensRun("finance", "monthly-trend", { params: { months: 12 } }, ctx);
    assert.equal(r.ok, true);
    const mar = r.result.series.find((m) => m.month === "2026-03");
    assert.equal(mar.income, 4000);
    assert.equal(mar.spend, 2000);
    assert.equal(mar.net, 2000);
    assert.equal(mar.savingsRate, 50);   // (4000−2000)/4000 = 50%
  });

  it("spending-insights: MoM delta + anomaly flag on a >50% jump", async () => {
    const ictx = await depthCtx("finance-topup8-insights");
    const r = await lensRun("finance", "spending-insights", { params: { transactions: [
      { description: "Dining", amount: -100, category: "Dining", date: "2026-02-10" },
      { description: "Dining", amount: -300, category: "Dining", date: "2026-03-10" },
    ] } }, ictx);
    assert.equal(r.ok, true);
    const dining = r.result.trends.find((t) => t.category === "Dining");
    // prior 100, current 300 → delta 200, deltaPct 200 → anomaly (>50% and >$20)
    assert.equal(dining.current, 300);
    assert.equal(dining.prior, 100);
    assert.equal(dining.delta, 200);
    assert.equal(dining.deltaPct, 200);
    assert.equal(dining.anomaly, true);
    assert.ok(r.result.anomalies.some((a) => a.category === "Dining"));
  });
});

describe("finance — household + credit + rollover (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("finance-topup8-misc"); });

  it("household-create → budget-create → budget-spend computes remaining + overBudget", async () => {
    await lensRun("finance", "household-create", { params: { name: "Smith Family" } }, ctx);
    const b = await lensRun("finance", "household-budget-create", { params: { category: "Groceries", monthlyTarget: 800 } }, ctx);
    const budgetId = b.result.budget.id;
    const spend = await lensRun("finance", "household-budget-spend", { params: { budgetId, amount: 900 } }, ctx);
    assert.equal(spend.ok, true);
    assert.equal(spend.result.budget.spent, 900);
    assert.equal(spend.result.remaining, -100);   // 800 − 900
    assert.equal(spend.result.overBudget, true);  // 900 > 800
    assert.ok(spend.result.budget.contributions.some((c) => c.amount === 900));
  });

  it("household-create twice is rejected (one household per owner)", async () => {
    const bad = await lensRun("finance", "household-create", { params: { name: "Second" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("already exists"));
  });

  it("credit-score-record → report computes band + delta from history", async () => {
    const cctx = await depthCtx("finance-topup8-credit");
    await lensRun("finance", "credit-score-record", { params: { score: 680, date: "2026-01-01", utilisationPct: 45 } }, cctx);
    await lensRun("finance", "credit-score-record", { params: { score: 720, date: "2026-03-01", utilisationPct: 20 } }, cctx);
    const r = await lensRun("finance", "credit-score-report", {}, cctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.latest.score, 720);
    assert.equal(r.result.band, "good");   // 670–739
    assert.equal(r.result.delta, 40);      // 720 − 680 (first)
    // first reading had 45% utilisation → advice surfaced from the *latest* (20%, no advice on util)
    assert.ok(r.result.history.some((e) => e.score === 680));
  });

  it("credit-score-record rejects an out-of-range score", async () => {
    const cctx = await depthCtx("finance-topup8-credit-bad");
    const bad = await lensRun("finance", "credit-score-record", { params: { score: 900 } }, cctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("300-850"));
  });

  it("envelopes-create → rollover-rule-set(capped) → rollover-apply carries cap + sends surplus to goal", async () => {
    const ectx = await depthCtx("finance-topup8-roll");
    const env = await lensRun("finance", "envelopes-create", { params: { category: "Fun", monthlyTarget: 500 } }, ectx);
    const envelopeId = env.result.envelope.id;
    // capped at 100, attached goal target 1000. Envelope spent 0 → leftover 500.
    await lensRun("finance", "rollover-rule-set", { params: { envelopeId, mode: "capped", cap: 100, goalTarget: 1000 } }, ectx);
    const r = await lensRun("finance", "rollover-apply", {}, ectx);
    assert.equal(r.ok, true);
    const applied = r.result.applied.find((a) => a.envelopeId === envelopeId);
    // leftover 500, carried = min(500,100) = 100, toGoal = 500 − 100 = 400
    assert.equal(applied.leftover, 500);
    assert.equal(applied.carried, 100);
    assert.equal(applied.toGoal, 400);
    assert.equal(applied.newBalance, 100);
    assert.equal(applied.goalProgress.accumulated, 400);
    assert.equal(applied.goalProgress.pct, 40);   // 400/1000
  });

  it("rollover-rule-set on a missing envelope is rejected", async () => {
    const ectx = await depthCtx("finance-topup8-roll-bad");
    const bad = await lensRun("finance", "rollover-rule-set", { params: { envelopeId: "nope", mode: "full" } }, ectx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("envelope not found"));
  });
});

describe("finance — rules + sync ingestion (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("finance-topup8-rules"); });

  it("rules-create → rules-apply matches a user rule over the default categoriser", async () => {
    await lensRun("finance", "rules-create", { params: { matchText: "blue bottle", category: "Coffee", matchKind: "contains", priority: 10 } }, ctx);
    const r = await lensRun("finance", "rules-apply", { params: { description: "BLUE BOTTLE COFFEE #42" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.category, "Coffee");
    assert.equal(r.result.source, "user_rule");
  });

  it("rules-create without a category is rejected", async () => {
    const bad = await lensRun("finance", "rules-create", { params: { matchText: "x" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("matchText and category required"));
  });

  it("accounts-sync-link → accounts-sync-pull ingests + dedups by externalId", async () => {
    const sctx = await depthCtx("finance-topup8-sync");
    const acct = await lensRun("finance", "accounts-sync-link", { params: { institution: "Chase", name: "Plaid Checking", kind: "checking" } }, sctx);
    const accountId = acct.result.account.id;
    const batch = [
      { externalId: "t1", description: "Netflix", amount: -15.99, date: "2026-03-01" },
      { externalId: "t2", description: "Whole Foods", amount: -80, date: "2026-03-02" },
      { externalId: "t1", description: "Netflix", amount: -15.99, date: "2026-03-01" }, // dup
    ];
    const r = await lensRun("finance", "accounts-sync-pull", { params: { accountId, transactions: batch } }, sctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.added, 2);
    assert.equal(r.result.deduped, 1);
    // Netflix auto-categorised to Entertainment by the default categoriser
    assert.ok(r.result.transactions.some((t) => t.category === "Entertainment"));
  });

  it("accounts-sync-pull on a non-synced (plain) account is rejected", async () => {
    const sctx = await depthCtx("finance-topup8-sync-bad");
    const plain = await lensRun("finance", "accounts-link", { params: { institution: "X", name: "Plain", kind: "checking" } }, sctx);
    const bad = await lensRun("finance", "accounts-sync-pull", { params: { accountId: plain.result.account.id, transactions: [{ description: "a", amount: -1, date: "2026-01-01" }] } }, sctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("not sync-enabled"));
  });
});

describe("finance — cashflow-forecast + bill-reminders (wave 8 top-up)", () => {
  it("cashflow-forecast: finalBalance = startBalance + Σcredit − Σdebit (recomputed from the real series)", async () => {
    const cctx = await depthCtx("finance-topup8-forecast");
    await lensRun("finance", "monthly-income-set", { params: { monthlyIncome: 5000 } }, cctx);
    await lensRun("finance", "bills-add", { params: { name: "Rent", amount: 1800, dueDay: 15, cadence: "monthly" } }, cctx);
    const r = await lensRun("finance", "cashflow-forecast", { params: { horizonDays: 60, startBalance: 1000 } }, cctx);
    assert.equal(r.ok, true);
    // series length is exactly the horizon
    assert.equal(r.result.series.length, 60);
    // finalBalance is the start plus every credit minus every debit in the projected series.
    const recomputed = r.result.series.reduce((bal, s) => bal + s.credit - s.debit, r.result.startBalance);
    assert.equal(r.result.finalBalance, Math.round(recomputed * 100) / 100);
    // the monthly rent bill shows up as a 1800 debit on some day in the horizon
    assert.ok(r.result.series.some((s) => s.debit === 1800));
    // monthly income of 5000 credits on day 1 of the month
    assert.ok(r.result.series.some((s) => s.credit === 5000));
    // lowestBalance is the minimum balance point in the series
    assert.equal(r.result.lowestBalance, Math.min(...r.result.series.map((s) => s.balance)));
  });

  it("bill-reminders: a paid bill reads status 'paid' (no notify); an unpaid one surfaces", async () => {
    const bctx = await depthCtx("finance-topup8-reminders");
    const b1 = await lensRun("finance", "bills-add", { params: { name: "Water", amount: 60, dueDay: 10, cadence: "monthly" } }, bctx);
    const b2 = await lensRun("finance", "bills-add", { params: { name: "Internet", amount: 80, dueDay: 20, cadence: "monthly" } }, bctx);
    await lensRun("finance", "bills-pay", { params: { id: b1.result.bill.id } }, bctx);
    const r = await lensRun("finance", "bill-reminders", { params: { leadDays: 31 } }, bctx);
    assert.equal(r.ok, true);
    const water = r.result.reminders.find((x) => x.billId === b1.result.bill.id);
    // Water was paid this cycle → status paid, never an actionable notify
    assert.equal(water.status, "paid");
    assert.equal(water.notify, false);
    // Internet is unpaid; with a 31-day lead window every monthly bill is in scope
    const internet = r.result.reminders.find((x) => x.billId === b2.result.bill.id);
    assert.ok(["due_soon", "overdue"].includes(internet.status));
    assert.equal(internet.amount, 80);
  });

  it("bill-reminder-snooze on a missing bill is rejected", async () => {
    const bctx = await depthCtx("finance-topup8-snooze-bad");
    const bad = await lensRun("finance", "bill-reminder-snooze", { params: { id: "no-such-bill", days: 3 } }, bctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("bill not found"));
  });
});

describe("finance — holdings + accounts CRUD round-trips (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("finance-topup8-crud2"); });

  it("holdings-update-price recomputes value; holdings-remove deletes; list reflects both", async () => {
    const add = await lensRun("finance", "holdings-add", { params: { symbol: "MSFT", shares: 5, price: 100 } }, ctx);
    const holdId = add.result.holdings.find((h) => h.symbol === "MSFT").id;
    const upd = await lensRun("finance", "holdings-update-price", { params: { id: holdId, price: 250 } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.holding.price, 250);
    assert.equal(upd.result.holding.value, 1250);   // 5 * 250
    const rem = await lensRun("finance", "holdings-remove", { params: { id: holdId } }, ctx);
    assert.equal(rem.result.deleted, true);
    const list = await lensRun("finance", "holdings-list", {}, ctx);
    assert.equal(list.result.holdings.some((h) => h.id === holdId), false);
  });

  it("holdings-update-price rejects a negative price", async () => {
    const bad = await lensRun("finance", "holdings-update-price", { params: { id: "x", price: -1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("non-negative"));
  });

  it("accounts-update-balance writes through to accounts-list net worth", async () => {
    const actx = await depthCtx("finance-topup8-acctbal");
    const link = await lensRun("finance", "accounts-link", { params: { institution: "Ally", name: "Sav", kind: "savings", balance: 1000 } }, actx);
    const acctId = link.result.account.id;
    const upd = await lensRun("finance", "accounts-update-balance", { params: { id: acctId, balance: 4500 } }, actx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.account.balance, 4500);
    const list = await lensRun("finance", "accounts-list", {}, actx);
    const found = list.result.accounts.find((a) => a.id === acctId);
    assert.equal(found.balance, 4500);
    assert.equal(list.result.totalAssets, 4500);   // single positive account
    assert.equal(list.result.netWorth, 4500);
  });

  it("accounts-update-balance rejects a missing balance field", async () => {
    const actx = await depthCtx("finance-topup8-acctbal-bad");
    const link = await lensRun("finance", "accounts-link", { params: { institution: "Z", name: "Chk", kind: "checking", balance: 0 } }, actx);
    const bad = await lensRun("finance", "accounts-update-balance", { params: { id: link.result.account.id } }, actx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("balance required"));
  });
});

describe("finance — transactions edit + recurring DCA + monthly-income (wave 8 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("finance-topup8-txedit"); });

  it("transactions-recategorise overrides the auto category; list reads it back", async () => {
    const tx = await lensRun("finance", "transactions-ingest", { params: { description: "Some Cafe", amount: -25, date: "2026-04-01" } }, ctx);
    const txId = tx.result.transaction.id;
    assert.equal(tx.result.transaction.category, "Dining");   // ruleBasedCategorize: cafe → Dining
    const re = await lensRun("finance", "transactions-recategorise", { params: { id: txId, category: "Entertainment" } }, ctx);
    assert.equal(re.result.transaction.category, "Entertainment");
    assert.equal(re.result.transaction.categorySource, "manual");
    const list = await lensRun("finance", "transactions-list", {}, ctx);
    assert.equal(list.result.transactions.find((t) => t.id === txId).category, "Entertainment");
  });

  it("transactions-delete removes the row from the ledger", async () => {
    const tx = await lensRun("finance", "transactions-ingest", { params: { description: "Junk", amount: -9, date: "2026-04-02" } }, ctx);
    const txId = tx.result.transaction.id;
    const del = await lensRun("finance", "transactions-delete", { params: { id: txId } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("finance", "transactions-list", {}, ctx);
    assert.equal(list.result.transactions.some((t) => t.id === txId), false);
  });

  it("transactions-recategorise on a missing transaction is rejected", async () => {
    const bad = await lensRun("finance", "transactions-recategorise", { params: { id: "nope", category: "Food" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("transaction not found"));
  });

  it("recurring-create → recurring-pause toggles status → recurring-cancel deletes", async () => {
    const rctx = await depthCtx("finance-topup8-dca");
    const plan = await lensRun("finance", "recurring-create", { params: { symbol: "voo", amount: 500, cadence: "weekly" } }, rctx);
    assert.equal(plan.result.plan.symbol, "VOO");   // upcased
    assert.equal(plan.result.plan.status, "active");
    const planId = plan.result.plan.id;
    const paused = await lensRun("finance", "recurring-pause", { params: { id: planId } }, rctx);
    assert.equal(paused.result.plan.status, "paused");   // active → paused
    const resumed = await lensRun("finance", "recurring-pause", { params: { id: planId } }, rctx);
    assert.equal(resumed.result.plan.status, "active");  // paused → active (toggle)
    const cancel = await lensRun("finance", "recurring-cancel", { params: { id: planId } }, rctx);
    assert.equal(cancel.result.deleted, true);
    const list = await lensRun("finance", "recurring-list", {}, rctx);
    assert.equal(list.result.plans.some((p) => p.id === planId), false);
  });

  it("recurring-create without an amount is rejected", async () => {
    const rctx = await depthCtx("finance-topup8-dca-bad");
    const bad = await lensRun("finance", "recurring-create", { params: { symbol: "VTI" } }, rctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("symbol and amount required"));
  });

  it("monthly-income-set clamps a negative income to 0; envelopes-list reads it back", async () => {
    const mctx = await depthCtx("finance-topup8-income");
    const set = await lensRun("finance", "monthly-income-set", { params: { monthlyIncome: -200 } }, mctx);
    assert.equal(set.result.monthlyIncome, 0);   // Math.max(0, …)
    const set2 = await lensRun("finance", "monthly-income-set", { params: { monthlyIncome: 6200 } }, mctx);
    assert.equal(set2.result.monthlyIncome, 6200);
    const env = await lensRun("finance", "envelopes-list", {}, mctx);
    assert.equal(env.result.monthlyIncome, 6200);
  });
});

describe("finance — subscriptions + dividends-calendar + envelopes/household (wave 8 top-up)", () => {
  it("subscriptions-detect groups recurring Netflix debits into a monthly subscription", async () => {
    const sctx = await depthCtx("finance-topup8-subs");
    // 3 charges exactly 30 days apart at a stable amount → monthly cadence detected
    for (const date of ["2026-01-05", "2026-02-04", "2026-03-06"]) {
      await lensRun("finance", "transactions-ingest", { params: { description: "NETFLIX.COM", amount: -15.99, date } }, sctx);
    }
    const r = await lensRun("finance", "subscriptions-detect", {}, sctx);
    assert.equal(r.ok, true);
    const netflix = r.result.subscriptions.find((s) => s.category === "Entertainment");
    assert.ok(netflix);
    assert.equal(netflix.cadence, "monthly");
    assert.equal(netflix.chargeAmount, 15.99);
    assert.equal(netflix.monthlyAmount, 15.99);   // monthly cadence → no annualisation
    assert.equal(netflix.occurrences, 3);
    // subscriptions-cancel flips its status
    const cancel = await lensRun("finance", "subscriptions-cancel", { params: { id: netflix.id } }, sctx);
    assert.equal(cancel.result.status, "cancelled");
  });

  it("subscriptions-cancel on a missing subscription is rejected", async () => {
    const sctx = await depthCtx("finance-topup8-subs-bad");
    const bad = await lensRun("finance", "subscriptions-cancel", { params: { id: "sub_nope" } }, sctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("subscription not found"));
  });

  it("dividends-calendar: quarterly amount = value × yield / 4 per holding", async () => {
    const dctx = await depthCtx("finance-topup8-divcal");
    // value 10000 * 0.04 = 400 annual → 100 per quarter
    await lensRun("finance", "holdings-add", { params: { symbol: "SCHD", shares: 100, price: 100, dividendYield: 0.04 } }, dctx);
    const r = await lensRun("finance", "dividends-calendar", { params: { days: 365 } }, dctx);
    assert.equal(r.ok, true);
    const schdEvents = r.result.events.filter((e) => e.symbol === "SCHD");
    assert.ok(schdEvents.length >= 1);
    assert.ok(schdEvents.every((e) => e.amount === 100));
    assert.ok(schdEvents.every((e) => e.kind === "dividend"));
  });

  it("envelopes-create → envelopes-delete round-trips; delete on missing id rejects", async () => {
    const ectx = await depthCtx("finance-topup8-env");
    const env = await lensRun("finance", "envelopes-create", { params: { category: "Travel", monthlyTarget: 400 } }, ectx);
    const envId = env.result.envelope.id;
    assert.equal(env.result.envelope.monthlyTarget, 400);
    const del = await lensRun("finance", "envelopes-delete", { params: { id: envId } }, ectx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("finance", "envelopes-list", {}, ectx);
    assert.equal(list.result.envelopes.some((e) => e.id === envId), false);
    const bad = await lensRun("finance", "envelopes-delete", { params: { id: "no-env" } }, ectx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("envelope not found"));
  });

  it("household-add-member → household-remove-member round-trips; owner can't be removed", async () => {
    const hctx = await depthCtx("finance-topup8-hh");
    const create = await lensRun("finance", "household-create", { params: { name: "Doe Household" } }, hctx);
    const ownerId = create.result.household.ownerId;
    const add = await lensRun("finance", "household-add-member", { params: { memberId: "partner-42" } }, hctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.member.userId, "partner-42");
    assert.ok(add.result.household.members.some((m) => m.userId === "partner-42" && m.role === "member"));
    // removing the owner is rejected
    const badRm = await lensRun("finance", "household-remove-member", { params: { memberId: ownerId } }, hctx);
    assert.equal(badRm.result.ok, false);
    assert.ok(badRm.result.error.includes("owner"));
    // removing the added member succeeds + drops them from the roster
    const rm = await lensRun("finance", "household-remove-member", { params: { memberId: "partner-42" } }, hctx);
    assert.equal(rm.ok, true);
    assert.equal(rm.result.household.members.some((m) => m.userId === "partner-42"), false);
  });
});

// ════════════════════════════════════════════════════════════════════════
// finance — coverage top-up (previously-uncovered macros)
// ════════════════════════════════════════════════════════════════════════

describe("finance — delete-side CRUD round-trips (uncovered)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("finance-cov-deletes"); });

  it("bills-delete removes the bill; bills-list no longer carries it", async () => {
    const b = await lensRun("finance", "bills-add", { params: { name: "Trash Service", amount: 35, dueDay: 5, cadence: "monthly" } }, ctx);
    const billId = b.result.bill.id;
    const del = await lensRun("finance", "bills-delete", { params: { id: billId } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
    assert.equal(del.result.id, billId);
    const list = await lensRun("finance", "bills-list", {}, ctx);
    assert.equal(list.result.bills.some((x) => x.id === billId), false);
  });

  it("bills-delete on a missing id is rejected", async () => {
    const bad = await lensRun("finance", "bills-delete", { params: { id: "no-such-bill" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("bill not found"));
  });

  it("goals-delete removes the goal; goals-list no longer carries it", async () => {
    const g = await lensRun("finance", "goals-create", { params: { name: "Vacation", target: 5000, initialSaved: 1000 } }, ctx);
    const goalId = g.result.goal.id;
    const del = await lensRun("finance", "goals-delete", { params: { id: goalId } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("finance", "goals-list", {}, ctx);
    assert.equal(list.result.goals.some((x) => x.id === goalId), false);
  });

  it("goals-delete on a missing id is rejected", async () => {
    const bad = await lensRun("finance", "goals-delete", { params: { id: "nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("goal not found"));
  });

  it("credit-score-delete removes a logged reading; report drops it", async () => {
    const cctx = await depthCtx("finance-cov-csdel");
    const rec = await lensRun("finance", "credit-score-record", { params: { score: 700, date: "2026-02-01" } }, cctx);
    const entryId = rec.result.entry.id;
    const del = await lensRun("finance", "credit-score-delete", { params: { id: entryId } }, cctx);
    assert.equal(del.result.deleted, true);
    const report = await lensRun("finance", "credit-score-report", {}, cctx);
    // last reading deleted → history empty → report returns latest:null
    assert.equal(report.result.latest, null);
    assert.equal(report.result.history.length, 0);
  });

  it("credit-score-delete on a missing id is rejected", async () => {
    const cctx = await depthCtx("finance-cov-csdel-bad");
    const bad = await lensRun("finance", "credit-score-delete", { params: { id: "cs_nope" } }, cctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("entry not found"));
  });
});

describe("finance — categorisation rules: list + delete + default fallthrough (uncovered)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("finance-cov-rules"); });

  it("rules-create → rules-list reads it back; rules-delete drops it", async () => {
    const created = await lensRun("finance", "rules-create", { params: { matchText: "Sweetgreen", category: "Dining", matchKind: "contains", priority: 5 } }, ctx);
    const ruleId = created.result.rule.id;
    // rules-create lowercases matchText
    assert.equal(created.result.rule.matchText, "sweetgreen");
    const list = await lensRun("finance", "rules-list", {}, ctx);
    assert.ok(list.result.rules.some((r) => r.id === ruleId && r.category === "Dining"));
    const del = await lensRun("finance", "rules-delete", { params: { id: ruleId } }, ctx);
    assert.equal(del.result.deleted, true);
    const list2 = await lensRun("finance", "rules-list", {}, ctx);
    assert.equal(list2.result.rules.some((r) => r.id === ruleId), false);
  });

  it("rules-delete on a missing id is rejected", async () => {
    const bad = await lensRun("finance", "rules-delete", { params: { id: "rule_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("rule not found"));
  });

  it("rules-apply with no matching user rule falls through to the default categoriser", async () => {
    const rctx = await depthCtx("finance-cov-rules-fall");
    // no user rules; "Spotify" maps to Entertainment by the default ruleBasedCategorize
    const r = await lensRun("finance", "rules-apply", { params: { description: "SPOTIFY USA" } }, rctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.category, "Entertainment");
    assert.equal(r.result.source, "rules");
  });

  it("rules-apply honours starts_with match kind", async () => {
    const rctx = await depthCtx("finance-cov-rules-sw");
    await lensRun("finance", "rules-create", { params: { matchText: "ACME", category: "Shopping", matchKind: "starts_with", priority: 1 } }, rctx);
    const hit = await lensRun("finance", "rules-apply", { params: { description: "acme hardware store" } }, rctx);
    assert.equal(hit.result.category, "Shopping");
    assert.equal(hit.result.source, "user_rule");
    // a description that doesn't START with acme should NOT match the rule
    const miss = await lensRun("finance", "rules-apply", { params: { description: "buy from acme later" } }, rctx);
    assert.equal(miss.result.source, "rules");   // fell through to default
  });
});

describe("finance — household-get + rollover-rule list/delete (uncovered)", () => {
  it("household-get returns null before create, then the created household after", async () => {
    const hctx = await depthCtx("finance-cov-hhget");
    const before = await lensRun("finance", "household-get", {}, hctx);
    assert.equal(before.ok, true);
    assert.equal(before.result.household, null);
    const create = await lensRun("finance", "household-create", { params: { name: "Get Household" } }, hctx);
    const after = await lensRun("finance", "household-get", {}, hctx);
    assert.equal(after.result.household.id, create.result.household.id);
    assert.equal(after.result.household.name, "Get Household");
  });

  it("rollover-rule-set → rollover-rules-list reads it back; rollover-rule-delete drops it", async () => {
    const ectx = await depthCtx("finance-cov-roll-crud");
    const env = await lensRun("finance", "envelopes-create", { params: { category: "Gifts", monthlyTarget: 200 } }, ectx);
    const envelopeId = env.result.envelope.id;
    const setR = await lensRun("finance", "rollover-rule-set", { params: { envelopeId, mode: "full" } }, ectx);
    const ruleId = setR.result.rule.id;
    assert.equal(setR.result.rule.mode, "full");
    const list = await lensRun("finance", "rollover-rules-list", {}, ectx);
    assert.ok(list.result.rules.some((r) => r.id === ruleId && r.envelopeId === envelopeId));
    const del = await lensRun("finance", "rollover-rule-delete", { params: { id: ruleId } }, ectx);
    assert.equal(del.result.deleted, true);
    const list2 = await lensRun("finance", "rollover-rules-list", {}, ectx);
    assert.equal(list2.result.rules.some((r) => r.id === ruleId), false);
  });

  it("rollover-rule-set is upsert — a second set on the same envelope mutates in place", async () => {
    const ectx = await depthCtx("finance-cov-roll-upsert");
    const env = await lensRun("finance", "envelopes-create", { params: { category: "Hobbies", monthlyTarget: 150 } }, ectx);
    const envelopeId = env.result.envelope.id;
    const first = await lensRun("finance", "rollover-rule-set", { params: { envelopeId, mode: "full" } }, ectx);
    const second = await lensRun("finance", "rollover-rule-set", { params: { envelopeId, mode: "capped", cap: 50 } }, ectx);
    assert.equal(first.result.rule.id, second.result.rule.id);   // same rule mutated, not a new one
    assert.equal(second.result.rule.mode, "capped");
    assert.equal(second.result.rule.cap, 50);
    const list = await lensRun("finance", "rollover-rules-list", {}, ectx);
    assert.equal(list.result.rules.filter((r) => r.envelopeId === envelopeId).length, 1);
  });

  it("rollover-rule-delete on a missing id is rejected", async () => {
    const ectx = await depthCtx("finance-cov-roll-del-bad");
    const bad = await lensRun("finance", "rollover-rule-delete", { params: { id: "rr_nope" } }, ectx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("rule not found"));
  });
});

describe("finance — earnings-calendar + retirement-monte-carlo (uncovered)", () => {
  it("earnings-calendar: one deterministic-dated event per held ticker within the horizon", async () => {
    const ectx = await depthCtx("finance-cov-earn");
    await lensRun("finance", "holdings-add", { params: { symbol: "AAPL", shares: 10, price: 100 } }, ectx);
    await lensRun("finance", "holdings-add", { params: { symbol: "MSFT", shares: 5, price: 200 } }, ectx);
    const r = await lensRun("finance", "earnings-calendar", { params: { days: 90 } }, ectx);
    assert.equal(r.ok, true);
    assert.equal(r.result.days, 90);
    // exactly one event per holding
    assert.equal(r.result.events.length, 2);
    assert.ok(r.result.events.some((e) => e.symbol === "AAPL"));
    assert.ok(r.result.events.some((e) => e.symbol === "MSFT"));
    // each event carries a before/after-market session + a numeric EPS estimate
    assert.ok(r.result.events.every((e) => ["after_market", "before_market"].includes(e.when)));
    assert.ok(r.result.events.every((e) => typeof e.estimateEps === "number"));
    // events are sorted ascending by date
    const dates = r.result.events.map((e) => e.date);
    assert.deepEqual(dates, [...dates].sort((a, b) => a.localeCompare(b)));
  });

  it("earnings-calendar on an empty portfolio yields no events", async () => {
    const ectx = await depthCtx("finance-cov-earn-empty");
    const r = await lensRun("finance", "earnings-calendar", {}, ectx);
    assert.equal(r.ok, true);
    assert.equal(r.result.events.length, 0);
    assert.equal(r.result.days, 90);   // default horizon
  });

  it("retirement-monte-carlo: clamps + simulates the full life horizon with a valid success probability", async () => {
    const r = await lensRun("finance", "retirement-monte-carlo", { params: {
      currentAge: 40, retireAge: 65, currentSavings: 500000, annualContribution: 20000,
      expectedReturn: 0.06, volatility: 0.12, annualSpendInRetirement: 40000, paths: 200,
    } });
    assert.equal(r.ok, true);
    // years = livesTo(95) − currentAge(40) = 55
    assert.equal(r.result.years, 55);
    assert.equal(r.result.paths, 200);
    // success probability is a fraction in [0,1]
    assert.ok(r.result.successProbability >= 0 && r.result.successProbability <= 1);
    // ordered percentiles: p10 ≤ median ≤ p90
    assert.ok(r.result.p10Final <= r.result.medianFinalBalance);
    assert.ok(r.result.medianFinalBalance <= r.result.p90Final);
  });

  it("retirement-monte-carlo clamps a retireAge ≤ currentAge up to currentAge+1", async () => {
    const r = await lensRun("finance", "retirement-monte-carlo", { params: {
      currentAge: 60, retireAge: 50, currentSavings: 100000, paths: 100,
    } });
    assert.equal(r.ok, true);
    // currentAge clamps within [18,90]=60; years = 95 − 60 = 35; paths floored at 100
    assert.equal(r.result.years, 35);
    assert.equal(r.result.paths, 100);
  });
});

describe("finance — LLM macros fall back deterministically under no-egress (uncovered)", () => {
  it("categorize-transaction yields the rule-based category when the brain is unreachable", async () => {
    // ctx.llm.chat is present but the brain host is non-loopback → blocked → catch → rule fallback.
    const r = await lensRun("finance", "categorize-transaction", { params: { description: "WHOLE FOODS MARKET", amount: -64.20 } });
    assert.equal(r.ok, true);
    // ruleBasedCategorize maps "whole foods" → Groceries regardless of which fallback branch ran
    assert.equal(r.result.category, "Groceries");
    assert.ok(["rules", "utility-brain"].includes(r.result.source));
    assert.ok(typeof r.result.confidence === "number" && r.result.confidence > 0 && r.result.confidence <= 1);
  });

  it("categorize-transaction rejects an empty description", async () => {
    const bad = await lensRun("finance", "categorize-transaction", { params: { description: "  ", amount: -10 } });
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("description required"));
  });

  it("weekly-commentary round-trips the week param and never flags error when the brain resolves", async () => {
    const r = await lensRun("finance", "weekly-commentary", { params: { week: "2026-W10", totalSpent: 1200, totalIncome: 4000, topCategories: [{ category: "Dining", amount: 300 }] } });
    assert.equal(r.ok, true);
    // the requested week echoes back verbatim
    assert.equal(r.result.week, "2026-W10");
    assert.equal(typeof r.result.text, "string");
    // a resolved chat (even empty under no-egress) is NOT the catch-branch error payload
    assert.notEqual(r.result.error, true);
  });

  it("assistant-ask rejects an empty question, then answers from the conscious brain when asked", async () => {
    const actx = await depthCtx("finance-cov-assistant");
    const bad = await lensRun("finance", "assistant-ask", { params: { question: "   " } }, actx);
    assert.equal(bad.result.ok, false);
    assert.ok(bad.result.error.includes("question required"));
    const r = await lensRun("finance", "assistant-ask", { params: { question: "How much do I have invested?" } }, actx);
    assert.equal(r.ok, true);
    assert.equal(typeof r.result.answer, "string");
    // chat resolved → tagged conscious-brain, not the fallback/error branch
    assert.equal(r.result.source, "conscious-brain");
    assert.notEqual(r.result.error, true);
  });
});
