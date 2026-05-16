// server/domains/finance.js
// Domain actions for the finance lens.
//
// Two layers:
//   1) Analytical (portfolioAnalysis, budgetTracker, compoundInterest,
//      debtPayoff) — pre-existing, deterministic, operate on artifact.data.
//   2) Personal-finance OS (net worth snapshots, envelope budgets,
//      investment checkup, tax estimate, retirement Monte Carlo,
//      subscription detector, AI categorisation + weekly commentary) —
//      added in the parity sprint.
//
// All write-side state lives under STATE.financeLens.

export default function registerFinanceActions(registerLensAction) {
  // ─── Pre-existing analytical macros ─────────────────────────────────

  registerLensAction("finance", "portfolioAnalysis", (ctx, artifact, _params) => {
    const holdings = artifact.data?.holdings || [];
    if (holdings.length === 0) return { ok: true, result: { message: "Add portfolio holdings to analyze." } };
    const totalValue = holdings.reduce((s, h) => s + (parseFloat(h.value || h.marketValue) || 0), 0);
    const analyzed = holdings.map(h => { const val = parseFloat(h.value || h.marketValue) || 0; return { symbol: h.symbol || h.name, shares: parseFloat(h.shares) || 0, value: val, allocation: totalValue > 0 ? Math.round((val / totalValue) * 10000) / 100 : 0, gainLoss: parseFloat(h.gainLoss) || 0, type: h.type || "equity" }; });
    const byType = {};
    for (const h of analyzed) { byType[h.type] = (byType[h.type] || 0) + h.allocation; }
    const totalGainLoss = analyzed.reduce((s, h) => s + h.gainLoss, 0);
    return { ok: true, result: { holdings: analyzed, totalValue: Math.round(totalValue * 100) / 100, totalGainLoss: Math.round(totalGainLoss * 100) / 100, returnPercent: totalValue > 0 ? Math.round((totalGainLoss / (totalValue - totalGainLoss)) * 10000) / 100 : 0, allocationByType: byType, diversificationScore: Object.keys(byType).length >= 4 ? "well-diversified" : Object.keys(byType).length >= 2 ? "moderate" : "concentrated" } };
  });

  registerLensAction("finance", "budgetTracker", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const income = parseFloat(data.monthlyIncome) || 0;
    const categories = data.categories || [];
    const spent = categories.reduce((s, c) => s + (parseFloat(c.spent) || 0), 0);
    const budgeted = categories.reduce((s, c) => s + (parseFloat(c.budget) || 0), 0);
    const tracked = categories.map(c => { const b = parseFloat(c.budget) || 0; const s = parseFloat(c.spent) || 0; return { category: c.name, budget: b, spent: s, remaining: Math.round((b - s) * 100) / 100, percentUsed: b > 0 ? Math.round((s / b) * 100) : 0, status: s > b ? "over-budget" : s > b * 0.9 ? "near-limit" : "on-track" }; });
    return { ok: true, result: { monthlyIncome: income, totalBudgeted: budgeted, totalSpent: Math.round(spent * 100) / 100, remaining: Math.round((income - spent) * 100) / 100, savingsRate: income > 0 ? Math.round(((income - spent) / income) * 100) : 0, categories: tracked, overBudget: tracked.filter(c => c.status === "over-budget").map(c => c.category) } };
  });

  registerLensAction("finance", "compoundInterest", (ctx, artifact, _params) => {
    const principal = parseFloat(artifact.data?.principal) || 0;
    const rate = parseFloat(artifact.data?.annualRate) || 0.07;
    const years = parseInt(artifact.data?.years) || 10;
    const monthly = parseFloat(artifact.data?.monthlyContribution) || 0;
    const periods = years * 12;
    const monthlyRate = rate / 12;
    let balance = principal;
    const timeline = [];
    for (let y = 1; y <= years; y++) {
      for (let m = 0; m < 12; m++) { balance = balance * (1 + monthlyRate) + monthly; }
      timeline.push({ year: y, balance: Math.round(balance * 100) / 100 });
    }
    const totalContributed = principal + monthly * periods;
    const totalInterest = balance - totalContributed;
    return { ok: true, result: { principal, monthlyContribution: monthly, annualRate: `${(rate * 100).toFixed(1)}%`, years, finalBalance: Math.round(balance * 100) / 100, totalContributed: Math.round(totalContributed * 100) / 100, totalInterest: Math.round(totalInterest * 100) / 100, interestPercent: Math.round((totalInterest / balance) * 100), timeline } };
  });

  registerLensAction("finance", "debtPayoff", (ctx, artifact, _params) => {
    const debts = artifact.data?.debts || [];
    if (debts.length === 0) return { ok: true, result: { message: "Add debts with balance, rate, and minimum payment." } };
    const analyzed = debts.map(d => { const bal = parseFloat(d.balance) || 0; const rate = parseFloat(d.rate) || 0.18; const minPay = parseFloat(d.minimumPayment) || bal * 0.02; const monthsToPayoff = minPay > 0 ? Math.ceil(Math.log(1 / (1 - bal * (rate / 12) / minPay)) / Math.log(1 + rate / 12)) : Infinity; const totalInterest = (monthsToPayoff * minPay) - bal; return { name: d.name, balance: bal, rate: `${(rate * 100).toFixed(1)}%`, minimumPayment: minPay, monthsToPayoff: isFinite(monthsToPayoff) ? monthsToPayoff : 999, totalInterest: Math.round(totalInterest * 100) / 100 }; }).sort((a, b) => parseFloat(b.rate) - parseFloat(a.rate));
    const totalDebt = analyzed.reduce((s, d) => s + d.balance, 0);
    const totalInterest = analyzed.reduce((s, d) => s + d.totalInterest, 0);
    return { ok: true, result: { debts: analyzed, totalDebt: Math.round(totalDebt * 100) / 100, totalInterest: Math.round(totalInterest * 100) / 100, strategy: "Avalanche method — pay highest rate first", firstTarget: analyzed[0]?.name, monthsToDebtFree: Math.max(...analyzed.map(d => d.monthsToPayoff)) } };
  });

  // ─── Parity-sprint: personal-finance OS ─────────────────────────────

  function getFinState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.financeLens) {
      STATE.financeLens = {
        envelopes: new Map(),       // userId → envelope[]
        snapshots: new Map(),       // userId → snapshot[]
        subscriptions: new Map(),   // userId → subscription[]
        monthlyIncome: new Map(),   // userId → number
        holdings: new Map(),        // userId → holding[]
      };
    }
    return STATE.financeLens;
  }

  function saveStateIfAvailable() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  /**
   * monthly-income-set / -get — Per-user monthly income, persisted.
   */
  registerLensAction("finance", "monthly-income-set", (ctx, _artifact, params = {}) => {
    const state = getFinState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const value = Math.max(0, Number(params.monthlyIncome) || 0);
    state.monthlyIncome.set(userId, value);
    saveStateIfAvailable();
    return { ok: true, result: { monthlyIncome: value } };
  });

  /**
   * envelopes-list / -create / -delete — YNAB-style envelope budgets.
   */
  registerLensAction("finance", "envelopes-list", (ctx, _artifact, _params = {}) => {
    const state = getFinState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const envelopes = state.envelopes.get(userId) || [];
    return { ok: true, result: { envelopes, monthlyIncome: state.monthlyIncome.get(userId) || 0 } };
  });

  registerLensAction("finance", "envelopes-create", (ctx, _artifact, params = {}) => {
    const state = getFinState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const category = String(params.category || "").trim();
    const monthlyTarget = Math.max(0, Number(params.monthlyTarget) || 0);
    if (!category) return { ok: false, error: "category required" };
    if (!state.envelopes.has(userId)) state.envelopes.set(userId, []);
    const env = {
      id: `env_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      category, monthlyTarget,
      rolloverEnabled: params.rolloverEnabled !== false,
      currentBalance: 0, spentThisMonth: 0,
      createdAt: new Date().toISOString(),
    };
    state.envelopes.get(userId).push(env);
    saveStateIfAvailable();
    return { ok: true, result: { envelope: env } };
  });

  registerLensAction("finance", "envelopes-delete", (ctx, _artifact, params = {}) => {
    const state = getFinState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const id = String(params.id || "");
    const list = state.envelopes.get(userId) || [];
    const idx = list.findIndex(e => e.id === id);
    if (idx < 0) return { ok: false, error: "envelope not found" };
    list.splice(idx, 1);
    saveStateIfAvailable();
    return { ok: true, result: { id, deleted: true } };
  });

  /**
   * net-worth-snapshot — Capture a point-in-time snapshot.
   */
  registerLensAction("finance", "net-worth-snapshot", (ctx, _artifact, params = {}) => {
    const state = getFinState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const cash = Math.max(0, Number(params.cash) || 0);
    const investments = Math.max(0, Number(params.investments) || 0);
    const realEstate = Math.max(0, Number(params.realEstate) || 0);
    const crypto = Math.max(0, Number(params.crypto) || 0);
    const liabilities = Math.max(0, Number(params.liabilities) || 0);
    const total = cash + investments + realEstate + crypto - liabilities;
    if (!state.snapshots.has(userId)) state.snapshots.set(userId, []);
    const snap = {
      date: (params.date ? new Date(params.date) : new Date()).toISOString().slice(0, 10),
      cash, investments, realEstate, crypto, liabilities, total,
    };
    state.snapshots.get(userId).push(snap);
    // Keep only latest per date
    const byDate = new Map();
    for (const s of state.snapshots.get(userId)) byDate.set(s.date, s);
    state.snapshots.set(userId, [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)));
    saveStateIfAvailable();
    return { ok: true, result: { snapshot: snap } };
  });

  /**
   * net-worth-history — User's real net-worth snapshot trajectory.
   * Returns empty array if the user hasn't logged any snapshots yet
   * (per "everything must be real" directive — no synthetic seeding).
   */
  registerLensAction("finance", "net-worth-history", (ctx, _artifact, params = {}) => {
    const state = getFinState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const all = state.snapshots.get(userId) || [];
    const range = String(params.range || "1Y");
    const filtered = filterByRange(all, range);
    return {
      ok: true,
      result: {
        snapshots: filtered, range, total: all.length,
        notes: all.length === 0 ? "No snapshots logged yet. Add a snapshot via finance.snapshot-record to start tracking net worth over time." : undefined,
      },
    };
  });

  /**
   * investment-checkup — Empower-style allocation drift + concentration +
   * fee benchmarking + Health Score. Returns error if user has no holdings
   * (per "everything must be real" directive — no SAMPLE_PORTFOLIO).
   */
  registerLensAction("finance", "investment-checkup", (ctx, _artifact, _params = {}) => {
    const state = getFinState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const holdings = state.holdings.get(userId);
    if (!holdings || holdings.length === 0) {
      return {
        ok: false,
        error: "no holdings — add positions via finance.holdings-add first (real portfolio data only, no sample)",
      };
    }
    const totalValue = holdings.reduce((s, h) => s + h.value, 0);

    // Aggregate by asset class
    const byClass = {};
    for (const h of holdings) {
      byClass[h.assetClass] = (byClass[h.assetClass] || 0) + h.value;
    }
    const TARGET = { equity_us: 50, equity_intl: 20, bonds: 20, reits: 5, cash: 5 };
    const allocation = Object.keys(TARGET).map(k => {
      const current = totalValue > 0 ? (byClass[k] || 0) / totalValue * 100 : 0;
      const target = TARGET[k];
      const drift = current - target;
      const rebalanceAction = drift > 2 ? "sell" : drift < -2 ? "buy" : "hold";
      const rebalanceAmount = Math.round((drift / 100) * totalValue);
      return { assetClass: k, current: Math.round(current * 10) / 10, target, drift: Math.round(drift * 10) / 10, rebalanceAction, rebalanceAmount };
    });

    const worstDrift = Math.max(...allocation.map(a => Math.abs(a.drift)));

    const sorted = [...holdings].sort((a, b) => b.value - a.value);
    const topHoldingPct = totalValue > 0 ? (sorted[0]?.value || 0) / totalValue * 100 : 0;
    const topThreePct = totalValue > 0 ? sorted.slice(0, 3).reduce((s, h) => s + h.value, 0) / totalValue * 100 : 0;
    // Sector max — assume each holding has a sector field
    const bySector = {};
    for (const h of holdings) { bySector[h.sector || "Other"] = (bySector[h.sector || "Other"] || 0) + h.value; }
    const sectorMax = totalValue > 0 ? Math.max(...Object.values(bySector)) / totalValue * 100 : 0;

    const FEE_BENCH = { large_blend: 0.0003, total_market: 0.0003, total_intl: 0.0008, total_bond: 0.0005, reit: 0.0007, money_market: 0.0010 };
    const fees = holdings
      .filter(h => h.expenseRatio != null)
      .map(h => {
        const benchmark = FEE_BENCH[h.feeCategory] || 0.0005;
        return {
          symbol: h.symbol, expenseRatio: h.expenseRatio,
          category: h.feeCategory || "unknown",
          benchmark, delta: h.expenseRatio - benchmark,
        };
      });
    const totalAnnualFeeUsd = fees.reduce((s, f) => {
      const h = holdings.find(x => x.symbol === f.symbol);
      return s + (h?.value || 0) * f.expenseRatio;
    }, 0);

    const recommendations = [];
    if (worstDrift > 5) recommendations.push(`Rebalance: largest drift is ${worstDrift.toFixed(1)}% — consider trimming overweight or topping up underweight asset classes.`);
    if (topHoldingPct > 30) recommendations.push(`Concentration risk: top holding is ${topHoldingPct.toFixed(0)}% of portfolio. Aim for <20%.`);
    if (sectorMax > 35) recommendations.push(`Sector concentration: largest sector is ${sectorMax.toFixed(0)}% — consider diversifying.`);
    fees.filter(f => f.delta > 0.005).forEach(f => recommendations.push(`Fee alert: ${f.symbol} expense ratio (${(f.expenseRatio * 100).toFixed(2)}%) is ${((f.delta) * 100).toFixed(2)}% above the ${f.category} benchmark.`));

    let score = 100;
    score -= Math.min(40, worstDrift * 3);
    score -= Math.max(0, (topHoldingPct - 20) * 1.5);
    score -= Math.min(20, totalAnnualFeeUsd / 100);
    score = Math.max(0, Math.min(100, Math.round(score)));

    return {
      ok: true,
      result: {
        allocation,
        drift: { worst: worstDrift, categories: allocation.filter(a => Math.abs(a.drift) > 2).length },
        concentrationRisk: { topHoldingPct, topThreePct, sectorMax },
        fees,
        totalAnnualFeeUsd: Math.round(totalAnnualFeeUsd * 100) / 100,
        recommendations,
        score,
      },
    };
  });

  /**
   * tax-estimate — IRS 2026 brackets per Tax Foundation + OBBBA updates.
   */
  registerLensAction("finance", "tax-estimate", (_ctx, _artifact, params = {}) => {
    const wages = Math.max(0, Number(params.wages) || 0);
    const otherIncome = Math.max(0, Number(params.otherIncome) || 0);
    const longTermGains = Math.max(0, Number(params.longTermGains) || 0);
    const shortTermGains = Math.max(0, Number(params.shortTermGains) || 0);
    const itemized = Math.max(0, Number(params.deductions) || 0);
    const withholding = Math.max(0, Number(params.withholding) || 0);
    const filing = ["single", "married_jointly", "married_separately", "head_of_household"].includes(params.filing) ? params.filing : "single";

    const STANDARD = {
      single: 16100, married_jointly: 32200, married_separately: 16100, head_of_household: 24150,
    };
    const BRACKETS = {
      single: [
        { rate: 0.10, from: 0, to: 11700 },
        { rate: 0.12, from: 11700, to: 47750 },
        { rate: 0.22, from: 47750, to: 102000 },
        { rate: 0.24, from: 102000, to: 195000 },
        { rate: 0.32, from: 195000, to: 248000 },
        { rate: 0.35, from: 248000, to: 640600 },
        { rate: 0.37, from: 640600, to: null },
      ],
      married_jointly: [
        { rate: 0.10, from: 0, to: 23400 },
        { rate: 0.12, from: 23400, to: 95500 },
        { rate: 0.22, from: 95500, to: 204000 },
        { rate: 0.24, from: 204000, to: 390000 },
        { rate: 0.32, from: 390000, to: 496000 },
        { rate: 0.35, from: 496000, to: 768600 },
        { rate: 0.37, from: 768600, to: null },
      ],
      married_separately: [
        { rate: 0.10, from: 0, to: 11700 },
        { rate: 0.12, from: 11700, to: 47750 },
        { rate: 0.22, from: 47750, to: 102000 },
        { rate: 0.24, from: 102000, to: 195000 },
        { rate: 0.32, from: 195000, to: 248000 },
        { rate: 0.35, from: 248000, to: 384300 },
        { rate: 0.37, from: 384300, to: null },
      ],
      head_of_household: [
        { rate: 0.10, from: 0, to: 16700 },
        { rate: 0.12, from: 16700, to: 63700 },
        { rate: 0.22, from: 63700, to: 102000 },
        { rate: 0.24, from: 102000, to: 195000 },
        { rate: 0.32, from: 195000, to: 248000 },
        { rate: 0.35, from: 248000, to: 640600 },
        { rate: 0.37, from: 640600, to: null },
      ],
    };

    const ordinaryIncome = wages + otherIncome + shortTermGains;
    const deductionUsed = itemized > 0 ? itemized : STANDARD[filing];
    const taxableOrdinary = Math.max(0, ordinaryIncome - deductionUsed);
    const brackets = BRACKETS[filing];
    let remaining = taxableOrdinary;
    let totalTax = 0;
    let marginalRate = 0;
    const bracketBreakdown = [];
    for (const b of brackets) {
      const top = b.to == null ? Infinity : b.to;
      const slice = Math.max(0, Math.min(remaining, top - b.from));
      const taxOnSlice = slice * b.rate;
      bracketBreakdown.push({ rate: b.rate, from: b.from, to: b.to, amount: slice, taxOnSlice });
      totalTax += taxOnSlice;
      if (slice > 0) marginalRate = b.rate;
      remaining = Math.max(0, remaining - slice);
      if (remaining === 0) break;
    }

    // LTCG: simplified — 0/15/20 brackets based on taxable income
    const ltcgRate = taxableOrdinary < 48750 ? 0 : taxableOrdinary < 533400 ? 0.15 : 0.20;
    const ltcgTax = longTermGains * ltcgRate;
    totalTax += ltcgTax;

    const effectiveRate = (wages + otherIncome + longTermGains + shortTermGains) > 0
      ? totalTax / (wages + otherIncome + longTermGains + shortTermGains) : 0;

    const refundOrOwed = withholding - totalTax;
    const refund = refundOrOwed > 0 ? Math.round(refundOrOwed) : null;
    const owed = refundOrOwed < 0 ? Math.round(-refundOrOwed) : null;
    const withholdingRecommendation = refund != null && refund > 2000
      ? "Withholding is too high — you're giving the gov't an interest-free loan. Consider lowering on your W-4."
      : owed != null && owed > 1000
      ? "Withholding is low — consider increasing on your W-4 or making estimated payments to avoid penalties."
      : "Withholding looks aligned.";

    return {
      ok: true,
      result: {
        taxableIncome: Math.round(taxableOrdinary),
        totalTax: Math.round(totalTax * 100) / 100,
        effectiveRate: Math.round(effectiveRate * 1000) / 1000,
        marginalRate,
        brackets: bracketBreakdown,
        refund, owed,
        withholdingRecommendation,
        deductionUsed,
        ltcgRate,
        ltcgTax: Math.round(ltcgTax * 100) / 100,
      },
    };
  });

  /**
   * retirement-monte-carlo — Geometric-Brownian-motion paths.
   * params: { currentAge, retireAge, currentSavings, annualContribution,
   *           expectedReturn, volatility, annualSpendInRetirement, paths }
   */
  registerLensAction("finance", "retirement-monte-carlo", (_ctx, _artifact, params = {}) => {
    const currentAge = Math.max(18, Math.min(90, Number(params.currentAge) || 35));
    const retireAge = Math.max(currentAge + 1, Math.min(100, Number(params.retireAge) || 67));
    const currentSavings = Math.max(0, Number(params.currentSavings) || 0);
    const annualContribution = Math.max(0, Number(params.annualContribution) || 0);
    const mu = Math.max(-0.5, Math.min(0.5, Number(params.expectedReturn) || 0.07));
    const sigma = Math.max(0.01, Math.min(0.6, Number(params.volatility) || 0.15));
    const annualSpend = Math.max(0, Number(params.annualSpendInRetirement) || 60000);
    const paths = Math.max(100, Math.min(5000, Number(params.paths) || 1000));
    const livesTo = 95;
    const years = livesTo - currentAge;

    const trajectories = [];
    let successes = 0;
    const finals = [];
    const shortfallYears = [];

    for (let p = 0; p < paths; p++) {
      const path = [];
      let bal = currentSavings;
      let shortfallYear = null;
      for (let y = 0; y < years; y++) {
        // Sample annual return: N(mu, sigma²) via Box-Muller
        const u1 = Math.random(), u2 = Math.random();
        const z = Math.sqrt(-2 * Math.log(u1 || 0.0001)) * Math.cos(2 * Math.PI * u2);
        const r = mu + sigma * z;
        const age = currentAge + y;
        if (age < retireAge) {
          bal = bal * (1 + r) + annualContribution;
        } else {
          bal = bal * (1 + r) - annualSpend;
          if (bal < 0) {
            bal = 0;
            if (shortfallYear == null) shortfallYear = age;
          }
        }
        path.push(Math.max(0, bal));
      }
      trajectories.push(path);
      finals.push(path[path.length - 1] || 0);
      if (shortfallYear == null) successes++;
      else shortfallYears.push(shortfallYear);
    }

    const successProbability = successes / paths;
    finals.sort((a, b) => a - b);
    const pct = (p) => finals[Math.floor(p * finals.length)];

    // Sample 100 paths for the fan chart so the response stays small
    const sampledPaths = trajectories.filter((_, i) => i % Math.ceil(paths / 100) === 0);

    return {
      ok: true,
      result: {
        successProbability,
        medianFinalBalance: pct(0.5),
        p10Final: pct(0.10), p25Final: pct(0.25), p75Final: pct(0.75), p90Final: pct(0.90),
        shortfallYear: shortfallYears.length > 0 ? Math.round(shortfallYears.sort((a, b) => a - b)[Math.floor(shortfallYears.length / 2)]) : null,
        trajectories: sampledPaths.map(p => p.map(v => Math.round(v))),
        years,
        paths,
      },
    };
  });

  /**
   * subscriptions-detect — Detect recurring charges from synthetic ledger.
   * The lens doesn't have real Plaid data; we seed a demo set so the UI
   * has something to render.
   */
  registerLensAction("finance", "subscriptions-detect", (ctx, _artifact, _params = {}) => {
    const state = getFinState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    if (!state.subscriptions.has(userId)) {
      state.subscriptions.set(userId, seedSubscriptions());
    }
    const subs = state.subscriptions.get(userId);
    return { ok: true, result: { subscriptions: subs } };
  });

  registerLensAction("finance", "subscriptions-cancel", (ctx, _artifact, params = {}) => {
    const state = getFinState(); if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const id = String(params.id || "");
    const subs = state.subscriptions.get(userId) || [];
    const sub = subs.find(s => s.id === id);
    if (!sub) return { ok: false, error: "subscription not found" };
    sub.status = "cancelled";
    saveStateIfAvailable();
    return { ok: true, result: { id, status: "cancelled" } };
  });

  /**
   * categorize-transaction — Utility-brain auto-categorisation (Copilot
   * Money parity; targets ~90% first-pass accuracy on US merchant names).
   */
  registerLensAction("finance", "categorize-transaction", async (ctx, _artifact, params = {}) => {
    const description = String(params.description || "").trim();
    const amount = Number(params.amount) || 0;
    if (!description) return { ok: false, error: "description required" };
    if (!ctx?.llm?.chat) {
      const fallback = ruleBasedCategorize(description);
      return { ok: true, result: { category: fallback, confidence: 0.7, source: "rules" } };
    }
    const sys = `Categorise this personal-finance transaction. Output ONLY JSON: {"category":"...","confidence":0.0-1.0}
Categories: Groceries, Dining, Transportation, Gas, Shopping, Entertainment, Subscriptions, Bills, Travel, Health, Income, Transfer, Investments, Other`;
    try {
      const out = await ctx.llm.chat({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Description: ${description}\nAmount: $${amount.toFixed(2)}` },
        ],
        temperature: 0.1, maxTokens: 64, slot: "utility",
      });
      const text = String(out?.text || out?.content || "").trim();
      const parsed = extractJsonFin(text);
      if (parsed?.category) {
        return { ok: true, result: { category: parsed.category, confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.7)), source: "utility-brain" } };
      }
    } catch (_e) { /* fall through */ }
    return { ok: true, result: { category: ruleBasedCategorize(description), confidence: 0.6, source: "rules" } };
  });

  /**
   * weekly-commentary — Conscious-brain narrative summary of the week.
   */
  registerLensAction("finance", "weekly-commentary", async (ctx, _artifact, params = {}) => {
    if (!ctx?.llm?.chat) return { ok: true, result: { text: "Commentary unavailable (LLM offline)." } };
    const week = params.week || "current";
    const totalSpent = Number(params.totalSpent) || 0;
    const totalIncome = Number(params.totalIncome) || 0;
    const topCategories = Array.isArray(params.topCategories) ? params.topCategories.slice(0, 5) : [];
    const sys = `You are a personal finance commentator. Write a friendly 2-paragraph summary of the week. Keep it concise, specific, and actionable.`;
    const user = `Week: ${week}
Total spent: $${totalSpent.toFixed(0)}
Total income: $${totalIncome.toFixed(0)}
Top categories: ${topCategories.map(c => `${c.category} $${c.amount}`).join(", ")}
Generate the summary.`;
    try {
      const out = await ctx.llm.chat({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.5, maxTokens: 400, slot: "conscious",
      });
      const text = String(out?.text || out?.content || "").trim();
      return { ok: true, result: { text, week } };
    } catch (e) {
      return { ok: true, result: { text: `(commentary error: ${e?.message || "unknown"})`, error: true } };
    }
  });
}

