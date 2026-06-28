// server/domains/billing.js
// Domain actions for billing and invoicing: invoice calculation, revenue recognition, churn prediction.

export default function registerBillingActions(registerLensAction) {
  // Finite-coercion guard for money compute. parseFloat("Infinity")||0 === Infinity
  // and parseFloat("1e999")||0 === Infinity — both are TRUTHY so the `||0` fallback
  // never fires, letting a non-finite value poison a subtotal/total. finNum collapses
  // any non-finite (Infinity / -Infinity / NaN) OR absurd-magnitude (> 1e12) input to 0
  // so every downstream sum stays finite (fail-CLOSED on the compute path). The 1e12
  // ceiling also stops a finite-but-huge value from overflowing to Infinity at the
  // ×100 cents-rounding step (1e308 * 100 === Infinity).
  const FIN_CAP = 1e12;
  const finNum = (v, d = 0) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && Math.abs(n) <= FIN_CAP ? n : d;
  };

  /**
   * invoiceCalculation
   * Calculate invoice totals with tiered pricing, volume discounts, tax computation,
   * currency conversion.
   * artifact.data.lineItems: [{ description, quantity, unitPrice, category?, taxable? }]
   * artifact.data.pricingTiers: [{ minQty, maxQty, pricePerUnit }] — optional tiered pricing
   * artifact.data.discountRules: [{ type: "volume"|"percentage"|"fixed", threshold?, value }]
   * params.taxRate — tax rate as decimal (default 0)
   * params.currency — target currency code (default "USD")
   * params.exchangeRates — { currencyCode: rateToTarget } (optional)
   */
  registerLensAction("billing", "invoiceCalculation", (ctx, artifact, params) => {
  try {
    const lineItems = artifact.data.lineItems || [];
    const pricingTiers = artifact.data.pricingTiers || [];
    const discountRules = artifact.data.discountRules || [];
    const taxRate = finNum(params.taxRate);
    const currency = params.currency || "USD";
    const exchangeRates = params.exchangeRates || {};

    if (lineItems.length === 0) {
      return { ok: true, result: { message: "No line items provided." } };
    }

    // Tiered pricing: given quantity, compute cost using tiers
    function computeTieredCost(quantity, unitPrice) {
      if (pricingTiers.length === 0) {
        return quantity * unitPrice;
      }

      // Sort tiers by minQty
      const sorted = [...pricingTiers].sort((a, b) => (a.minQty || 0) - (b.minQty || 0));
      let remaining = quantity;
      let cost = 0;

      for (const tier of sorted) {
        const tierMin = tier.minQty || 0;
        const tierMax = tier.maxQty || Infinity;
        const tierRange = tierMax - tierMin + 1;
        const unitsInTier = Math.min(remaining, tierRange);

        if (unitsInTier > 0 && remaining > 0) {
          cost += unitsInTier * finNum(tier.pricePerUnit);
          remaining -= unitsInTier;
        }

        if (remaining <= 0) break;
      }

      // Any remaining units at last tier price
      if (remaining > 0 && sorted.length > 0) {
        cost += remaining * finNum(sorted[sorted.length - 1].pricePerUnit);
      }

      return cost;
    }

    // Process each line item
    let subtotal = 0;
    const processedItems = lineItems.map((item, idx) => {
      const quantity = finNum(item.quantity);
      const unitPrice = finNum(item.unitPrice);
      const isTaxable = item.taxable !== false;

      const lineTotal = pricingTiers.length > 0
        ? computeTieredCost(quantity, unitPrice)
        : quantity * unitPrice;

      const rounded = Math.round(lineTotal * 100) / 100;
      subtotal += rounded;

      return {
        lineNumber: idx + 1,
        description: item.description,
        quantity,
        unitPrice,
        usedTieredPricing: pricingTiers.length > 0,
        lineTotal: rounded,
        effectiveUnitPrice: quantity > 0 ? Math.round((rounded / quantity) * 10000) / 10000 : 0,
        taxable: isTaxable,
        category: item.category || "general",
      };
    });

    subtotal = Math.round(subtotal * 100) / 100;

    // Apply discount rules
    let totalDiscount = 0;
    const appliedDiscounts = [];
    const totalQuantity = processedItems.reduce((s, i) => s + i.quantity, 0);

    for (const rule of discountRules) {
      let discountAmount = 0;

      switch (rule.type) {
        case "volume":
          if (totalQuantity >= (rule.threshold || 0)) {
            // Volume discount: percentage off based on volume
            discountAmount = Math.round(subtotal * finNum(rule.value) * 100) / 100;
            appliedDiscounts.push({
              type: "volume",
              reason: `Volume threshold ${rule.threshold} met (qty: ${totalQuantity})`,
              amount: discountAmount,
            });
          }
          break;

        case "percentage":
          discountAmount = Math.round(subtotal * finNum(rule.value) * 100) / 100;
          appliedDiscounts.push({
            type: "percentage",
            reason: `${Math.round(finNum(rule.value) * 100)}% discount`,
            amount: discountAmount,
          });
          break;

        case "fixed":
          discountAmount = Math.min(subtotal, finNum(rule.value));
          appliedDiscounts.push({
            type: "fixed",
            reason: `Fixed discount`,
            amount: Math.round(discountAmount * 100) / 100,
          });
          break;
      }

      totalDiscount += discountAmount;
    }

    totalDiscount = Math.round(Math.min(totalDiscount, subtotal) * 100) / 100;
    const afterDiscount = Math.round((subtotal - totalDiscount) * 100) / 100;

    // Tax computation
    const taxableAmount = processedItems
      .filter(i => i.taxable)
      .reduce((s, i) => s + i.lineTotal, 0);
    const taxableAfterDiscount = taxableAmount > 0
      ? Math.round((taxableAmount / subtotal) * afterDiscount * 100) / 100
      : 0;
    const taxAmount = Math.round(taxableAfterDiscount * taxRate * 100) / 100;

    const total = Math.round((afterDiscount + taxAmount) * 100) / 100;

    // Currency conversion
    let convertedTotal = null;
    if (Object.keys(exchangeRates).length > 0) {
      convertedTotal = {};
      for (const [curr, rate] of Object.entries(exchangeRates)) {
        convertedTotal[curr] = Math.round(total * finNum(rate) * 100) / 100;
      }
    }

    // Category breakdown
    const categoryBreakdown = {};
    for (const item of processedItems) {
      if (!categoryBreakdown[item.category]) {
        categoryBreakdown[item.category] = { lineCount: 0, total: 0 };
      }
      categoryBreakdown[item.category].lineCount++;
      categoryBreakdown[item.category].total = Math.round(
        (categoryBreakdown[item.category].total + item.lineTotal) * 100
      ) / 100;
    }

    const result = {
      generatedAt: new Date().toISOString(),
      currency,
      lineItems: processedItems,
      subtotal,
      discounts: {
        applied: appliedDiscounts,
        totalDiscount,
      },
      afterDiscount,
      tax: {
        rate: taxRate,
        ratePct: Math.round(taxRate * 10000) / 100,
        taxableAmount: taxableAfterDiscount,
        taxAmount,
      },
      total,
      convertedTotals: convertedTotal,
      categoryBreakdown,
      summary: {
        lineItemCount: processedItems.length,
        totalQuantity,
        avgUnitPrice: processedItems.length > 0
          ? Math.round((subtotal / totalQuantity) * 10000) / 10000
          : 0,
      },
    };

    artifact.data.invoiceCalculation = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * revenueRecognition
   * Apply revenue recognition rules — pro-rata calculations, deferred revenue
   * scheduling, ASC 606 multi-element arrangements.
   * artifact.data.contracts: [{ id, customer, totalValue, startDate, endDate, deliverables: [{ name, standalonePrice, deliveredDate? }], billingSchedule?: [{ date, amount }] }]
   * params.recognitionDate — date to compute recognition as of (default: now)
   */
  registerLensAction("billing", "revenueRecognition", (ctx, artifact, params) => {
  try {
    const contracts = artifact.data.contracts || [];
    if (contracts.length === 0) {
      return { ok: true, result: { message: "No contracts provided." } };
    }

    const recognitionDate = params.recognitionDate ? new Date(params.recognitionDate) : new Date();

    const contractResults = contracts.map(contract => {
      const startDate = new Date(contract.startDate);
      const endDate = new Date(contract.endDate);
      const totalValue = finNum(contract.totalValue);
      const deliverables = contract.deliverables || [];
      const billingSchedule = contract.billingSchedule || [];

      // Contract duration in days
      const totalDays = Math.max(1, (endDate - startDate) / 86400000);
      const elapsedDays = Math.max(0, Math.min(totalDays, (recognitionDate - startDate) / 86400000));
      const completionPct = Math.round((elapsedDays / totalDays) * 10000) / 100;

      // ASC 606 Step 4: Allocate transaction price to deliverables
      // Using relative standalone selling price method
      const totalStandalonePrice = deliverables.reduce((s, d) => s + finNum(d.standalonePrice), 0);

      const deliverableAllocation = deliverables.map(d => {
        const standalonePrice = finNum(d.standalonePrice);
        const allocationRatio = totalStandalonePrice > 0 ? standalonePrice / totalStandalonePrice : 0;
        const allocatedAmount = Math.round(totalValue * allocationRatio * 100) / 100;

        // Revenue recognition: delivered items are recognized, undelivered are deferred
        const isDelivered = d.deliveredDate && new Date(d.deliveredDate) <= recognitionDate;

        return {
          name: d.name,
          standalonePrice,
          allocationRatio: Math.round(allocationRatio * 10000) / 10000,
          allocatedAmount,
          deliveredDate: d.deliveredDate || null,
          isDelivered,
          recognizedRevenue: isDelivered ? allocatedAmount : 0,
          deferredRevenue: isDelivered ? 0 : allocatedAmount,
        };
      });

      // Pro-rata recognition for time-based deliverables (subscription-like)
      const proRataRevenue = Math.round(totalValue * (elapsedDays / totalDays) * 100) / 100;

      // Total recognized from deliverable-based approach
      const deliverableBasedRecognized = deliverableAllocation.reduce((s, d) => s + d.recognizedRevenue, 0);
      const deliverableBasedDeferred = deliverableAllocation.reduce((s, d) => s + d.deferredRevenue, 0);

      // Billing vs recognition analysis
      const totalBilled = billingSchedule
        .filter(b => new Date(b.date) <= recognitionDate)
        .reduce((s, b) => s + finNum(b.amount), 0);

      const unbilledRevenue = Math.round(Math.max(0, deliverableBasedRecognized - totalBilled) * 100) / 100;
      const deferredFromBilling = Math.round(Math.max(0, totalBilled - deliverableBasedRecognized) * 100) / 100;

      // Deferred revenue schedule: monthly breakdown of remaining revenue
      const monthlySchedule = [];
      if (endDate > recognitionDate) {
        const remainingDays = (endDate - recognitionDate) / 86400000;
        const remainingMonths = Math.ceil(remainingDays / 30);
        const remainingRevenue = totalValue - proRataRevenue;
        const monthlyRecognition = remainingMonths > 0 ? Math.round((remainingRevenue / remainingMonths) * 100) / 100 : 0;

        const currentDate = new Date(recognitionDate);
        for (let m = 0; m < remainingMonths && m < 36; m++) {
          const monthStart = new Date(currentDate);
          monthStart.setMonth(monthStart.getMonth() + m);
          monthlySchedule.push({
            month: monthStart.toISOString().slice(0, 7),
            amount: monthlyRecognition,
            cumulativeRecognized: Math.round((proRataRevenue + monthlyRecognition * (m + 1)) * 100) / 100,
          });
        }
      }

      return {
        contractId: contract.id,
        customer: contract.customer,
        totalValue,
        startDate: contract.startDate,
        endDate: contract.endDate,
        totalDays: Math.round(totalDays),
        elapsedDays: Math.round(elapsedDays),
        completionPct,
        proRataRevenue,
        deliverableAllocation,
        recognizedRevenue: Math.round(deliverableBasedRecognized * 100) / 100,
        deferredRevenue: Math.round(deliverableBasedDeferred * 100) / 100,
        totalBilled: Math.round(totalBilled * 100) / 100,
        unbilledRevenue,
        deferredFromBilling,
        monthlySchedule,
      };
    });

    const totalRecognized = Math.round(contractResults.reduce((s, c) => s + c.recognizedRevenue, 0) * 100) / 100;
    const totalDeferred = Math.round(contractResults.reduce((s, c) => s + c.deferredRevenue, 0) * 100) / 100;
    const totalContractValue = Math.round(contractResults.reduce((s, c) => s + c.totalValue, 0) * 100) / 100;

    const result = {
      analyzedAt: new Date().toISOString(),
      recognitionDate: recognitionDate.toISOString().split("T")[0],
      contractCount: contracts.length,
      totalContractValue,
      totalRecognizedRevenue: totalRecognized,
      totalDeferredRevenue: totalDeferred,
      recognitionRate: totalContractValue > 0
        ? Math.round((totalRecognized / totalContractValue) * 10000) / 100
        : 0,
      contracts: contractResults,
    };

    artifact.data.revenueRecognition = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * churnPrediction
   * Predict customer churn from billing patterns — payment delays, usage decline,
   * engagement scoring using logistic regression.
   * artifact.data.customers: [{ id, name, monthlyPayments: [{ month, amount, daysPastDue?, usage?, supportTickets? }], tenureMonths? }]
   * params.churnThreshold — probability threshold for churn flag (default 0.5)
   */
  registerLensAction("billing", "churnPrediction", (ctx, artifact, params) => {
  try {
    const customers = artifact.data.customers || [];
    if (customers.length === 0) {
      return { ok: true, result: { message: "No customer data provided." } };
    }

    const churnThreshold = params.churnThreshold || 0.5;

    // Feature extraction per customer
    const predictions = customers.map(customer => {
      const payments = customer.monthlyPayments || [];
      const tenure = customer.tenureMonths || payments.length;

      if (payments.length === 0) {
        return {
          customerId: customer.id,
          customerName: customer.name,
          churnProbability: 0.5,
          churnRisk: "unknown",
          features: {},
          reason: "No payment history available",
        };
      }

      // Feature 1: Average days past due (higher = riskier)
      const delays = payments.map(p => finNum(p.daysPastDue));
      const avgDelay = delays.reduce((s, d) => s + d, 0) / delays.length;

      // Feature 2: Delay trend (increasing delays = riskier)
      let delayTrend = 0;
      if (delays.length >= 3) {
        const recentDelays = delays.slice(-3);
        const olderDelays = delays.slice(0, -3);
        const recentAvg = recentDelays.reduce((s, d) => s + d, 0) / recentDelays.length;
        const olderAvg = olderDelays.length > 0 ? olderDelays.reduce((s, d) => s + d, 0) / olderDelays.length : 0;
        delayTrend = recentAvg - olderAvg;
      }

      // Feature 3: Payment amount decline
      const amounts = payments.map(p => finNum(p.amount));
      let amountDecline = 0;
      if (amounts.length >= 3) {
        const recentAmts = amounts.slice(-3);
        const olderAmts = amounts.slice(0, -3);
        const recentAvg = recentAmts.reduce((s, a) => s + a, 0) / recentAmts.length;
        const olderAvg = olderAmts.length > 0 ? olderAmts.reduce((s, a) => s + a, 0) / olderAmts.length : recentAvg;
        amountDecline = olderAvg > 0 ? (olderAvg - recentAvg) / olderAvg : 0;
      }

      // Feature 4: Usage decline
      const usageValues = payments.map(p => parseFloat(p.usage)).filter(u => Number.isFinite(u));
      let usageDecline = 0;
      if (usageValues.length >= 3) {
        const recentUsage = usageValues.slice(-3);
        const olderUsage = usageValues.slice(0, -3);
        const recentAvg = recentUsage.reduce((s, u) => s + u, 0) / recentUsage.length;
        const olderAvg = olderUsage.length > 0 ? olderUsage.reduce((s, u) => s + u, 0) / olderUsage.length : recentAvg;
        usageDecline = olderAvg > 0 ? (olderAvg - recentAvg) / olderAvg : 0;
      }

      // Feature 5: Support ticket frequency (high = mixed signal, but often precedes churn)
      const tickets = payments.map(p => finNum(p.supportTickets));
      const avgTickets = tickets.reduce((s, t) => s + t, 0) / tickets.length;

      // Feature 6: Tenure effect (newer customers churn more)
      const tenureEffect = 1 / (1 + Math.log2(tenure + 1));

      // Logistic regression: P(churn) = sigmoid(w0 + w1*x1 + w2*x2 + ...)
      // Using pre-defined weights based on typical churn models
      const weights = {
        intercept: -1.5,
        avgDelay: 0.05,         // Each day of avg delay increases risk
        delayTrend: 0.15,       // Increasing delays are risky
        amountDecline: 3.0,     // Revenue decline is very risky
        usageDecline: 2.5,      // Usage decline is risky
        supportTickets: 0.2,    // More tickets = somewhat risky
        tenureEffect: 2.0,      // New customers churn more
      };

      const logit = weights.intercept
        + weights.avgDelay * avgDelay
        + weights.delayTrend * Math.max(0, delayTrend)
        + weights.amountDecline * Math.max(0, amountDecline)
        + weights.usageDecline * Math.max(0, usageDecline)
        + weights.supportTickets * avgTickets
        + weights.tenureEffect * tenureEffect;

      // Sigmoid function
      const churnProbability = Math.round((1 / (1 + Math.exp(-logit))) * 10000) / 10000;

      const churnRisk = churnProbability >= 0.7 ? "high"
        : churnProbability >= churnThreshold ? "medium"
        : churnProbability >= 0.3 ? "low"
        : "very-low";

      // Top risk factors
      const factors = [
        { factor: "paymentDelays", contribution: weights.avgDelay * avgDelay, value: Math.round(avgDelay * 100) / 100 },
        { factor: "delayTrend", contribution: weights.delayTrend * Math.max(0, delayTrend), value: Math.round(delayTrend * 100) / 100 },
        { factor: "amountDecline", contribution: weights.amountDecline * Math.max(0, amountDecline), value: Math.round(amountDecline * 10000) / 100 },
        { factor: "usageDecline", contribution: weights.usageDecline * Math.max(0, usageDecline), value: Math.round(usageDecline * 10000) / 100 },
        { factor: "supportTickets", contribution: weights.supportTickets * avgTickets, value: Math.round(avgTickets * 100) / 100 },
        { factor: "tenure", contribution: weights.tenureEffect * tenureEffect, value: tenure },
      ].sort((a, b) => b.contribution - a.contribution);

      return {
        customerId: customer.id,
        customerName: customer.name,
        churnProbability,
        churnRisk,
        isAtRisk: churnProbability >= churnThreshold,
        tenure,
        features: {
          avgPaymentDelay: Math.round(avgDelay * 100) / 100,
          delayTrend: Math.round(delayTrend * 100) / 100,
          amountDeclinePct: Math.round(amountDecline * 10000) / 100,
          usageDeclinePct: Math.round(usageDecline * 10000) / 100,
          avgSupportTickets: Math.round(avgTickets * 100) / 100,
        },
        topRiskFactors: factors.filter(f => f.contribution > 0).slice(0, 3),
      };
    });

    // Sort by churn probability
    predictions.sort((a, b) => b.churnProbability - a.churnProbability);

    const atRiskCount = predictions.filter(p => p.isAtRisk).length;
    const atRiskRevenue = predictions
      .filter(p => p.isAtRisk)
      .reduce((s, p) => {
        const cust = customers.find(c => c.id === p.customerId);
        const payments = cust?.monthlyPayments || [];
        const lastPayment = payments.length > 0 ? finNum(payments[payments.length - 1].amount) : 0;
        return s + lastPayment * 12;
      }, 0);

    const result = {
      analyzedAt: new Date().toISOString(),
      totalCustomers: customers.length,
      churnThreshold,
      atRiskCount,
      atRiskPct: customers.length > 0 ? Math.round((atRiskCount / customers.length) * 10000) / 100 : 0,
      estimatedAtRiskAnnualRevenue: Math.round(atRiskRevenue * 100) / 100,
      predictions,
      riskDistribution: {
        high: predictions.filter(p => p.churnRisk === "high").length,
        medium: predictions.filter(p => p.churnRisk === "medium").length,
        low: predictions.filter(p => p.churnRisk === "low").length,
        veryLow: predictions.filter(p => p.churnRisk === "very-low").length,
      },
    };

    artifact.data.churnPrediction = result;
    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ──────────────────────────────────────────────────────────────────────────
  // Parity-sprint macros — subscription billing core
  // Persistent per-user state in globalThis._concordSTATE.billingLens.
  // ──────────────────────────────────────────────────────────────────────────

  function getBillState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.billingLens) STATE.billingLens = {};
    const s = STATE.billingLens;
    for (const k of [
      "plans", "subscriptions", "usage", "coupons",
      "customers", "invoices", "dunning",
    ]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveBillState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const billAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const billId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const billNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const round2 = (v) => Math.round(v * 100) / 100;
  const CYCLE_DAYS = { monthly: 30, quarterly: 91, annual: 365, weekly: 7 };
  function cycleDays(interval) { return CYCLE_DAYS[interval] || 30; }
  function listFor(map, userId) { return map.get(userId) || []; }
  function ensureList(map, userId) { if (!map.has(userId)) map.set(userId, []); return map.get(userId); }

  // ─── Feature: Recurring subscription plans + billing cycles + proration ───

  registerLensAction("billing", "plan-list", (ctx) => {
    const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { plans: listFor(s.plans, billAid(ctx)) } };
  });

  registerLensAction("billing", "plan-create", (ctx, _artifact, params = {}) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "name required" };
      const interval = ["monthly", "quarterly", "annual", "weekly"].includes(params.interval) ? params.interval : "monthly";
      const plan = {
        id: billId("plan"),
        name,
        interval,
        amount: Math.max(0, round2(billNum(params.amount))),
        currency: String(params.currency || "USD").toUpperCase(),
        trialDays: Math.max(0, Math.round(billNum(params.trialDays))),
        meteredComponent: params.meteredComponent ? String(params.meteredComponent) : null,
        active: true,
        createdAt: new Date().toISOString(),
      };
      ensureList(s.plans, userId).push(plan);
      saveBillState();
      return { ok: true, result: { plan } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("billing", "subscription-list", (ctx) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const plans = listFor(s.plans, userId);
      const subs = listFor(s.subscriptions, userId).map((sub) => ({
        ...sub,
        plan: plans.find((p) => p.id === sub.planId) || null,
      }));
      const now = Date.now();
      const mrr = round2(subs
        .filter((x) => x.status === "active" || x.status === "trialing")
        .reduce((acc, x) => {
          const p = x.plan; if (!p) return acc;
          return acc + (p.amount / cycleDays(p.interval)) * 30;
        }, 0));
      return {
        ok: true,
        result: {
          subscriptions: subs,
          activeCount: subs.filter((x) => x.status === "active").length,
          trialingCount: subs.filter((x) => x.status === "trialing").length,
          mrr,
          arr: round2(mrr * 12),
          asOf: new Date(now).toISOString(),
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("billing", "subscription-create", (ctx, _artifact, params = {}) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const plan = listFor(s.plans, userId).find((p) => p.id === params.planId);
      if (!plan) return { ok: false, error: "plan not found" };
      const customerName = String(params.customerName || "Customer").trim();
      const now = new Date();
      const trialing = plan.trialDays > 0;
      const periodStart = now;
      const periodEnd = new Date(now.getTime() + (trialing ? plan.trialDays : cycleDays(plan.interval)) * 86400000);
      const sub = {
        id: billId("sub"),
        planId: plan.id,
        customerName,
        quantity: Math.max(1, Math.round(billNum(params.quantity, 1))),
        status: trialing ? "trialing" : "active",
        currentPeriodStart: periodStart.toISOString(),
        currentPeriodEnd: periodEnd.toISOString(),
        cancelAtPeriodEnd: false,
        createdAt: now.toISOString(),
      };
      ensureList(s.subscriptions, userId).push(sub);
      saveBillState();
      return { ok: true, result: { subscription: sub } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Proration when switching plans mid-cycle.
  registerLensAction("billing", "subscription-proration", (ctx, _artifact, params = {}) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const subs = listFor(s.subscriptions, userId);
      const plans = listFor(s.plans, userId);
      const sub = subs.find((x) => x.id === params.subscriptionId);
      if (!sub) return { ok: false, error: "subscription not found" };
      const oldPlan = plans.find((p) => p.id === sub.planId);
      const newPlan = plans.find((p) => p.id === params.newPlanId);
      if (!oldPlan || !newPlan) return { ok: false, error: "plan not found" };
      const periodStart = new Date(sub.currentPeriodStart).getTime();
      const periodEnd = new Date(sub.currentPeriodEnd).getTime();
      const now = Date.now();
      const totalMs = Math.max(1, periodEnd - periodStart);
      const remainingMs = Math.max(0, periodEnd - now);
      const remainingFraction = remainingMs / totalMs;
      const unusedCredit = round2(oldPlan.amount * sub.quantity * remainingFraction);
      const newPlanProrated = round2(newPlan.amount * sub.quantity * remainingFraction);
      const amountDue = round2(newPlanProrated - unusedCredit);
      const result = {
        subscriptionId: sub.id,
        fromPlan: oldPlan.name,
        toPlan: newPlan.name,
        remainingDays: Math.round(remainingMs / 86400000),
        remainingFraction: round2(remainingFraction),
        unusedCredit,
        newPlanProrated,
        amountDue,
        direction: amountDue >= 0 ? "upgrade-charge" : "downgrade-credit",
      };
      if (params.apply === true) {
        sub.planId = newPlan.id;
        saveBillState();
        result.applied = true;
      }
      return { ok: true, result };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("billing", "subscription-cancel", (ctx, _artifact, params = {}) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const sub = listFor(s.subscriptions, userId).find((x) => x.id === params.subscriptionId);
      if (!sub) return { ok: false, error: "subscription not found" };
      if (params.immediate === true) {
        sub.status = "canceled";
        sub.canceledAt = new Date().toISOString();
      } else {
        sub.cancelAtPeriodEnd = true;
      }
      saveBillState();
      return { ok: true, result: { subscription: sub } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ─── Feature: Usage-based / metered billing with rate tiers ───

  registerLensAction("billing", "usage-record", (ctx, _artifact, params = {}) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const subId = String(params.subscriptionId || "").trim();
      if (!subId) return { ok: false, error: "subscriptionId required" };
      const qty = billNum(params.quantity);
      if (qty <= 0) return { ok: false, error: "quantity must be positive" };
      const rec = {
        id: billId("use"),
        subscriptionId: subId,
        metric: String(params.metric || "api_calls"),
        quantity: qty,
        timestamp: params.timestamp || new Date().toISOString(),
      };
      ensureList(s.usage, userId).push(rec);
      saveBillState();
      return { ok: true, result: { record: rec } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Compute metered charge across rate tiers (graduated pricing).
  registerLensAction("billing", "usage-summary", (ctx, _artifact, params = {}) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const subId = String(params.subscriptionId || "").trim();
      const records = listFor(s.usage, userId).filter((r) => !subId || r.subscriptionId === subId);
      const totalQty = records.reduce((acc, r) => acc + r.quantity, 0);
      // Default graduated tier table — overridable via params.tiers.
      const tiers = Array.isArray(params.tiers) && params.tiers.length
        ? params.tiers.map((t) => ({ upTo: t.upTo == null ? Infinity : billNum(t.upTo), unitPrice: billNum(t.unitPrice) }))
        : [
          { upTo: 1000, unitPrice: 0 },
          { upTo: 10000, unitPrice: 0.002 },
          { upTo: 100000, unitPrice: 0.0015 },
          { upTo: Infinity, unitPrice: 0.001 },
        ];
      let remaining = totalQty;
      let lastBound = 0;
      let charge = 0;
      const breakdown = [];
      for (const tier of tiers) {
        if (remaining <= 0) break;
        const span = tier.upTo - lastBound;
        const inTier = Math.min(remaining, span);
        const tierCharge = round2(inTier * tier.unitPrice);
        breakdown.push({
          range: `${lastBound + 1}–${tier.upTo === Infinity ? "∞" : tier.upTo}`,
          units: inTier,
          unitPrice: tier.unitPrice,
          charge: tierCharge,
        });
        charge += tierCharge;
        remaining -= inTier;
        lastBound = tier.upTo;
      }
      // Per-metric breakdown.
      const byMetric = {};
      for (const r of records) byMetric[r.metric] = round2((byMetric[r.metric] || 0) + r.quantity);
      return {
        ok: true,
        result: {
          subscriptionId: subId || null,
          recordCount: records.length,
          totalQuantity: totalQty,
          totalCharge: round2(charge),
          tierBreakdown: breakdown,
          byMetric,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ─── Feature: Coupons / promo codes / discounts ───

  registerLensAction("billing", "coupon-list", (ctx) => {
    const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
    return { ok: true, result: { coupons: listFor(s.coupons, billAid(ctx)) } };
  });

  registerLensAction("billing", "coupon-create", (ctx, _artifact, params = {}) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const code = String(params.code || "").trim().toUpperCase();
      if (!code) return { ok: false, error: "code required" };
      const existing = listFor(s.coupons, userId);
      if (existing.some((c) => c.code === code)) return { ok: false, error: "coupon code already exists" };
      const kind = params.kind === "fixed" ? "fixed" : "percent";
      const value = Math.max(0, billNum(params.value));
      if (value <= 0) return { ok: false, error: "value must be positive" };
      const coupon = {
        id: billId("cpn"),
        code,
        kind,
        value: kind === "percent" ? Math.min(100, value) : round2(value),
        duration: ["once", "forever", "repeating"].includes(params.duration) ? params.duration : "once",
        maxRedemptions: params.maxRedemptions ? Math.max(1, Math.round(billNum(params.maxRedemptions))) : null,
        redemptions: 0,
        active: true,
        createdAt: new Date().toISOString(),
      };
      ensureList(s.coupons, userId).push(coupon);
      saveBillState();
      return { ok: true, result: { coupon } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Validate a code against an amount and return the discounted total.
  registerLensAction("billing", "coupon-apply", (ctx, _artifact, params = {}) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const code = String(params.code || "").trim().toUpperCase();
      const amount = Math.max(0, billNum(params.amount));
      const coupon = listFor(s.coupons, userId).find((c) => c.code === code);
      if (!coupon) return { ok: false, error: "invalid coupon code" };
      if (!coupon.active) return { ok: false, error: "coupon inactive" };
      if (coupon.maxRedemptions != null && coupon.redemptions >= coupon.maxRedemptions) {
        return { ok: false, error: "coupon redemption limit reached" };
      }
      const discount = coupon.kind === "percent"
        ? round2(amount * (coupon.value / 100))
        : Math.min(amount, coupon.value);
      const finalAmount = round2(amount - discount);
      if (params.redeem === true) {
        coupon.redemptions += 1;
        if (coupon.maxRedemptions != null && coupon.redemptions >= coupon.maxRedemptions) coupon.active = false;
        saveBillState();
      }
      return {
        ok: true,
        result: {
          code: coupon.code,
          kind: coupon.kind,
          discount,
          originalAmount: round2(amount),
          finalAmount,
          redeemed: params.redeem === true,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ─── Feature: Customer billing portal (cards, invoices, cancel) ───

  registerLensAction("billing", "portal-overview", (ctx) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const customers = listFor(s.customers, userId);
      const subs = listFor(s.subscriptions, userId);
      const invoices = listFor(s.invoices, userId);
      const plans = listFor(s.plans, userId);
      const activeSubs = subs.filter((x) => x.status === "active" || x.status === "trialing").map((x) => ({
        ...x, plan: plans.find((p) => p.id === x.planId) || null,
      }));
      return {
        ok: true,
        result: {
          customer: customers[0] || null,
          paymentMethod: customers[0]?.paymentMethod || null,
          activeSubscriptions: activeSubs,
          invoices: invoices.slice().sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
          openInvoiceCount: invoices.filter((i) => i.status === "open" || i.status === "past_due").length,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Update / add the saved card on file (last4 only — never store full PAN).
  registerLensAction("billing", "portal-update-card", (ctx, _artifact, params = {}) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const raw = String(params.cardNumber || "").replace(/\D/g, "");
      if (raw.length < 12) return { ok: false, error: "invalid card number" };
      const expMonth = Math.round(billNum(params.expMonth));
      const expYear = Math.round(billNum(params.expYear));
      if (expMonth < 1 || expMonth > 12) return { ok: false, error: "invalid expiry month" };
      if (expYear < new Date().getFullYear()) return { ok: false, error: "card expired" };
      const brand = raw.startsWith("4") ? "Visa"
        : /^5[1-5]/.test(raw) ? "Mastercard"
          : /^3[47]/.test(raw) ? "Amex"
            : "Card";
      const customers = ensureList(s.customers, userId);
      let customer = customers[0];
      if (!customer) {
        customer = { id: billId("cus"), name: String(params.name || "Account holder"), createdAt: new Date().toISOString() };
        customers.push(customer);
      }
      customer.paymentMethod = {
        brand,
        last4: raw.slice(-4),
        expMonth,
        expYear,
        updatedAt: new Date().toISOString(),
      };
      saveBillState();
      return { ok: true, result: { paymentMethod: customer.paymentMethod } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ─── Feature: Tax calculation per jurisdiction ───

  // Jurisdiction → effective sales/VAT rate table (representative real-world rates).
  const TAX_RATES = {
    "US-CA": { rate: 0.0725, label: "California sales tax", kind: "sales_tax" },
    "US-NY": { rate: 0.08875, label: "New York sales tax", kind: "sales_tax" },
    "US-TX": { rate: 0.0625, label: "Texas sales tax", kind: "sales_tax" },
    "US-WA": { rate: 0.065, label: "Washington sales tax", kind: "sales_tax" },
    "US-OR": { rate: 0, label: "Oregon (no sales tax)", kind: "sales_tax" },
    "EU-DE": { rate: 0.19, label: "Germany VAT", kind: "vat" },
    "EU-FR": { rate: 0.20, label: "France VAT", kind: "vat" },
    "EU-IE": { rate: 0.23, label: "Ireland VAT", kind: "vat" },
    "GB": { rate: 0.20, label: "UK VAT", kind: "vat" },
    "CA-ON": { rate: 0.13, label: "Ontario HST", kind: "hst" },
    "AU": { rate: 0.10, label: "Australia GST", kind: "gst" },
    "JP": { rate: 0.10, label: "Japan consumption tax", kind: "consumption_tax" },
  };

  registerLensAction("billing", "tax-jurisdictions", () => ({
    ok: true,
    result: {
      jurisdictions: Object.entries(TAX_RATES).map(([code, t]) => ({
        code, rate: t.rate, ratePct: round2(t.rate * 100), label: t.label, kind: t.kind,
      })),
    },
  }));

  registerLensAction("billing", "tax-calculate", (ctx, _artifact, params = {}) => {
    try {
      const jurisdiction = String(params.jurisdiction || "").trim().toUpperCase();
      const entry = TAX_RATES[jurisdiction];
      if (!entry) return { ok: false, error: `unknown jurisdiction: ${jurisdiction || "(none)"}` };
      const amount = Math.max(0, billNum(params.amount));
      // EU/GB VAT reverse charge for B2B with a valid VAT id.
      const reverseCharge = entry.kind === "vat" && params.b2b === true && !!String(params.taxId || "").trim();
      const effectiveRate = reverseCharge ? 0 : entry.rate;
      const taxAmount = round2(amount * effectiveRate);
      return {
        ok: true,
        result: {
          jurisdiction,
          label: entry.label,
          taxKind: entry.kind,
          rate: effectiveRate,
          ratePct: round2(effectiveRate * 100),
          netAmount: round2(amount),
          taxAmount,
          grossAmount: round2(amount + taxAmount),
          reverseCharge,
          note: reverseCharge ? "B2B reverse charge applied — customer self-accounts for VAT" : null,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ─── Feature: Dunning workflow for failed payments ───

  // Open a dunning case with a retry schedule when a charge fails.
  registerLensAction("billing", "dunning-open", (ctx, _artifact, params = {}) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const amount = Math.max(0, billNum(params.amount));
      if (amount <= 0) return { ok: false, error: "amount must be positive" };
      const retryOffsetsDays = [1, 3, 5, 7];
      const now = Date.now();
      const schedule = retryOffsetsDays.map((d, i) => ({
        attempt: i + 1,
        scheduledFor: new Date(now + d * 86400000).toISOString(),
        emailTemplate: i === 0 ? "payment_failed" : i === retryOffsetsDays.length - 1 ? "final_notice" : "payment_retry",
        status: "pending",
      }));
      const dunning = {
        id: billId("dun"),
        subscriptionId: params.subscriptionId ? String(params.subscriptionId) : null,
        invoiceId: params.invoiceId ? String(params.invoiceId) : null,
        amount: round2(amount),
        currency: String(params.currency || "USD").toUpperCase(),
        reason: String(params.reason || "card_declined"),
        status: "in_progress",
        attemptsUsed: 0,
        schedule,
        openedAt: new Date(now).toISOString(),
      };
      ensureList(s.dunning, userId).push(dunning);
      saveBillState();
      return { ok: true, result: { dunning } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("billing", "dunning-list", (ctx) => {
    const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const all = listFor(s.dunning, billAid(ctx));
    return {
      ok: true,
      result: {
        cases: all,
        openCount: all.filter((d) => d.status === "in_progress").length,
        recoveredCount: all.filter((d) => d.status === "recovered").length,
        lostCount: all.filter((d) => d.status === "lost").length,
      },
    };
  });

  // Record a retry outcome — advances or closes the dunning case.
  registerLensAction("billing", "dunning-retry", (ctx, _artifact, params = {}) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const dunning = listFor(s.dunning, userId).find((d) => d.id === params.dunningId);
      if (!dunning) return { ok: false, error: "dunning case not found" };
      if (dunning.status !== "in_progress") return { ok: false, error: "dunning case already closed" };
      const next = dunning.schedule.find((a) => a.status === "pending");
      if (!next) return { ok: false, error: "no pending retry" };
      const succeeded = params.outcome === "succeeded";
      next.status = succeeded ? "succeeded" : "failed";
      next.executedAt = new Date().toISOString();
      dunning.attemptsUsed += 1;
      if (succeeded) {
        dunning.status = "recovered";
        dunning.closedAt = next.executedAt;
      } else if (!dunning.schedule.some((a) => a.status === "pending")) {
        dunning.status = "lost";
        dunning.closedAt = next.executedAt;
      }
      saveBillState();
      return { ok: true, result: { dunning, attempt: next } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ─── Feature: Revenue analytics — MRR/ARR, cohorts, expansion ───

  // Create an invoice (used by analytics + portal). Light helper macro.
  registerLensAction("billing", "invoice-create", (ctx, _artifact, params = {}) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const amount = Math.max(0, billNum(params.amount));
      const invoice = {
        id: billId("inv"),
        subscriptionId: params.subscriptionId ? String(params.subscriptionId) : null,
        customerName: String(params.customerName || "Customer"),
        amount: round2(amount),
        currency: String(params.currency || "USD").toUpperCase(),
        status: ["open", "paid", "past_due", "void"].includes(params.status) ? params.status : "open",
        createdAt: new Date().toISOString(),
        dueAt: params.dueAt || new Date(Date.now() + 14 * 86400000).toISOString(),
      };
      ensureList(s.invoices, userId).push(invoice);
      saveBillState();
      return { ok: true, result: { invoice } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("billing", "revenue-analytics", (ctx) => {
    try {
      const s = getBillState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = billAid(ctx);
      const plans = listFor(s.plans, userId);
      const subs = listFor(s.subscriptions, userId);
      const planOf = (id) => plans.find((p) => p.id === id) || null;
      const monthlyValue = (sub) => {
        const p = planOf(sub.planId);
        if (!p) return 0;
        return (p.amount * sub.quantity / cycleDays(p.interval)) * 30;
      };
      const activeSubs = subs.filter((x) => x.status === "active" || x.status === "trialing");
      const mrr = round2(activeSubs.reduce((acc, x) => acc + monthlyValue(x), 0));
      // Cohort retention by signup month.
      const cohorts = {};
      for (const sub of subs) {
        const month = (sub.createdAt || "").slice(0, 7) || "unknown";
        if (!cohorts[month]) cohorts[month] = { signups: 0, retained: 0, churned: 0, mrr: 0 };
        cohorts[month].signups += 1;
        if (sub.status === "canceled") cohorts[month].churned += 1;
        else { cohorts[month].retained += 1; cohorts[month].mrr = round2(cohorts[month].mrr + monthlyValue(sub)); }
      }
      const cohortRows = Object.entries(cohorts)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, c]) => ({
          month,
          signups: c.signups,
          retained: c.retained,
          churned: c.churned,
          retentionPct: c.signups > 0 ? round2((c.retained / c.signups) * 100) : 0,
          mrr: c.mrr,
        }));
      // Expansion: total quantity above the seat-1 baseline.
      const expansionSeats = activeSubs.reduce((acc, x) => acc + Math.max(0, x.quantity - 1), 0);
      const expansionMrr = round2(activeSubs.reduce((acc, x) => {
        const p = planOf(x.planId);
        if (!p || x.quantity <= 1) return acc;
        return acc + ((p.amount * (x.quantity - 1)) / cycleDays(p.interval)) * 30;
      }, 0));
      const churnedCount = subs.filter((x) => x.status === "canceled").length;
      const churnRatePct = subs.length > 0 ? round2((churnedCount / subs.length) * 100) : 0;
      return {
        ok: true,
        result: {
          mrr,
          arr: round2(mrr * 12),
          activeSubscriptions: activeSubs.length,
          totalSubscriptions: subs.length,
          arpa: activeSubs.length > 0 ? round2(mrr / activeSubs.length) : 0,
          churnedCount,
          churnRatePct,
          expansionSeats,
          expansionMrr,
          cohorts: cohortRows,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}
