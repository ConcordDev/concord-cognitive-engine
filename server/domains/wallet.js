// server/domains/wallet.js
// Domain actions for wallet: portfolio balancing, transaction categorization,
// budget checking, and spending trend analysis.

export default function registerWalletActions(registerLensAction) {
  registerLensAction("wallet", "portfolioBalance", (ctx, artifact, _params) => {
    const assets = artifact.data?.assets || artifact.data?.holdings || [];
    if (assets.length === 0) {
      return { ok: true, result: { message: "Provide an assets array with {name, quantity, currentPrice, costBasis} per asset." } };
    }
    let totalValue = 0;
    let totalCost = 0;
    const analyzed = assets.map(a => {
      const qty = parseFloat(a.quantity || a.shares) || 0;
      const price = parseFloat(a.currentPrice || a.price) || 0;
      const costBasis = parseFloat(a.costBasis || a.avgCost || 0) * qty;
      const marketValue = qty * price;
      const gainLoss = costBasis > 0 ? marketValue - costBasis : 0;
      const gainLossPercent = costBasis > 0 ? Math.round((gainLoss / costBasis) * 10000) / 100 : 0;
      totalValue += marketValue;
      totalCost += costBasis;
      return {
        name: a.name || a.symbol || "Unknown",
        type: a.type || "equity",
        quantity: qty,
        currentPrice: price,
        marketValue: Math.round(marketValue * 100) / 100,
        costBasis: Math.round(costBasis * 100) / 100,
        gainLoss: Math.round(gainLoss * 100) / 100,
        gainLossPercent,
      };
    });
    const withAllocation = analyzed.map(a => ({
      ...a,
      allocationPercent: totalValue > 0 ? Math.round((a.marketValue / totalValue) * 10000) / 100 : 0,
    })).sort((a, b) => b.marketValue - a.marketValue);
    const byType = {};
    for (const a of withAllocation) {
      byType[a.type] = (byType[a.type] || 0) + a.allocationPercent;
    }
    for (const t of Object.keys(byType)) {
      byType[t] = Math.round(byType[t] * 100) / 100;
    }
    const totalGainLoss = totalValue - totalCost;
    const topGainer = [...withAllocation].sort((a, b) => b.gainLossPercent - a.gainLossPercent)[0];
    const topLoser = [...withAllocation].sort((a, b) => a.gainLossPercent - b.gainLossPercent)[0];
    const largest = withAllocation[0];
    const concentrationRisk = largest && largest.allocationPercent > 40 ? "high" : largest && largest.allocationPercent > 25 ? "moderate" : "low";
    return {
      ok: true,
      result: {
        totalValue: Math.round(totalValue * 100) / 100,
        totalCostBasis: Math.round(totalCost * 100) / 100,
        totalGainLoss: Math.round(totalGainLoss * 100) / 100,
        totalReturnPercent: totalCost > 0 ? Math.round((totalGainLoss / totalCost) * 10000) / 100 : 0,
        assetCount: withAllocation.length,
        allocationByType: byType,
        concentrationRisk,
        largestHolding: largest ? { name: largest.name, percent: largest.allocationPercent } : null,
        topGainer: topGainer ? { name: topGainer.name, percent: topGainer.gainLossPercent } : null,
        topLoser: topLoser ? { name: topLoser.name, percent: topLoser.gainLossPercent } : null,
        assets: withAllocation,
      },
    };
  });

  registerLensAction("wallet", "transactionCategorize", (ctx, artifact, _params) => {
    const transactions = artifact.data?.transactions || [];
    if (transactions.length === 0) {
      return { ok: true, result: { message: "Provide a transactions array with {merchant, amount, date} per transaction." } };
    }
    const categoryPatterns = {
      "Groceries": /walmart|costco|trader\s*joe|whole\s*foods|kroger|safeway|aldi|publix|grocery|market|food\s*lion|wegmans|heb|meijer|sprouts/i,
      "Dining": /mcdonald|starbucks|chipotle|subway|domino|pizza|burger|taco|wendy|dunkin|panera|chick-fil|restaurant|cafe|diner|grill|sushi|thai|chinese|indian|mexican|bar\s*&|pub|bistro|eatery|doordash|grubhub|uber\s*eats/i,
      "Transportation": /uber|lyft|taxi|gas|shell|chevron|exxon|bp\b|mobil|sunoco|parking|toll|transit|metro|bus\b|amtrak|fuel|petrol|speedway/i,
      "Shopping": /amazon|target|best\s*buy|ebay|etsy|apple\s*store|nike|nordstrom|macy|kohls|tj\s*maxx|marshalls|ross|home\s*depot|lowes|ikea|wayfair|zara|h&m|gap|old\s*navy/i,
      "Entertainment": /netflix|spotify|hulu|disney|hbo|youtube|twitch|steam|playstation|xbox|cinema|movie|theater|concert|ticket|amc|regal|audible/i,
      "Utilities": /electric|water\s*bill|gas\s*bill|internet|comcast|verizon|at&t|t-mobile|sprint|utility|sewage|waste|power\s*company|xfinity|spectrum/i,
      "Healthcare": /pharmacy|cvs|walgreens|doctor|hospital|clinic|dental|medical|health|urgent\s*care|lab|optom|therap|prescription|copay/i,
      "Subscriptions": /subscription|membership|premium|annual\s*fee|monthly\s*fee|patreon|substack/i,
      "Travel": /airline|hotel|airbnb|booking|expedia|marriott|hilton|hyatt|flight|rental\s*car|hertz|avis|enterprise/i,
      "Finance": /transfer|payment|interest|fee|bank|atm|invest|trade|brokerage|insurance|premium|loan|mortgage/i,
    };
    let categorized = 0;
    let uncategorized = 0;
    const results = transactions.map(tx => {
      const merchant = tx.merchant || tx.description || tx.name || "";
      const amount = parseFloat(tx.amount) || 0;
      let category = "Uncategorized";
      for (const [cat, pattern] of Object.entries(categoryPatterns)) {
        if (pattern.test(merchant)) {
          category = cat;
          break;
        }
      }
      if (category === "Uncategorized") uncategorized++;
      else categorized++;
      return {
        merchant: merchant || "Unknown",
        amount: Math.round(amount * 100) / 100,
        date: tx.date || null,
        category,
      };
    });
    const categoryTotals = {};
    const categoryCounts = {};
    for (const r of results) {
      categoryTotals[r.category] = (categoryTotals[r.category] || 0) + Math.abs(r.amount);
      categoryCounts[r.category] = (categoryCounts[r.category] || 0) + 1;
    }
    const totalSpent = Object.values(categoryTotals).reduce((s, v) => s + v, 0);
    const summary = Object.entries(categoryTotals)
      .map(([cat, total]) => ({
        category: cat,
        total: Math.round(total * 100) / 100,
        count: categoryCounts[cat],
        percentOfTotal: totalSpent > 0 ? Math.round((total / totalSpent) * 10000) / 100 : 0,
      }))
      .sort((a, b) => b.total - a.total);
    return {
      ok: true,
      result: {
        totalTransactions: transactions.length,
        categorized,
        uncategorized,
        categorizationRate: `${Math.round((categorized / transactions.length) * 100)}%`,
        totalSpent: Math.round(totalSpent * 100) / 100,
        categorySummary: summary,
        transactions: results,
      },
    };
  });

  registerLensAction("wallet", "budgetCheck", (ctx, artifact, _params) => {
    const budgets = artifact.data?.budgets || artifact.data?.categories || [];
    const transactions = artifact.data?.transactions || [];
    if (budgets.length === 0) {
      return { ok: true, result: { message: "Provide a budgets array with {category, limit} and optionally transactions to auto-sum spending." } };
    }
    const spendingByCategory = {};
    for (const tx of transactions) {
      const cat = tx.category || "Uncategorized";
      const amount = Math.abs(parseFloat(tx.amount) || 0);
      spendingByCategory[cat] = (spendingByCategory[cat] || 0) + amount;
    }
    let totalBudget = 0;
    let totalSpent = 0;
    let overageCount = 0;
    let nearLimitCount = 0;
    const checked = budgets.map(b => {
      const category = b.category || b.name || "Unknown";
      const limit = parseFloat(b.limit || b.budget) || 0;
      const spent = parseFloat(b.spent) || spendingByCategory[category] || 0;
      const remaining = limit - spent;
      const percentUsed = limit > 0 ? Math.round((spent / limit) * 10000) / 100 : 0;
      let status;
      if (spent > limit) {
        status = "over-budget";
        overageCount++;
      } else if (percentUsed >= 90) {
        status = "near-limit";
        nearLimitCount++;
      } else if (percentUsed >= 70) {
        status = "caution";
      } else {
        status = "on-track";
      }
      totalBudget += limit;
      totalSpent += spent;
      return {
        category,
        limit: Math.round(limit * 100) / 100,
        spent: Math.round(spent * 100) / 100,
        remaining: Math.round(remaining * 100) / 100,
        percentUsed,
        status,
        overage: remaining < 0 ? Math.round(Math.abs(remaining) * 100) / 100 : 0,
      };
    }).sort((a, b) => b.percentUsed - a.percentUsed);
    const overBudgetItems = checked.filter(c => c.status === "over-budget");
    const totalRemaining = totalBudget - totalSpent;
    const overallStatus = overageCount > 0 ? "over-budget" : nearLimitCount > 0 ? "at-risk" : "healthy";
    return {
      ok: true,
      result: {
        overallStatus,
        totalBudget: Math.round(totalBudget * 100) / 100,
        totalSpent: Math.round(totalSpent * 100) / 100,
        totalRemaining: Math.round(totalRemaining * 100) / 100,
        overallPercentUsed: totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 10000) / 100 : 0,
        categoriesOverBudget: overageCount,
        categoriesNearLimit: nearLimitCount,
        overages: overBudgetItems.map(c => ({ category: c.category, overage: c.overage, percentUsed: c.percentUsed })),
        categories: checked,
      },
    };
  });

  registerLensAction("wallet", "spendingTrend", (ctx, artifact, _params) => {
    const transactions = artifact.data?.transactions || [];
    if (transactions.length === 0) {
      return { ok: true, result: { message: "Provide a transactions array with {amount, date, category} to analyze spending trends." } };
    }
    const monthlyTotals = {};
    const monthlyByCategory = {};
    for (const tx of transactions) {
      const amount = Math.abs(parseFloat(tx.amount) || 0);
      const date = tx.date || "";
      const category = tx.category || "Uncategorized";
      const monthMatch = date.match(/^(\d{4})-(\d{2})/);
      const monthKey = monthMatch ? `${monthMatch[1]}-${monthMatch[2]}` : "unknown";
      if (monthKey === "unknown") continue;
      monthlyTotals[monthKey] = (monthlyTotals[monthKey] || 0) + amount;
      if (!monthlyByCategory[monthKey]) monthlyByCategory[monthKey] = {};
      monthlyByCategory[monthKey][category] = (monthlyByCategory[monthKey][category] || 0) + amount;
    }
    const sortedMonths = Object.keys(monthlyTotals).sort();
    if (sortedMonths.length === 0) {
      return { ok: true, result: { message: "No valid dates found in transactions. Use YYYY-MM-DD format." } };
    }
    const monthOverMonth = [];
    for (let i = 1; i < sortedMonths.length; i++) {
      const prev = monthlyTotals[sortedMonths[i - 1]];
      const curr = monthlyTotals[sortedMonths[i]];
      const change = curr - prev;
      const changePercent = prev > 0 ? Math.round((change / prev) * 10000) / 100 : 0;
      monthOverMonth.push({
        month: sortedMonths[i],
        total: Math.round(curr * 100) / 100,
        previousTotal: Math.round(prev * 100) / 100,
        change: Math.round(change * 100) / 100,
        changePercent,
        direction: change > 0 ? "increase" : change < 0 ? "decrease" : "flat",
      });
    }
    const allCategories = new Set();
    for (const m of Object.values(monthlyByCategory)) {
      for (const c of Object.keys(m)) allCategories.add(c);
    }
    const categoryGrowth = [];
    for (const cat of allCategories) {
      const firstMonth = sortedMonths[0];
      const lastMonth = sortedMonths[sortedMonths.length - 1];
      const firstVal = (monthlyByCategory[firstMonth] || {})[cat] || 0;
      const lastVal = (monthlyByCategory[lastMonth] || {})[cat] || 0;
      const totalForCat = sortedMonths.reduce((s, m) => s + ((monthlyByCategory[m] || {})[cat] || 0), 0);
      const growthPercent = firstVal > 0 ? Math.round(((lastVal - firstVal) / firstVal) * 10000) / 100 : (lastVal > 0 ? 100 : 0);
      categoryGrowth.push({
        category: cat,
        totalSpent: Math.round(totalForCat * 100) / 100,
        firstPeriod: Math.round(firstVal * 100) / 100,
        lastPeriod: Math.round(lastVal * 100) / 100,
        growthPercent,
      });
    }
    categoryGrowth.sort((a, b) => b.growthPercent - a.growthPercent);
    const totalAllTime = Object.values(monthlyTotals).reduce((s, v) => s + v, 0);
    const avgMonthly = sortedMonths.length > 0 ? Math.round((totalAllTime / sortedMonths.length) * 100) / 100 : 0;
    const highestMonth = sortedMonths.reduce((best, m) => monthlyTotals[m] > (monthlyTotals[best] || 0) ? m : best, sortedMonths[0]);
    const lowestMonth = sortedMonths.reduce((best, m) => monthlyTotals[m] < (monthlyTotals[best] || Infinity) ? m : best, sortedMonths[0]);
    const overallTrend = sortedMonths.length >= 2
      ? (monthlyTotals[sortedMonths[sortedMonths.length - 1]] > monthlyTotals[sortedMonths[0]] ? "increasing" : monthlyTotals[sortedMonths[sortedMonths.length - 1]] < monthlyTotals[sortedMonths[0]] ? "decreasing" : "stable")
      : "insufficient-data";
    return {
      ok: true,
      result: {
        periodsAnalyzed: sortedMonths.length,
        dateRange: { from: sortedMonths[0], to: sortedMonths[sortedMonths.length - 1] },
        totalSpent: Math.round(totalAllTime * 100) / 100,
        averageMonthly: avgMonthly,
        highestMonth: { month: highestMonth, amount: Math.round(monthlyTotals[highestMonth] * 100) / 100 },
        lowestMonth: { month: lowestMonth, amount: Math.round(monthlyTotals[lowestMonth] * 100) / 100 },
        overallTrend,
        monthOverMonth,
        highestGrowthCategories: categoryGrowth.slice(0, 5),
        categoryTrends: categoryGrowth,
      },
    };
  });

  // ─── Parity-sprint macros (Venmo/PayPal feature backlog) ──
  // State-backed via globalThis._concordSTATE, keyed by ctx.userId.

  function getWalletState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.walletLens) STATE.walletLens = {};
    const s = STATE.walletLens;
    for (const k of [
      "requests",   // money requests / invoices (keyed by userId → array)
      "schedules",  // recurring / scheduled transfers
      "feed",       // social transaction feed entries
      "splits",     // split-the-bill records
      "cards",      // linked funding sources
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveWalletState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function uid(ctx) {
    return ctx?.actor?.userId || ctx?.userId || "anon";
  }
  function genId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  function listFor(map, userId) {
    if (!map.has(userId)) map.set(userId, []);
    return map.get(userId);
  }

  // ── Money requests / invoices ──────────────────────────────────────────────

  registerLensAction("wallet", "requestList", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    let requests = [...listFor(state.requests, userId)];
    const direction = params.direction; // 'outgoing' | 'incoming'
    if (direction === "outgoing") requests = requests.filter(r => r.requesterId === userId);
    if (direction === "incoming") requests = requests.filter(r => r.payerId === userId);
    if (params.status) requests = requests.filter(r => r.status === params.status);
    requests.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    const outstanding = requests
      .filter(r => r.status === "pending")
      .reduce((s, r) => s + (r.amount || 0), 0);
    return { ok: true, result: { requests, count: requests.length, outstandingTotal: Math.round(outstanding * 100) / 100 } };
  });

  registerLensAction("wallet", "requestCreate", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const payerId = String(params.payerId || params.from || "").trim();
    const amount = Number(params.amount) || 0;
    if (!payerId) return { ok: false, error: "payerId required" };
    if (amount <= 0) return { ok: false, error: "amount must be positive" };
    const lineItems = Array.isArray(params.lineItems)
      ? params.lineItems
          .map(li => ({
            description: String(li.description || "").trim(),
            amount: Math.round((Number(li.amount) || 0) * 100) / 100,
          }))
          .filter(li => li.description)
      : [];
    const isInvoice = Boolean(params.invoice) || lineItems.length > 0;
    const request = {
      id: genId(isInvoice ? "inv" : "req"),
      kind: isInvoice ? "invoice" : "request",
      requesterId: userId,
      payerId,
      amount: Math.round(amount * 100) / 100,
      note: String(params.note || "").trim(),
      emoji: String(params.emoji || "").trim().slice(0, 8),
      lineItems,
      dueDate: params.dueDate || null,
      payLink: `/lenses/wallet?pay=`,
      status: "pending",
      createdAt: new Date().toISOString(),
      paidAt: null,
    };
    request.payLink = `/lenses/wallet?pay=${request.id}`;
    listFor(state.requests, userId).push(request);
    // mirror to payer's incoming list so they can see it
    const payerList = listFor(state.requests, payerId);
    if (!payerList.some(r => r.id === request.id)) payerList.push(request);
    saveWalletState();
    return { ok: true, result: { request } };
  });

  registerLensAction("wallet", "requestUpdate", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const id = String(params.id || "").trim();
    if (!id) return { ok: false, error: "id required" };
    const status = params.status;
    const valid = ["pending", "paid", "declined", "canceled"];
    if (status && !valid.includes(status)) return { ok: false, error: "status invalid" };
    let updated = null;
    for (const list of state.requests.values()) {
      const req = list.find(r => r.id === id);
      if (req) {
        if (status) {
          // only requester may cancel; only payer may decline/pay
          if (status === "canceled" && req.requesterId !== userId) {
            return { ok: false, error: "only requester may cancel" };
          }
          if ((status === "paid" || status === "declined") && req.payerId !== userId) {
            return { ok: false, error: "only payer may pay or decline" };
          }
          req.status = status;
          if (status === "paid") req.paidAt = new Date().toISOString();
        }
        if (params.note !== undefined && req.requesterId === userId) req.note = String(params.note).trim();
        updated = req;
      }
    }
    if (!updated) return { ok: false, error: "request not found" };
    saveWalletState();
    return { ok: true, result: { request: updated } };
  });

  // ── Recurring / scheduled transfers ────────────────────────────────────────

  function nextRunDate(fromIso, frequency) {
    const d = new Date(fromIso);
    if (frequency === "weekly") d.setDate(d.getDate() + 7);
    else if (frequency === "biweekly") d.setDate(d.getDate() + 14);
    else if (frequency === "monthly") d.setMonth(d.getMonth() + 1);
    else d.setDate(d.getDate() + 1); // daily
    return d.toISOString();
  }

  registerLensAction("wallet", "scheduleList", (ctx, _artifact, _params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const schedules = [...listFor(state.schedules, userId)]
      .sort((a, b) => (a.nextRunAt || "").localeCompare(b.nextRunAt || ""));
    const monthlyCommitted = schedules
      .filter(s => s.status === "active")
      .reduce((sum, s) => {
        const perMonth = s.frequency === "weekly" ? 4.33 : s.frequency === "biweekly" ? 2.17 : s.frequency === "daily" ? 30 : 1;
        return sum + s.amount * perMonth;
      }, 0);
    return { ok: true, result: { schedules, count: schedules.length, monthlyCommitted: Math.round(monthlyCommitted * 100) / 100 } };
  });

  registerLensAction("wallet", "scheduleCreate", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const recipientId = String(params.recipientId || params.to || "").trim();
    const amount = Number(params.amount) || 0;
    const frequency = params.frequency;
    if (!recipientId) return { ok: false, error: "recipientId required" };
    if (amount <= 0) return { ok: false, error: "amount must be positive" };
    if (!["daily", "weekly", "biweekly", "monthly"].includes(frequency)) {
      return { ok: false, error: "frequency must be daily, weekly, biweekly, or monthly" };
    }
    const startDate = params.startDate || new Date().toISOString();
    const schedule = {
      id: genId("sched"),
      ownerId: userId,
      recipientId,
      amount: Math.round(amount * 100) / 100,
      frequency,
      note: String(params.note || "").trim(),
      startDate,
      nextRunAt: nextRunDate(startDate, frequency),
      occurrences: Number(params.occurrences) > 0 ? Number(params.occurrences) : null,
      runsCompleted: 0,
      status: "active",
      createdAt: new Date().toISOString(),
    };
    listFor(state.schedules, userId).push(schedule);
    saveWalletState();
    return { ok: true, result: { schedule } };
  });

  registerLensAction("wallet", "scheduleUpdate", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const id = String(params.id || "").trim();
    if (!id) return { ok: false, error: "id required" };
    const list = listFor(state.schedules, userId);
    const sched = list.find(s => s.id === id);
    if (!sched) return { ok: false, error: "schedule not found" };
    if (params.status) {
      if (!["active", "paused", "canceled"].includes(params.status)) {
        return { ok: false, error: "status invalid" };
      }
      sched.status = params.status;
    }
    if (params.amount !== undefined) {
      const amt = Number(params.amount);
      if (amt > 0) sched.amount = Math.round(amt * 100) / 100;
    }
    if (params.note !== undefined) sched.note = String(params.note).trim();
    saveWalletState();
    return { ok: true, result: { schedule: sched } };
  });

  registerLensAction("wallet", "scheduleDelete", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const id = String(params.id || "").trim();
    const list = listFor(state.schedules, userId);
    const idx = list.findIndex(s => s.id === id);
    if (idx === -1) return { ok: false, error: "schedule not found" };
    list.splice(idx, 1);
    saveWalletState();
    return { ok: true, result: { deleted: id } };
  });

  // ── Social transaction feed ────────────────────────────────────────────────

  registerLensAction("wallet", "feedPost", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const counterparty = String(params.counterparty || params.to || "").trim();
    const note = String(params.note || "").trim();
    if (!counterparty) return { ok: false, error: "counterparty required" };
    if (!note) return { ok: false, error: "note required" };
    const entry = {
      id: genId("feed"),
      actorId: userId,
      counterparty,
      direction: params.direction === "received" ? "received" : "sent",
      note,
      emoji: String(params.emoji || "").trim().slice(0, 8),
      amount: params.amount !== undefined ? Math.round((Number(params.amount) || 0) * 100) / 100 : null,
      visibility: ["public", "friends", "private"].includes(params.visibility) ? params.visibility : "friends",
      likes: [],
      comments: [],
      createdAt: new Date().toISOString(),
    };
    listFor(state.feed, userId).push(entry);
    saveWalletState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("wallet", "feedList", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const scope = params.scope; // 'mine' | 'all'
    let entries = [];
    if (scope === "mine") {
      entries = [...listFor(state.feed, userId)];
    } else {
      for (const [owner, list] of state.feed.entries()) {
        for (const e of list) {
          if (owner === userId || e.visibility !== "private") entries.push(e);
        }
      }
    }
    entries.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    const limit = Math.min(Number(params.limit) || 50, 200);
    return { ok: true, result: { entries: entries.slice(0, limit), count: entries.length } };
  });

  registerLensAction("wallet", "feedLike", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const id = String(params.id || "").trim();
    if (!id) return { ok: false, error: "id required" };
    let target = null;
    for (const list of state.feed.values()) {
      const e = list.find(x => x.id === id);
      if (e) target = e;
    }
    if (!target) return { ok: false, error: "entry not found" };
    const idx = target.likes.indexOf(userId);
    if (idx === -1) target.likes.push(userId);
    else target.likes.splice(idx, 1);
    if (params.comment !== undefined) {
      const text = String(params.comment).trim();
      if (text) {
        target.comments.push({ userId, text, at: new Date().toISOString() });
      }
    }
    saveWalletState();
    return { ok: true, result: { entry: target, liked: idx === -1 } };
  });

  // ── Split-the-bill ─────────────────────────────────────────────────────────

  registerLensAction("wallet", "splitCreate", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const total = Number(params.total) || 0;
    if (total <= 0) return { ok: false, error: "total must be positive" };
    const participants = Array.isArray(params.participants)
      ? params.participants.map(p => String(p).trim()).filter(Boolean)
      : [];
    if (participants.length === 0) return { ok: false, error: "participants required" };
    // include creator in the split unless told otherwise
    const includeCreator = params.includeCreator !== false;
    const allMembers = includeCreator
      ? Array.from(new Set([userId, ...participants]))
      : Array.from(new Set(participants));
    if (allMembers.length === 0) return { ok: false, error: "at least one member required" };
    let shares;
    if (params.shares && typeof params.shares === "object") {
      // custom amounts per member
      shares = allMembers.map(m => ({
        userId: m,
        amount: Math.round((Number(params.shares[m]) || 0) * 100) / 100,
      }));
      const sum = shares.reduce((s, x) => s + x.amount, 0);
      if (Math.abs(sum - total) > 0.01) {
        return { ok: false, error: "custom shares must sum to total" };
      }
    } else {
      // even split — distribute rounding remainder to first member
      const even = Math.floor((total / allMembers.length) * 100) / 100;
      shares = allMembers.map(m => ({ userId: m, amount: even }));
      const remainder = Math.round((total - even * allMembers.length) * 100) / 100;
      if (remainder !== 0 && shares.length) shares[0].amount = Math.round((shares[0].amount + remainder) * 100) / 100;
    }
    const split = {
      id: genId("split"),
      creatorId: userId,
      title: String(params.title || "Split").trim(),
      total: Math.round(total * 100) / 100,
      shares: shares.map(s => ({ ...s, paid: s.userId === userId, paidAt: s.userId === userId ? new Date().toISOString() : null })),
      note: String(params.note || "").trim(),
      status: "open",
      createdAt: new Date().toISOString(),
    };
    listFor(state.splits, userId).push(split);
    saveWalletState();
    return { ok: true, result: { split } };
  });

  registerLensAction("wallet", "splitList", (ctx, _artifact, _params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    // splits the user created OR is a participant in
    const seen = new Set();
    const splits = [];
    for (const list of state.splits.values()) {
      for (const sp of list) {
        if (seen.has(sp.id)) continue;
        if (sp.creatorId === userId || sp.shares.some(s => s.userId === userId)) {
          seen.add(sp.id);
          splits.push(sp);
        }
      }
    }
    splits.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return { ok: true, result: { splits, count: splits.length } };
  });

  registerLensAction("wallet", "splitSettle", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const id = String(params.id || "").trim();
    if (!id) return { ok: false, error: "id required" };
    let split = null;
    for (const list of state.splits.values()) {
      const sp = list.find(x => x.id === id);
      if (sp) split = sp;
    }
    if (!split) return { ok: false, error: "split not found" };
    // member marks their own share paid; creator may settle any share
    const memberId = String(params.memberId || userId).trim();
    if (memberId !== userId && split.creatorId !== userId) {
      return { ok: false, error: "only the member or creator may settle a share" };
    }
    const share = split.shares.find(s => s.userId === memberId);
    if (!share) return { ok: false, error: "member is not part of this split" };
    share.paid = true;
    share.paidAt = new Date().toISOString();
    if (split.shares.every(s => s.paid)) split.status = "settled";
    const owed = split.shares.filter(s => !s.paid).reduce((sum, s) => sum + s.amount, 0);
    saveWalletState();
    return { ok: true, result: { split, outstandingOwed: Math.round(owed * 100) / 100 } };
  });

  // ── Linked funding sources / cards ─────────────────────────────────────────

  registerLensAction("wallet", "cardList", (ctx, _artifact, _params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const cards = [...listFor(state.cards, userId)];
    return { ok: true, result: { cards, count: cards.length } };
  });

  registerLensAction("wallet", "cardAdd", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const type = params.type;
    if (!["card", "bank", "paypal"].includes(type)) {
      return { ok: false, error: "type must be card, bank, or paypal" };
    }
    const label = String(params.label || "").trim();
    if (!label) return { ok: false, error: "label required" };
    // store only the last 4 digits — never a full PAN
    const last4 = String(params.last4 || "").replace(/\D/g, "").slice(-4);
    if (type !== "paypal" && last4.length !== 4) {
      return { ok: false, error: "last4 must be exactly 4 digits" };
    }
    const list = listFor(state.cards, userId);
    const card = {
      id: genId("card"),
      type,
      label,
      last4: last4 || null,
      brand: String(params.brand || "").trim() || null,
      isDefault: list.length === 0,
      addedAt: new Date().toISOString(),
    };
    list.push(card);
    saveWalletState();
    return { ok: true, result: { card } };
  });

  registerLensAction("wallet", "cardSetDefault", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const id = String(params.id || "").trim();
    const list = listFor(state.cards, userId);
    const card = list.find(c => c.id === id);
    if (!card) return { ok: false, error: "card not found" };
    for (const c of list) c.isDefault = c.id === id;
    saveWalletState();
    return { ok: true, result: { card } };
  });

  registerLensAction("wallet", "cardRemove", (ctx, _artifact, params = {}) => {
    const state = getWalletState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = uid(ctx);
    const id = String(params.id || "").trim();
    const list = listFor(state.cards, userId);
    const idx = list.findIndex(c => c.id === id);
    if (idx === -1) return { ok: false, error: "card not found" };
    const wasDefault = list[idx].isDefault;
    list.splice(idx, 1);
    if (wasDefault && list.length > 0) list[0].isDefault = true;
    saveWalletState();
    return { ok: true, result: { removed: id } };
  });

  // ── QR-code pay / receive ──────────────────────────────────────────────────

  registerLensAction("wallet", "qrGenerate", (ctx, _artifact, params = {}) => {
    const userId = uid(ctx);
    const amount = params.amount !== undefined ? Number(params.amount) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      return { ok: false, error: "amount must be a non-negative number" };
    }
    const note = String(params.note || "").trim();
    const payload = {
      v: 1,
      kind: "concord-wallet-pay",
      to: userId,
      amount: amount !== null ? Math.round(amount * 100) / 100 : null,
      note: note || null,
      ts: Date.now(),
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return {
      ok: true,
      result: {
        payload,
        token: encoded,
        deepLink: `concord://wallet/pay?d=${encoded}`,
        webLink: `/lenses/wallet?qr=${encoded}`,
      },
    };
  });

  registerLensAction("wallet", "qrResolve", (_ctx, _artifact, params = {}) => {
    const token = String(params.token || "").trim();
    if (!token) return { ok: false, error: "token required" };
    let payload;
    try {
      payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    } catch (_e) {
      return { ok: false, error: "invalid QR token" };
    }
    if (!payload || payload.kind !== "concord-wallet-pay" || !payload.to) {
      return { ok: false, error: "not a valid Concord wallet QR code" };
    }
    return {
      ok: true,
      result: {
        recipientId: payload.to,
        amount: typeof payload.amount === "number" ? payload.amount : null,
        note: payload.note || null,
        amountLocked: typeof payload.amount === "number" && payload.amount > 0,
      },
    };
  });

  // ── Spending insights dashboard ────────────────────────────────────────────
  // Aggregates categorize + trend over a transactions array supplied by the
  // page (built from the real /api/economy/history feed) into a chart-ready shape.

  registerLensAction("wallet", "spendingInsights", (_ctx, artifact, params = {}) => {
    const transactions = params.transactions || artifact?.data?.transactions || [];
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return { ok: true, result: { hasData: false, message: "No transactions yet" } };
    }
    const categoryPatterns = {
      "Groceries": /walmart|costco|trader\s*joe|whole\s*foods|kroger|safeway|aldi|publix|grocery|market/i,
      "Dining": /mcdonald|starbucks|chipotle|restaurant|cafe|diner|grill|doordash|grubhub|uber\s*eats|pizza|coffee/i,
      "Transportation": /uber|lyft|taxi|gas|parking|toll|transit|metro|fuel|fare/i,
      "Shopping": /amazon|target|best\s*buy|ebay|etsy|store|shop/i,
      "Entertainment": /netflix|spotify|hulu|disney|steam|cinema|movie|ticket|game/i,
      "Bills": /electric|water|internet|utility|rent|mortgage|insurance|bill/i,
      "Transfers": /transfer|send|payment|p2p/i,
      "Fees": /\bfee\b|withdrawal\s*fee|service\s*charge/i,
    };
    const catTotals = {};
    const catCounts = {};
    const monthly = {};
    let totalOut = 0;
    let totalIn = 0;
    for (const tx of transactions) {
      const amt = Number(tx.amount) || 0;
      const label = String(tx.description || tx.merchant || tx.type || "");
      const date = String(tx.created_at || tx.timestamp || tx.date || "");
      const monthKey = (date.match(/^(\d{4})-(\d{2})/) || [])[0] || "unknown";
      if (amt >= 0) {
        totalIn += amt;
      } else {
        const spend = Math.abs(amt);
        totalOut += spend;
        let cat = "Other";
        for (const [c, re] of Object.entries(categoryPatterns)) {
          if (re.test(label) || re.test(String(tx.type || ""))) { cat = c; break; }
        }
        catTotals[cat] = (catTotals[cat] || 0) + spend;
        catCounts[cat] = (catCounts[cat] || 0) + 1;
        if (monthKey !== "unknown") monthly[monthKey] = (monthly[monthKey] || 0) + spend;
      }
    }
    const byCategory = Object.entries(catTotals)
      .map(([category, total]) => ({
        category,
        total: Math.round(total * 100) / 100,
        count: catCounts[category],
        percent: totalOut > 0 ? Math.round((total / totalOut) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.total - a.total);
    const monthSeries = Object.keys(monthly).sort().map(m => ({
      month: m,
      spent: Math.round(monthly[m] * 100) / 100,
    }));
    const avgMonthly = monthSeries.length
      ? Math.round((monthSeries.reduce((s, m) => s + m.spent, 0) / monthSeries.length) * 100) / 100
      : 0;
    let trend = "stable";
    if (monthSeries.length >= 2) {
      const first = monthSeries[0].spent;
      const last = monthSeries[monthSeries.length - 1].spent;
      if (last > first * 1.05) trend = "increasing";
      else if (last < first * 0.95) trend = "decreasing";
    }
    return {
      ok: true,
      result: {
        hasData: true,
        totalSpent: Math.round(totalOut * 100) / 100,
        totalReceived: Math.round(totalIn * 100) / 100,
        net: Math.round((totalIn - totalOut) * 100) / 100,
        transactionCount: transactions.length,
        byCategory,
        monthSeries,
        averageMonthly: avgMonthly,
        trend,
        topCategory: byCategory[0] || null,
      },
    };
  });
}
