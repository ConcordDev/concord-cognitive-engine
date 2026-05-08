// server/domains/billing.js
// Domain actions for billing and invoicing: invoice calculation, revenue recognition, churn prediction.

export default function registerBillingActions(registerLensAction) {
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
    const lineItems = artifact.data.lineItems || [];
    const pricingTiers = artifact.data.pricingTiers || [];
    const discountRules = artifact.data.discountRules || [];
    const taxRate = parseFloat(params.taxRate) || 0;
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
          cost += unitsInTier * tier.pricePerUnit;
          remaining -= unitsInTier;
        }

        if (remaining <= 0) break;
      }

      // Any remaining units at last tier price
      if (remaining > 0 && sorted.length > 0) {
        cost += remaining * sorted[sorted.length - 1].pricePerUnit;
      }

      return cost;
    }

    // Process each line item
    let subtotal = 0;
    const processedItems = lineItems.map((item, idx) => {
      const quantity = parseFloat(item.quantity) || 0;
      const unitPrice = parseFloat(item.unitPrice) || 0;
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
            discountAmount = Math.round(subtotal * (parseFloat(rule.value) || 0) * 100) / 100;
            appliedDiscounts.push({
              type: "volume",
              reason: `Volume threshold ${rule.threshold} met (qty: ${totalQuantity})`,
              amount: discountAmount,
            });
          }
          break;

        case "percentage":
          discountAmount = Math.round(subtotal * (parseFloat(rule.value) || 0) * 100) / 100;
          appliedDiscounts.push({
            type: "percentage",
            reason: `${Math.round((parseFloat(rule.value) || 0) * 100)}% discount`,
            amount: discountAmount,
          });
          break;

        case "fixed":
          discountAmount = Math.min(subtotal, parseFloat(rule.value) || 0);
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
        convertedTotal[curr] = Math.round(total * parseFloat(rate) * 100) / 100;
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
  });

  /**
   * revenueRecognition
   * Apply revenue recognition rules — pro-rata calculations, deferred revenue
   * scheduling, ASC 606 multi-element arrangements.
   * artifact.data.contracts: [{ id, customer, totalValue, startDate, endDate, deliverables: [{ name, standalonePrice, deliveredDate? }], billingSchedule?: [{ date, amount }] }]
   * params.recognitionDate — date to compute recognition as of (default: now)
   */
  registerLensAction("billing", "revenueRecognition", (ctx, artifact, params) => {
    const contracts = artifact.data.contracts || [];
    if (contracts.length === 0) {
      return { ok: true, result: { message: "No contracts provided." } };
    }

    const recognitionDate = params.recognitionDate ? new Date(params.recognitionDate) : new Date();

    const contractResults = contracts.map(contract => {
      const startDate = new Date(contract.startDate);
      const endDate = new Date(contract.endDate);
      const totalValue = parseFloat(contract.totalValue) || 0;
      const deliverables = contract.deliverables || [];
      const billingSchedule = contract.billingSchedule || [];

      // Contract duration in days
      const totalDays = Math.max(1, (endDate - startDate) / 86400000);
      const elapsedDays = Math.max(0, Math.min(totalDays, (recognitionDate - startDate) / 86400000));
      const completionPct = Math.round((elapsedDays / totalDays) * 10000) / 100;

      // ASC 606 Step 4: Allocate transaction price to deliverables
      // Using relative standalone selling price method
      const totalStandalonePrice = deliverables.reduce((s, d) => s + (parseFloat(d.standalonePrice) || 0), 0);

      const deliverableAllocation = deliverables.map(d => {
        const standalonePrice = parseFloat(d.standalonePrice) || 0;
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
        .reduce((s, b) => s + (parseFloat(b.amount) || 0), 0);

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
  });

  /**
   * churnPrediction
   * Predict customer churn from billing patterns — payment delays, usage decline,
   * engagement scoring using logistic regression.
   * artifact.data.customers: [{ id, name, monthlyPayments: [{ month, amount, daysPastDue?, usage?, supportTickets? }], tenureMonths? }]
   * params.churnThreshold — probability threshold for churn flag (default 0.5)
   */
  registerLensAction("billing", "churnPrediction", (ctx, artifact, params) => {
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
      const delays = payments.map(p => parseFloat(p.daysPastDue) || 0);
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
      const amounts = payments.map(p => parseFloat(p.amount) || 0);
      let amountDecline = 0;
      if (amounts.length >= 3) {
        const recentAmts = amounts.slice(-3);
        const olderAmts = amounts.slice(0, -3);
        const recentAvg = recentAmts.reduce((s, a) => s + a, 0) / recentAmts.length;
        const olderAvg = olderAmts.length > 0 ? olderAmts.reduce((s, a) => s + a, 0) / olderAmts.length : recentAvg;
        amountDecline = olderAvg > 0 ? (olderAvg - recentAvg) / olderAvg : 0;
      }

      // Feature 4: Usage decline
      const usageValues = payments.map(p => parseFloat(p.usage)).filter(u => !isNaN(u));
      let usageDecline = 0;
      if (usageValues.length >= 3) {
        const recentUsage = usageValues.slice(-3);
        const olderUsage = usageValues.slice(0, -3);
        const recentAvg = recentUsage.reduce((s, u) => s + u, 0) / recentUsage.length;
        const olderAvg = olderUsage.length > 0 ? olderUsage.reduce((s, u) => s + u, 0) / olderUsage.length : recentAvg;
        usageDecline = olderAvg > 0 ? (olderAvg - recentAvg) / olderAvg : 0;
      }

      // Feature 5: Support ticket frequency (high = mixed signal, but often precedes churn)
      const tickets = payments.map(p => parseFloat(p.supportTickets) || 0);
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
        const lastPayment = payments.length > 0 ? parseFloat(payments[payments.length - 1].amount) || 0 : 0;
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
  });
}