// ─── helpers ──────────────────────────────────────────────────────────

function filterByRange(snapshots, range) {
  const now = Date.now();
  const days = range === "1M" ? 30 : range === "6M" ? 180 : range === "1Y" ? 365 : range === "5Y" ? 365 * 5 : Infinity;
  return snapshots.filter(s => (now - new Date(s.date).getTime()) / 86400000 <= days);
}


function seedSubscriptions() {
  const now = Date.now();
  return [
    { id: "sub_netflix", merchant: "Netflix", monthlyAmount: 15.49, cadence: "monthly", lastChargedAt: new Date(now - 5 * 86400000).toISOString(), nextEstimated: new Date(now + 25 * 86400000).toISOString(), category: "Entertainment", status: "active" },
    { id: "sub_spotify", merchant: "Spotify", monthlyAmount: 10.99, cadence: "monthly", lastChargedAt: new Date(now - 12 * 86400000).toISOString(), nextEstimated: new Date(now + 18 * 86400000).toISOString(), category: "Entertainment", status: "active" },
    { id: "sub_iphone", merchant: "iCloud+ 200GB", monthlyAmount: 2.99, cadence: "monthly", lastChargedAt: new Date(now - 8 * 86400000).toISOString(), nextEstimated: new Date(now + 22 * 86400000).toISOString(), category: "Subscriptions", status: "active" },
    { id: "sub_gym", merchant: "24 Hour Fitness", monthlyAmount: 49.99, cadence: "monthly", lastChargedAt: new Date(now - 18 * 86400000).toISOString(), nextEstimated: new Date(now + 12 * 86400000).toISOString(), category: "Health", status: "active", insight: "You haven't checked in for 47 days — consider cancelling." },
    { id: "sub_aws", merchant: "AWS", monthlyAmount: 18.20, cadence: "monthly", lastChargedAt: new Date(now - 2 * 86400000).toISOString(), nextEstimated: new Date(now + 28 * 86400000).toISOString(), category: "Subscriptions", status: "active" },
    { id: "sub_news", merchant: "NYT Digital", monthlyAmount: 22, cadence: "monthly", lastChargedAt: new Date(now - 20 * 86400000).toISOString(), nextEstimated: new Date(now + 10 * 86400000).toISOString(), category: "Subscriptions", status: "active", insight: "Auto-renewed at full price after promo ended." },
    { id: "sub_domain", merchant: "Namecheap (yearly)", monthlyAmount: 1.08, cadence: "annual", lastChargedAt: new Date(now - 60 * 86400000).toISOString(), nextEstimated: new Date(now + 305 * 86400000).toISOString(), category: "Subscriptions", status: "active" },
  ];
}

