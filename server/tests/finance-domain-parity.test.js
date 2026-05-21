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

describe("finance.net-worth-history (real user snapshots only)", () => {
  it("returns empty array + setup hint when no snapshots logged", () => {
    const r = call("net-worth-history", ctxA, { range: "1Y" });
    assert.equal(r.ok, true);
    assert.equal(r.result.snapshots.length, 0);
    assert.match(r.result.notes, /No snapshots logged/);
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

describe("finance.investment-checkup (real holdings required)", () => {
  it("returns error when user has no holdings (no SAMPLE_PORTFOLIO fallback)", () => {
    const r = call("investment-checkup", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /no holdings/);
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

describe("finance.subscriptions-detect + cancel (real ledger, no seed)", () => {
  it("empty ledger detects zero subscriptions (no synthetic seed)", () => {
    const r = call("subscriptions-detect", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.subscriptions.length, 0);
  });

  it("detects a recurring monthly charge from the real ledger", () => {
    // Three monthly Netflix debits → one detected subscription.
    call("transactions-ingest", ctxA, { description: "NETFLIX.COM", amount: -15.49, date: "2026-01-05" });
    call("transactions-ingest", ctxA, { description: "NETFLIX.COM 8009999", amount: -15.49, date: "2026-02-05" });
    call("transactions-ingest", ctxA, { description: "Netflix.com", amount: -15.49, date: "2026-03-05" });
    const r = call("subscriptions-detect", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.subscriptions.length, 1);
    const sub = r.result.subscriptions[0];
    assert.equal(sub.cadence, "monthly");
    assert.equal(sub.occurrences, 3);
    assert.ok(Math.abs(sub.monthlyAmount - 15.49) < 0.5);
  });

  it("cancel marks a detected subscription as cancelled and persists across re-detect", () => {
    call("transactions-ingest", ctxA, { description: "SPOTIFY USA", amount: -10.99, date: "2026-01-10" });
    call("transactions-ingest", ctxA, { description: "SPOTIFY USA", amount: -10.99, date: "2026-02-10" });
    const r = call("subscriptions-detect", ctxA, {});
    const first = r.result.subscriptions[0];
    const cancelled = call("subscriptions-cancel", ctxA, { id: first.id });
    assert.equal(cancelled.ok, true);
    const after = call("subscriptions-detect", ctxA, {});
    assert.equal(after.result.subscriptions.find(s => s.id === first.id).status, "cancelled");
  });

  it("rejects unknown subscription id", () => {
    assert.equal(call("subscriptions-cancel", ctxA, { id: "nope" }).ok, false);
  });

  it("ignores one-off charges and unstable amounts", () => {
    call("transactions-ingest", ctxA, { description: "Random Store", amount: -50, date: "2026-01-01" });
    const r = call("subscriptions-detect", ctxA, {});
    assert.equal(r.result.subscriptions.length, 0);
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

describe("finance.bills-* + cashflow-forecast (full-app sprint)", () => {
  it("add / list / pay / delete cycle, per-user scoped", () => {
    const add = call("bills-add", ctxA, { name: "Electric", amount: 120, dueDay: 15, cadence: "monthly" });
    assert.equal(add.ok, true);
    const id = add.result.bill.id;
    const list = call("bills-list", ctxA, {});
    assert.equal(list.result.bills.length, 1);
    assert.equal(call("bills-list", ctxB, {}).result.bills.length, 0);
    const paid = call("bills-pay", ctxA, { id });
    assert.equal(paid.result.bill.paidThisCycle, true);
    const del = call("bills-delete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(call("bills-list", ctxA, {}).result.bills.length, 0);
  });
  it("rejects empty bill name", () => {
    assert.equal(call("bills-add", ctxA, { name: "", amount: 50 }).ok, false);
  });
  it("cashflow-forecast projects horizon with bills + income, flags negative", () => {
    call("monthly-income-set", ctxA, { monthlyIncome: 5000 });
    call("bills-add", ctxA, { name: "Rent", amount: 2000, dueDay: 1, cadence: "monthly" });
    call("bills-add", ctxA, { name: "Internet", amount: 80, dueDay: 5, cadence: "monthly" });
    const r = call("cashflow-forecast", ctxA, { startBalance: 1000, horizonDays: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.series.length, 60);
    assert.ok(typeof r.result.lowestBalance === "number");
    assert.ok(typeof r.result.finalBalance === "number");
  });
  it("clamps horizonDays to [7,180]", () => {
    const r = call("cashflow-forecast", ctxA, { horizonDays: 9999 });
    assert.equal(r.result.series.length, 180);
  });
});

describe("finance.goals-* (full-app sprint)", () => {
  it("create / list / contribute / delete cycle with ETA math", () => {
    const created = call("goals-create", ctxA, { name: "Emergency fund", target: 10000, monthlyContribution: 500 });
    assert.equal(created.ok, true);
    const id = created.result.goal.id;
    const listed = call("goals-list", ctxA, {});
    assert.equal(listed.result.goals.length, 1);
    assert.equal(listed.result.goals[0].monthsAtRate, 20);
    assert.equal(listed.result.goals[0].progressPct, 0);
    const c = call("goals-contribute", ctxA, { id, amount: 2500 });
    assert.equal(c.result.goal.saved, 2500);
    const after = call("goals-list", ctxA, {});
    assert.equal(after.result.goals[0].progressPct, 25);
    assert.equal(after.result.goals[0].monthsAtRate, 15);
    const del = call("goals-delete", ctxA, { id });
    assert.equal(del.ok, true);
  });
  it("rejects empty goal name and unknown id", () => {
    assert.equal(call("goals-create", ctxA, { name: "" }).ok, false);
    assert.equal(call("goals-contribute", ctxA, { id: "nope", amount: 100 }).ok, false);
  });
  it("null ETA when no monthly contribution", () => {
    const g = call("goals-create", ctxA, { name: "House", target: 100000, monthlyContribution: 0 });
    const list = call("goals-list", ctxA, {});
    assert.equal(list.result.goals.find(x => x.id === g.result.goal.id).monthsAtRate, null);
  });
});

describe("finance.recurring-* (DCA plans)", () => {
  it("create / list / pause / cancel cycle", () => {
    const created = call("recurring-create", ctxA, { symbol: "vti", amount: 500, cadence: "monthly" });
    assert.equal(created.ok, true);
    assert.equal(created.result.plan.symbol, "VTI");
    assert.equal(created.result.plan.status, "active");
    const id = created.result.plan.id;
    const paused = call("recurring-pause", ctxA, { id });
    assert.equal(paused.result.plan.status, "paused");
    const resumed = call("recurring-pause", ctxA, { id });
    assert.equal(resumed.result.plan.status, "active");
    const cancelled = call("recurring-cancel", ctxA, { id });
    assert.equal(cancelled.ok, true);
    assert.equal(call("recurring-list", ctxA, {}).result.plans.length, 0);
  });
  it("rejects invalid symbol/amount", () => {
    assert.equal(call("recurring-create", ctxA, { symbol: "", amount: 100 }).ok, false);
    assert.equal(call("recurring-create", ctxA, { symbol: "VTI", amount: 0 }).ok, false);
  });
});

describe("finance.holdings-* (CRUD unblocks investment-checkup)", () => {
  it("add merges into existing position, recomputes cost basis", () => {
    call("holdings-add", ctxA, { symbol: "VTI", shares: 10, price: 200, assetClass: "equity_us" });
    call("holdings-add", ctxA, { symbol: "VTI", shares: 10, price: 240 });
    const list = call("holdings-list", ctxA, {});
    assert.equal(list.result.holdings.length, 1);
    const h = list.result.holdings[0];
    assert.equal(h.shares, 20);
    assert.equal(h.costBasis, 220);
  });
  it("update-price refreshes value", () => {
    const added = call("holdings-add", ctxA, { symbol: "AAPL", shares: 5, price: 100 });
    const id = added.result.holdings.find(h => h.symbol === "AAPL").id;
    call("holdings-update-price", ctxA, { id, price: 150 });
    const list = call("holdings-list", ctxA, {});
    assert.equal(list.result.holdings.find(h => h.symbol === "AAPL").value, 750);
  });
  it("remove deletes by id", () => {
    const added = call("holdings-add", ctxA, { symbol: "BND", shares: 100, price: 75 });
    const id = added.result.holdings.find(h => h.symbol === "BND").id;
    const del = call("holdings-remove", ctxA, { id });
    assert.equal(del.ok, true);
  });
  it("investment-checkup now succeeds with real holdings", () => {
    call("holdings-add", ctxA, { symbol: "VTI", shares: 50, price: 200, assetClass: "equity_us", sector: "Total", feeCategory: "total_market", expenseRatio: 0.0003 });
    call("holdings-add", ctxA, { symbol: "VXUS", shares: 20, price: 60, assetClass: "equity_intl", sector: "Intl" });
    const r = call("investment-checkup", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.score >= 0 && r.result.score <= 100);
  });
});

describe("finance.dividends-* + earnings-calendar", () => {
  it("summary returns zero when no dividend-paying holdings", () => {
    const r = call("dividends-summary", ctxA, {});
    assert.equal(r.result.totalAnnual, 0);
  });
  it("summary aggregates per-holding yield", () => {
    call("holdings-add", ctxA, { symbol: "SCHD", shares: 100, price: 80, dividendYield: 0.035 });
    const r = call("dividends-summary", ctxA, {});
    assert.equal(r.result.perHolding.length, 1);
    assert.ok(r.result.totalAnnual > 0);
    assert.ok(r.result.monthlyAverage > 0);
  });
  it("calendar produces forward-dated quarterly events", () => {
    call("holdings-add", ctxA, { symbol: "VYM", shares: 50, price: 120, dividendYield: 0.03 });
    const r = call("dividends-calendar", ctxA, { days: 365 });
    assert.ok(r.result.events.length >= 4);
    for (const e of r.result.events) {
      assert.equal(e.kind, "dividend");
      assert.ok(e.amount > 0);
    }
  });
  it("earnings-calendar yields one event per holding sorted by date", () => {
    call("holdings-add", ctxA, { symbol: "AAPL", shares: 10, price: 200 });
    call("holdings-add", ctxA, { symbol: "MSFT", shares: 5, price: 400 });
    const r = call("earnings-calendar", ctxA, { days: 90 });
    assert.equal(r.result.events.length, 2);
    if (r.result.events.length >= 2) {
      assert.ok(r.result.events[0].date <= r.result.events[1].date);
    }
  });
});

describe("finance.spending-insights", () => {
  it("computes MoM trends and flags anomalies", () => {
    const tx = [
      { date: "2026-03-01", description: "Whole Foods", amount: 100, category: "Groceries" },
      { date: "2026-03-02", description: "Trader Joe's", amount: 80, category: "Groceries" },
      { date: "2026-04-01", description: "Whole Foods", amount: 100, category: "Groceries" },
      { date: "2026-04-15", description: "Whole Foods", amount: 200, category: "Groceries" },
      { date: "2026-04-20", description: "Whole Foods", amount: 300, category: "Groceries" },
      { date: "2026-03-10", description: "Coffee", amount: 30, category: "Dining" },
      { date: "2026-04-10", description: "Coffee", amount: 35, category: "Dining" },
    ];
    const r = call("spending-insights", ctxA, { transactions: tx });
    assert.equal(r.ok, true);
    assert.equal(r.result.latestMonth, "2026-04");
    assert.equal(r.result.priorMonth, "2026-03");
    const grocery = r.result.trends.find(t => t.category === "Groceries");
    assert.ok(grocery.delta > 0);
    assert.ok(grocery.anomaly);
  });
  it("empty transactions returns empty trends", () => {
    const r = call("spending-insights", ctxA, { transactions: [] });
    assert.equal(r.result.trends.length, 0);
  });
});

describe("finance.rules-* (user categorisation rules)", () => {
  it("user rule overrides built-in categorisation", () => {
    call("rules-create", ctxA, { matchText: "blue bottle", category: "Coffee Shops" });
    const r = call("rules-apply", ctxA, { description: "BLUE BOTTLE COFFEE BERKELEY" });
    assert.equal(r.result.category, "Coffee Shops");
    assert.equal(r.result.source, "user_rule");
  });
  it("falls back to rules-based when no user rule matches", () => {
    const r = call("rules-apply", ctxA, { description: "Whole Foods Market" });
    assert.equal(r.result.category, "Groceries");
    assert.equal(r.result.source, "rules");
  });
  it("regex matchKind works", () => {
    call("rules-create", ctxA, { matchText: "^uber", matchKind: "regex", category: "Rideshare" });
    const r = call("rules-apply", ctxA, { description: "UBER TRIP 4928" });
    assert.equal(r.result.category, "Rideshare");
  });
  it("delete removes the rule", () => {
    const c = call("rules-create", ctxA, { matchText: "starbucks", category: "Coffee" });
    const del = call("rules-delete", ctxA, { id: c.result.rule.id });
    assert.equal(del.ok, true);
    assert.equal(call("rules-list", ctxA, {}).result.rules.length, 0);
  });
  it("rejects empty matchText or category", () => {
    assert.equal(call("rules-create", ctxA, { matchText: "", category: "X" }).ok, false);
    assert.equal(call("rules-create", ctxA, { matchText: "X", category: "" }).ok, false);
  });
});

describe("finance.tax-loss-candidates", () => {
  it("returns no candidates when all positions are gains", () => {
    call("holdings-add", ctxA, { symbol: "VTI", shares: 10, price: 200 });
    const added = call("holdings-list", ctxA, {});
    const id = added.result.holdings[0].id;
    call("holdings-update-price", ctxA, { id, price: 250 });
    const r = call("tax-loss-candidates", ctxA, {});
    assert.equal(r.result.candidates.length, 0);
  });
  it("flags positions with losses ≥ minLoss as harvestable", () => {
    call("holdings-add", ctxA, { symbol: "META", shares: 10, price: 500 });
    const list = call("holdings-list", ctxA, {});
    const id = list.result.holdings.find(h => h.symbol === "META").id;
    call("holdings-update-price", ctxA, { id, price: 400 });
    const r = call("tax-loss-candidates", ctxA, { minLoss: 100 });
    assert.equal(r.result.candidates.length, 1);
    assert.ok(r.result.totalHarvestableLoss > 0);
    assert.ok(r.result.estimatedTaxBenefit > 0);
  });
});

describe("finance.accounts-* (linked accounts panel)", () => {
  it("link / list / update-balance / unlink cycle", () => {
    const linked = call("accounts-link", ctxA, { institution: "Chase", name: "Total Checking", kind: "checking", balance: 5400 });
    assert.equal(linked.ok, true);
    const id = linked.result.account.id;
    const list = call("accounts-list", ctxA, {});
    assert.equal(list.result.accounts.length, 1);
    assert.equal(list.result.totalAssets, 5400);
    const upd = call("accounts-update-balance", ctxA, { id, balance: 6000 });
    assert.equal(upd.result.account.balance, 6000);
    const del = call("accounts-unlink", ctxA, { id });
    assert.equal(del.ok, true);
  });
  it("net-worth math: assets minus credit minus loans", () => {
    call("accounts-link", ctxA, { institution: "Chase", name: "Checking", kind: "checking", balance: 10000 });
    call("accounts-link", ctxA, { institution: "Amex", name: "Gold", kind: "credit", balance: -2000 });
    call("accounts-link", ctxA, { institution: "Wells", name: "Mortgage", kind: "mortgage", balance: -250000 });
    const r = call("accounts-list", ctxA, {});
    assert.equal(r.result.totalAssets, 10000);
    assert.equal(r.result.totalLiabilities, 252000);
    assert.equal(r.result.netWorth, -242000);
  });
  it("rejects missing institution or name", () => {
    assert.equal(call("accounts-link", ctxA, { institution: "", name: "X" }).ok, false);
    assert.equal(call("accounts-link", ctxA, { institution: "X", name: "" }).ok, false);
  });
});

describe("finance.assistant-ask", () => {
  it("graceful fallback when LLM unavailable", async () => {
    const r = await call("assistant-ask", ctxA, { question: "Should I increase savings?" });
    assert.equal(r.ok, true);
    assert.match(r.result.answer, /LLM offline|fallback/i);
  });
  it("rejects empty question", async () => {
    const r = await call("assistant-ask", ctxA, { question: "" });
    assert.equal(r.ok, false);
  });
  it("uses conscious brain when available and grounds in user context", async () => {
    call("holdings-add", ctxA, { symbol: "VTI", shares: 50, price: 200 });
    call("goals-create", ctxA, { name: "House", target: 100000, monthlyContribution: 1000 });
    const ctx = {
      actor: { userId: userA }, userId: userA,
      llm: { chat: async ({ messages }) => {
        const userMsg = messages.find(m => m.role === "user").content;
        assert.match(userMsg, /Portfolio value/);
        assert.match(userMsg, /House/);
        return { text: "Based on your $10,000 portfolio and House goal, consider increasing contribution by $200/mo." };
      }},
    };
    const r = await call("assistant-ask", ctx, { question: "How can I save more for my house?" });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "conscious-brain");
  });
});

describe("finance.dashboard-summary (FinanceShell data source)", () => {
  it("aggregates cash / investments / credit / loans into net worth", () => {
    call("accounts-link", ctxA, { institution: "Chase", name: "Checking", kind: "checking", balance: 5000 });
    call("accounts-link", ctxA, { institution: "Ally", name: "Savings", kind: "savings", balance: 15000 });
    call("accounts-link", ctxA, { institution: "Amex", name: "Gold", kind: "credit", balance: -1500 });
    call("holdings-add", ctxA, { symbol: "VTI", shares: 50, price: 200 });
    call("bills-add", ctxA, { name: "Rent", amount: 2000, dueDay: 1 });
    const r = call("dashboard-summary", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.breakdown.cash, 20000);
    assert.equal(r.result.breakdown.investments, 10000);
    assert.equal(r.result.breakdown.credit, 1500);
    assert.equal(r.result.netWorth, 28500);
    assert.equal(r.result.buyingPower, 20000);
    assert.equal(r.result.accountCount, 3);
    assert.equal(r.result.positionCount, 1);
  });
  it("empty state returns zeros without crashing", () => {
    const r = call("dashboard-summary", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.netWorth, 0);
  });
});

// ═══ Parity backlog (Monarch / Empower gap) — 7 buildable items ═══════

describe("backlog 1 — bank aggregation (accounts-sync-link / -pull)", () => {
  it("sync-link records a sync-enabled account", () => {
    const r = call("accounts-sync-link", ctxA, { institution: "Chase", name: "Checking", kind: "checking", balance: 4000, provider: "plaid" });
    assert.equal(r.ok, true);
    assert.equal(r.result.account.synced, true);
    assert.equal(r.result.account.provider, "plaid");
    assert.equal(r.result.syncEnabled, true);
  });
  it("sync-pull ingests + auto-categorises a transaction batch into the ledger", () => {
    const linked = call("accounts-sync-link", ctxA, { institution: "Ally", name: "Savings", kind: "savings" });
    const acctId = linked.result.account.id;
    const r = call("accounts-sync-pull", ctxA, {
      accountId: acctId,
      transactions: [
        { description: "Whole Foods Market", amount: -82.10, date: "2026-05-01" },
        { description: "Payroll Deposit", amount: 3000, date: "2026-05-01" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.added, 2);
    assert.ok(r.result.transactions.every(t => t.autoCategorised));
    assert.equal(r.result.transactions.find(t => t.amount < 0).category, "Groceries");
  });
  it("sync-pull dedupes by externalId on re-sync", () => {
    const linked = call("accounts-sync-link", ctxA, { institution: "Chase", name: "Checking" });
    const acctId = linked.result.account.id;
    const batch = [{ externalId: "ext-1", description: "Netflix", amount: -15.49, date: "2026-05-02" }];
    const first = call("accounts-sync-pull", ctxA, { accountId: acctId, transactions: batch });
    assert.equal(first.result.added, 1);
    const second = call("accounts-sync-pull", ctxA, { accountId: acctId, transactions: batch });
    assert.equal(second.result.added, 0);
    assert.equal(second.result.deduped, 1);
  });
  it("sync-pull rejects a non-synced account", () => {
    const manual = call("accounts-link", ctxA, { institution: "Manual", name: "Cash" });
    const r = call("accounts-sync-pull", ctxA, { accountId: manual.result.account.id, transactions: [{ description: "x", amount: -1 }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /not sync-enabled/);
  });
});

describe("backlog 2 — transaction feed + auto-categorisation", () => {
  it("ingest auto-categorises when no category passed", () => {
    const r = call("transactions-ingest", ctxA, { description: "UBER TRIP", amount: -24.50, date: "2026-05-03" });
    assert.equal(r.ok, true);
    assert.equal(r.result.transaction.category, "Transportation");
    assert.equal(r.result.transaction.autoCategorised, true);
    assert.equal(r.result.transaction.categorySource, "rules");
  });
  it("ingest honours an explicit category", () => {
    const r = call("transactions-ingest", ctxA, { description: "Mystery", amount: -5, category: "Gifts" });
    assert.equal(r.result.transaction.category, "Gifts");
    assert.equal(r.result.transaction.autoCategorised, false);
  });
  it("list returns spend + income totals; recategorise + delete work", () => {
    call("transactions-ingest", ctxA, { description: "Payroll", amount: 5000, date: "2026-05-01" });
    const ing = call("transactions-ingest", ctxA, { description: "Coffee", amount: -6, date: "2026-05-02" });
    const list = call("transactions-list", ctxA, {});
    assert.equal(list.result.count, 2);
    assert.equal(list.result.totalIncome, 5000);
    assert.equal(list.result.totalSpend, 6);
    const recat = call("transactions-recategorise", ctxA, { id: ing.result.transaction.id, category: "Dining" });
    assert.equal(recat.result.transaction.category, "Dining");
    assert.equal(recat.result.transaction.categorySource, "manual");
    const del = call("transactions-delete", ctxA, { id: ing.result.transaction.id });
    assert.equal(del.ok, true);
    assert.equal(call("transactions-list", ctxA, {}).result.count, 1);
  });
  it("a user rule applies at ingest time", () => {
    call("rules-create", ctxA, { matchText: "acme gym", category: "Fitness" });
    const r = call("transactions-ingest", ctxA, { description: "ACME GYM MEMBERSHIP", amount: -40 });
    assert.equal(r.result.transaction.category, "Fitness");
    assert.equal(r.result.transaction.categorySource, "user_rule");
  });
});

describe("backlog 3 — household shared budgets", () => {
  it("create / add-member / shared budget spend cycle, per-user scoped", () => {
    const hh = call("household-create", ctxA, { name: "Smith Household" });
    assert.equal(hh.ok, true);
    assert.equal(hh.result.household.members.length, 1);
    const add = call("household-add-member", ctxA, { memberId: userB });
    assert.equal(add.ok, true);
    assert.equal(add.result.household.members.length, 2);
    const budget = call("household-budget-create", ctxA, { category: "Groceries", monthlyTarget: 800 });
    assert.equal(budget.ok, true);
    const spend = call("household-budget-spend", ctxA, { budgetId: budget.result.budget.id, amount: 300 });
    assert.equal(spend.result.budget.spent, 300);
    assert.equal(spend.result.remaining, 500);
    assert.equal(spend.result.overBudget, false);
  });
  it("rejects duplicate household and unknown member ops", () => {
    call("household-create", ctxA, { name: "A" });
    assert.equal(call("household-create", ctxA, { name: "B" }).ok, false);
    assert.equal(call("household-add-member", ctxB, { memberId: "x" }).ok, false);
  });
  it("cannot remove the household owner", () => {
    call("household-create", ctxA, { name: "A" });
    assert.equal(call("household-remove-member", ctxA, { memberId: userA }).ok, false);
  });
});

describe("backlog 4 — credit-score monitoring", () => {
  it("record / report computes band, delta and advice", () => {
    call("credit-score-record", ctxA, { score: 690, bureau: "fico", date: "2026-01-01", utilisationPct: 45 });
    call("credit-score-record", ctxA, { score: 720, bureau: "fico", date: "2026-04-01", utilisationPct: 22 });
    const r = call("credit-score-report", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.latest.score, 720);
    assert.equal(r.result.band, "good");
    assert.equal(r.result.delta, 30);
    assert.equal(r.result.deltaFromPrior, 30);
  });
  it("flags high utilisation in advice", () => {
    call("credit-score-record", ctxA, { score: 650, utilisationPct: 60 });
    const r = call("credit-score-report", ctxA, {});
    assert.ok(r.result.advice.some(a => /utilisation/i.test(a)));
  });
  it("rejects out-of-range score; empty report has no latest", () => {
    assert.equal(call("credit-score-record", ctxA, { score: 200 }).ok, false);
    assert.equal(call("credit-score-report", ctxA, {}).result.latest, null);
  });
  it("delete removes a reading", () => {
    const rec = call("credit-score-record", ctxA, { score: 700 });
    const del = call("credit-score-delete", ctxA, { id: rec.result.entry.id });
    assert.equal(del.ok, true);
    assert.equal(call("credit-score-report", ctxA, {}).result.history.length, 0);
  });
});

describe("backlog 5 — cash-flow Sankey + monthly trend", () => {
  it("cashflow-sankey builds income → spending → category links from the ledger", () => {
    call("transactions-ingest", ctxA, { description: "Payroll", amount: 5000, date: "2026-05-01" });
    call("transactions-ingest", ctxA, { description: "Whole Foods", amount: -400, date: "2026-05-02" });
    call("transactions-ingest", ctxA, { description: "Shell Gas", amount: -80, date: "2026-05-03" });
    const r = call("cashflow-sankey", ctxA, { month: "2026-05" });
    assert.equal(r.ok, true);
    assert.equal(r.result.income, 5000);
    assert.equal(r.result.totalSpend, 480);
    assert.equal(r.result.netCashFlow, 4520);
    assert.ok(r.result.nodes.some(n => n.id === "spending"));
    assert.ok(r.result.links.some(l => l.source === "income" && l.target === "savings"));
  });
  it("monthly-trend produces a per-month income/spend/net series", () => {
    call("transactions-ingest", ctxA, { description: "Payroll", amount: 4000, date: "2026-03-01" });
    call("transactions-ingest", ctxA, { description: "Rent", amount: -1500, date: "2026-03-02" });
    call("transactions-ingest", ctxA, { description: "Payroll", amount: 4000, date: "2026-04-01" });
    call("transactions-ingest", ctxA, { description: "Rent", amount: -1500, date: "2026-04-02" });
    const r = call("monthly-trend", ctxA, { months: 12 });
    assert.equal(r.ok, true);
    assert.equal(r.result.series.length, 2);
    assert.equal(r.result.series[0].net, 2500);
    assert.equal(r.result.avgMonthlyIncome, 4000);
  });
  it("empty ledger trend returns empty series", () => {
    assert.equal(call("monthly-trend", ctxA, {}).result.series.length, 0);
  });
});

describe("backlog 6 — bill reminders + snooze", () => {
  it("bill-reminders surfaces due-soon / overdue bills with notify flags", () => {
    const today = new Date();
    const soonDay = Math.min(28, today.getDate() + 2);
    call("bills-add", ctxA, { name: "Electric", amount: 120, dueDay: soonDay, cadence: "monthly", autopay: false });
    const r = call("bill-reminders", ctxA, { leadDays: 5 });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.reminders));
    assert.ok(r.result.reminders.some(x => x.name === "Electric"));
  });
  it("autopay bills do not raise an actionable notification", () => {
    const today = new Date();
    const soonDay = Math.min(28, today.getDate() + 1);
    call("bills-add", ctxA, { name: "Mortgage", amount: 2000, dueDay: soonDay, cadence: "monthly", autopay: true });
    const r = call("bill-reminders", ctxA, { leadDays: 5 });
    const m = r.result.reminders.find(x => x.name === "Mortgage");
    if (m) assert.equal(m.notify, false);
  });
  it("snooze stamps a snoozedUntil date; rejects unknown id", () => {
    const b = call("bills-add", ctxA, { name: "Water", amount: 40, dueDay: 10 });
    const snz = call("bill-reminder-snooze", ctxA, { id: b.result.bill.id, days: 3 });
    assert.equal(snz.ok, true);
    assert.ok(snz.result.snoozedUntil);
    assert.equal(call("bill-reminder-snooze", ctxA, { id: "nope" }).ok, false);
  });
});

describe("backlog 7 — custom rollover rules + category goals", () => {
  it("rollover-rule-set attaches a rule to an envelope; capped mode splits leftover", () => {
    const env = call("envelopes-create", ctxA, { category: "Dining", monthlyTarget: 400 });
    const envId = env.result.envelope.id;
    const rule = call("rollover-rule-set", ctxA, { envelopeId: envId, mode: "capped", cap: 100, goalTarget: 1000 });
    assert.equal(rule.ok, true);
    assert.equal(rule.result.rule.mode, "capped");
    const applied = call("rollover-apply", ctxA, {});
    const row = applied.result.applied.find(a => a.envelopeId === envId);
    assert.equal(row.leftover, 400);
    assert.equal(row.carried, 100);
    assert.equal(row.toGoal, 300);
    assert.ok(row.goalProgress);
    assert.equal(row.goalProgress.accumulated, 300);
  });
  it("reset mode drops leftover; full mode carries everything", () => {
    const e1 = call("envelopes-create", ctxA, { category: "A", monthlyTarget: 200 });
    const e2 = call("envelopes-create", ctxA, { category: "B", monthlyTarget: 200 });
    call("rollover-rule-set", ctxA, { envelopeId: e1.result.envelope.id, mode: "reset" });
    call("rollover-rule-set", ctxA, { envelopeId: e2.result.envelope.id, mode: "full" });
    const applied = call("rollover-apply", ctxA, {});
    const r1 = applied.result.applied.find(a => a.envelopeId === e1.result.envelope.id);
    const r2 = applied.result.applied.find(a => a.envelopeId === e2.result.envelope.id);
    assert.equal(r1.carried, 0);
    assert.equal(r2.carried, 200);
  });
  it("rollover-rule-set rejects unknown envelope; list + delete work", () => {
    assert.equal(call("rollover-rule-set", ctxA, { envelopeId: "nope" }).ok, false);
    const env = call("envelopes-create", ctxA, { category: "C", monthlyTarget: 100 });
    const rule = call("rollover-rule-set", ctxA, { envelopeId: env.result.envelope.id, mode: "full" });
    assert.equal(call("rollover-rules-list", ctxA, {}).result.rules.length, 1);
    const del = call("rollover-rule-delete", ctxA, { id: rule.result.rule.id });
    assert.equal(del.ok, true);
    assert.equal(call("rollover-rules-list", ctxA, {}).result.rules.length, 0);
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