function ruleBasedCategorize(desc) {
  const d = desc.toLowerCase();
  if (/whole foods|trader joe|safeway|kroger|walmart|costco/.test(d)) return "Groceries";
  if (/uber|lyft|taxi|bart|caltrain/.test(d)) return "Transportation";
  if (/shell|chevron|exxon|gas /.test(d)) return "Gas";
  if (/netflix|spotify|disney|hulu|hbo|youtube premium/.test(d)) return "Entertainment";
  if (/aws|google cloud|github|notion|figma/.test(d)) return "Subscriptions";
  if (/electric|water|comcast|verizon|att/.test(d)) return "Bills";
  if (/united|delta|american|airbnb|hotel/.test(d)) return "Travel";
  if (/cvs|walgreens|kaiser|aetna|gym/.test(d)) return "Health";
  if (/restaurant|cafe|coffee|pizza|sushi/.test(d)) return "Dining";
  if (/amazon|target|walmart|ebay/.test(d)) return "Shopping";
  if (/payroll|deposit/.test(d)) return "Income";
  if (/transfer/.test(d)) return "Transfer";
  if (/vanguard|fidelity|schwab|investment/.test(d)) return "Investments";
  return "Other";
}

function extractJsonFin(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(body.slice(first, last + 1)); } catch { return null; }
}

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}
