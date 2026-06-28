// server/domains/retail.js
// Domain actions for retail/CRM: reorder, pipeline, LTV, SLA checks.

export default function registerRetailActions(registerLensAction) {
  /**
   * reorderCheck
   * Flag products that have fallen below their reorder point.
   * artifact.data.products: [{ sku, name, onHand, reorderPoint, reorderQty, leadTimeDays, dailyUsage }]
   */
  registerLensAction("retail", "reorderCheck", (ctx, artifact, _params) => {
  try {
    // FAIL-CLOSED numeric coercion: parseFloat("Infinity")===Infinity would leak
    // a non-finite onHand/daysOfStock into the rendered card, so reject non-finite.
    const finNum = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
    const products = Array.isArray(artifact.data.products)
      ? artifact.data.products
      : (Array.isArray(artifact.data.inventory) ? artifact.data.inventory : []);

    const needsReorder = [];
    const critical = [];
    const sufficient = [];

    for (const product of products) {
      if (!product || typeof product !== "object") continue;
      const onHand = Math.max(0, finNum(product.onHand, 0));
      const reorderPoint = Math.max(0, finNum(product.reorderPoint, 0));
      const dailyUsage = Math.max(0, finNum(product.dailyUsage, 0));
      const leadTimeDays = finNum(product.leadTimeDays, 7);
      const daysOfStock = dailyUsage > 0 ? Math.floor(onHand / dailyUsage) : Infinity;
      const willStockOutBeforeDelivery = daysOfStock < leadTimeDays;

      const entry = {
        sku: product.sku,
        name: product.name,
        onHand,
        reorderPoint,
        reorderQty: Math.max(0, finNum(product.reorderQty, 0)),
        daysOfStock: Number.isFinite(daysOfStock) ? daysOfStock : "N/A",
        leadTimeDays,
      };

      if (onHand <= 0) {
        critical.push({ ...entry, status: "out-of-stock" });
      } else if (onHand <= reorderPoint && willStockOutBeforeDelivery) {
        critical.push({ ...entry, status: "critical-low" });
      } else if (onHand <= reorderPoint) {
        needsReorder.push({ ...entry, status: "below-reorder-point" });
      } else {
        sufficient.push({ ...entry, status: "sufficient" });
      }
    }

    const report = {
      checkedAt: new Date().toISOString(),
      totalProducts: products.length,
      criticalCount: critical.length,
      reorderCount: needsReorder.length,
      sufficientCount: sufficient.length,
      critical,
      needsReorder,
    };

    artifact.data.reorderReport = report;

    return { ok: true, result: report };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * Order-fulfillment actions — operate on an ORDER artifact (artifact.data shaped like
   * { orderNumber, customer, customerEmail, total, trackingNumber, timeline[], refundAmount, returnReason }).
   * These run from the inline order-card buttons (process_refund / send_tracking / initiate_return).
   * Deterministic Shopify-style defaults (full refund pre-filled, auto-generated tracking) so the
   * button works with zero params; optional params override (amount / reason / trackingNumber).
   */
  function pushOrderEvent(artifact, status, note) {
    if (!Array.isArray(artifact.data.timeline)) artifact.data.timeline = [];
    const event = { status, note, timestamp: nowIsoRet() };
    artifact.data.timeline.push(event);
    return event;
  }

  registerLensAction("retail", "process_refund", (ctx, artifact, params = {}) => {
  try {
    const total = Math.max(0, Number(artifact.data?.total) || 0);
    const alreadyRefunded = Math.max(0, Number(artifact.data?.refundAmount) || 0);
    const remaining = Math.max(0, Math.round((total - alreadyRefunded) * 100) / 100);
    if (remaining <= 0) return { ok: false, error: "order is already fully refunded" };
    // Default: full remaining refund (Shopify pre-fills the full amount). Optional override.
    const requested = params.amount != null ? Math.max(0, Number(params.amount) || 0) : remaining;
    const amount = Math.min(requested, remaining);
    if (amount <= 0) return { ok: false, error: "refund amount must be greater than 0" };
    const reason = String(params.reason || "customer_request");
    const restock = params.restock !== false;
    const refund = {
      id: nextRetailId("ref"),
      orderNumber: artifact.data?.orderNumber || artifact.title || artifact.id,
      amount, reason, restock,
      processedAt: nowIsoRet(),
    };
    artifact.data.refundAmount = Math.round((alreadyRefunded + amount) * 100) / 100;
    const fullyRefunded = artifact.data.refundAmount + 0.01 >= total;
    artifact.data.refundStatus = fullyRefunded ? "refunded" : "partially_refunded";
    pushOrderEvent(artifact, "refunded", `Refunded $${amount.toFixed(2)} — ${reason}${restock ? " (restocked)" : ""}`);
    // Best-effort mirror into the dashboard Refunds tab so it reflects card activity.
    try {
      const s = getRetailState();
      if (s) { ensureRetailBucket(s, "refunds", retailActor(ctx)).push(refund); saveRetailState(); }
    } catch { /* dashboard mirror is non-critical */ }
    return { ok: true, result: { refund, refundedTotal: artifact.data.refundAmount, remaining: Math.round((total - artifact.data.refundAmount) * 100) / 100, status: artifact.data.refundStatus } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // generate_label — deterministic shipping-label generation for an order artifact.
  // Was an AI-catch-all (the brain returned prose, useless for an actual label). A
  // shipping label is a STRUCTURED record: carrier, service, tracking, dimensions,
  // weight, cost, and a scannable label id — all derivable deterministically.
  registerLensAction("retail", "generate_label", (ctx, artifact, params = {}) => {
  try {
    const d = artifact?.data || {};
    const carrier = String(params.carrier || d.carrier || "Standard Post");
    const service = String(params.service || d.shippingMethod || "ground");
    // Reuse an existing tracking number; otherwise mint one deterministically.
    let trackingNumber = String(params.trackingNumber || d.trackingNumber || "").trim();
    if (!trackingNumber) trackingNumber = `CONCORD${Date.now().toString().slice(-10)}`;
    const items = Math.max(1, Number(d.items) || (Array.isArray(d.lines) ? d.lines.length : 1));
    // Weight estimate: 0.5kg base + 0.3kg/item (deterministic, overrideable).
    const weightKg = params.weightKg != null ? Math.max(0.1, Number(params.weightKg)) : Math.round((0.5 + items * 0.3) * 100) / 100;
    // Service-tier cost model (flat base + per-kg), deterministic.
    const RATES = { ground: [4.5, 1.2], express: [9.0, 2.4], overnight: [18.0, 3.6] };
    const tier = service.toLowerCase().includes("over") ? "overnight" : service.toLowerCase().includes("exp") ? "express" : "ground";
    const [base, perKg] = RATES[tier];
    const cost = Math.round((base + perKg * weightKg) * 100) / 100;
    const label = {
      labelId: nextRetailId("lbl"),
      orderNumber: d.orderNumber || artifact.title || artifact.id,
      carrier, service: tier, trackingNumber,
      shipTo: d.shippingAddress || d.customer || "customer",
      weightKg, items,
      cost, currency: "USD",
      // deterministic "barcode" payload for the scannable label
      barcode: `${carrier.replace(/\s+/g, "").slice(0, 4).toUpperCase()}-${trackingNumber}`,
      generatedAt: nowIsoRet(),
    };
    artifact.data.trackingNumber = trackingNumber;
    artifact.data.shippingLabel = label;
    pushOrderEvent(artifact, "label_generated", `${carrier} ${tier} label ${label.labelId} — $${cost.toFixed(2)}, tracking ${trackingNumber}`);
    return { ok: true, result: { label } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "send_tracking", (ctx, artifact, params = {}) => {
  try {
    let trackingNumber = String(params.trackingNumber || artifact.data?.trackingNumber || "").trim();
    if (!trackingNumber) {
      trackingNumber = `CONCORD${Date.now().toString().slice(-10)}`;
      artifact.data.trackingNumber = trackingNumber;
    }
    const carrier = String(params.carrier || artifact.data?.carrier || "Standard");
    const sentTo = String(params.email || artifact.data?.customerEmail || artifact.data?.customer || "customer");
    artifact.data.trackingSentAt = nowIsoRet();
    pushOrderEvent(artifact, "tracking_sent", `Tracking ${trackingNumber} (${carrier}) sent to ${sentTo}`);
    return { ok: true, result: { trackingNumber, carrier, sentTo, sentAt: artifact.data.trackingSentAt } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "initiate_return", (ctx, artifact, params = {}) => {
  try {
    const reason = String(params.reason || artifact.data?.returnReason || "customer_request");
    const restock = params.restock !== false;
    const returnRecord = {
      id: nextRetailId("ret"),
      orderNumber: artifact.data?.orderNumber || artifact.title || artifact.id,
      reason, restock,
      status: "pending",
      rmaNumber: `RMA-${Date.now().toString(36).toUpperCase().slice(-6)}`,
      initiatedAt: nowIsoRet(),
    };
    artifact.data.returnReason = reason;
    artifact.data.returnStatus = "pending";
    artifact.data.rmaNumber = returnRecord.rmaNumber;
    pushOrderEvent(artifact, "return_initiated", `Return ${returnRecord.rmaNumber} opened — ${reason}`);
    try {
      const s = getRetailState();
      if (s) { ensureRetailBucket(s, "returns", retailActor(ctx)).push(returnRecord); saveRetailState(); }
    } catch { /* dashboard mirror is non-critical */ }
    return { ok: true, result: { return: returnRecord } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * pipelineValue
   * Calculate weighted pipeline value from deals/opportunities.
   * artifact.data.deals: [{ name, value, probability, stage, expectedCloseDate }]
   *
   * RENDERED BY components/retail/RetailActionPanel.tsx (the Pipeline card).
   * The card reads, EXACTLY: totalDeals, totalWeighted, totalUnweighted,
   * byStage[stage].{count,weighted}, expectedRevenue, conversionRate. Those are
   * the canonical names — the older totalWeightedValue/byStage.weightedValue
   * shape is kept alongside (back-compat) but the component-exact aliases are
   * the load-bearing surface. FAIL-CLOSED: value/probability are coerced via a
   * finite guard so a poisoned "1e999"/NaN/Infinity deal collapses to 0 and no
   * money field ever renders Infinity/NaN.
   */
  registerLensAction("retail", "pipelineValue", (ctx, artifact, params = {}) => {
  try {
    const finNum = (v, fallback = 0) => { const n = Number(v); return Number.isFinite(n) ? n : fallback; };
    const round2 = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
    const deals = Array.isArray(artifact.data.deals)
      ? artifact.data.deals
      : (Array.isArray(artifact.data.opportunities) ? artifact.data.opportunities : []);
    const includeClosed = params.includeClosed || false;

    const isClosed = (st) => st === "closed-won" || st === "closed-lost" || st === "won" || st === "lost";
    const activeDealsList = includeClosed
      ? deals.filter((d) => d && typeof d === "object")
      : deals.filter((d) => d && typeof d === "object" && !isClosed(d.stage));

    let totalUnweighted = 0;
    let totalWeighted = 0;

    const byStage = {};

    const detailed = activeDealsList.map((deal) => {
      const value = finNum(deal.value, 0);
      const probabilityRaw = finNum(deal.probability, 0);
      // clamp probability to [0,100] so a poisoned 1e9 can't inflate weighted
      const probability = Math.max(0, Math.min(100, probabilityRaw));
      const weighted = round2(value * (probability / 100));
      const stage = deal.stage || "unknown";

      totalUnweighted += value;
      totalWeighted += weighted;

      if (!byStage[stage]) {
        // component reads .count + .weighted; legacy readers read .totalValue + .weightedValue
        byStage[stage] = { count: 0, totalValue: 0, weightedValue: 0, weighted: 0 };
      }
      byStage[stage].count++;
      byStage[stage].totalValue = round2(byStage[stage].totalValue + value);
      byStage[stage].weightedValue = round2(byStage[stage].weightedValue + weighted);
      byStage[stage].weighted = byStage[stage].weightedValue;

      return {
        name: deal.name,
        stage,
        value,
        probability,
        weightedValue: weighted,
        expectedCloseDate: deal.expectedCloseDate || null,
      };
    });

    // Deals closing this month
    const now = new Date();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const closingThisMonth = detailed.filter((d) => {
      if (!d.expectedCloseDate) return false;
      const close = new Date(d.expectedCloseDate);
      return !isNaN(close.getTime()) && close >= now && close <= monthEnd;
    });

    const dealCount = activeDealsList.length;
    const totalUnweightedR = round2(totalUnweighted);
    const totalWeightedR = round2(totalWeighted);
    // conversionRate = the blended close-probability across the active pipeline
    // (weighted / unweighted), as a percentage. 0 when there is no value.
    const conversionRate = totalUnweightedR > 0
      ? Math.round((totalWeightedR / totalUnweightedR) * 10000) / 100
      : 0;

    const result = {
      generatedAt: new Date().toISOString(),
      // ── component-exact fields (the rendered Pipeline card) ──
      totalDeals: dealCount,
      totalUnweighted: totalUnweightedR,
      totalWeighted: totalWeightedR,
      expectedRevenue: totalWeightedR,
      conversionRate,
      byStage,
      // ── legacy aliases (back-compat with prior parity callers) ──
      dealCount,
      totalUnweightedValue: totalUnweightedR,
      totalWeightedValue: totalWeightedR,
      avgDealSize: dealCount > 0 ? round2(totalUnweighted / dealCount) : 0,
      closingThisMonth: {
        count: closingThisMonth.length,
        weightedValue: round2(closingThisMonth.reduce((s, d) => s + d.weightedValue, 0)),
      },
    };

    artifact.data.pipelineReport = result;

    return { ok: true, result };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * customerLTV
   * Compute lifetime value from order history.
   * artifact.data.customers: [{ customerId, name, orders: [{ date, total }], acquisitionDate }]
   * params.customerId — compute for one customer (or all if omitted)
   */
  registerLensAction("retail", "customerLTV", (ctx, artifact, params = {}) => {
  try {
    const finNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    const round2 = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

    // ── Flat unit-economics branch (the live RetailActionPanel LTV card) ──
    // Component sends { avgOrderValue, purchaseFrequencyPerYear,
    //   customerLifespanYears, cac } and renders { avgOrderValue,
    //   purchaseFrequency, customerLifespanYears, ltv, cac, ltvToCacRatio,
    //   profitable }. LTV = AOV × freq/yr × lifespan(yr). FAIL-CLOSED: any
    //   poisoned numeric → finite default; cac=0 → ratio collapses to ltv
    //   (no Infinity), never NaN.
    const aov = finNum(artifact.data.avgOrderValue);
    const freq = finNum(artifact.data.purchaseFrequencyPerYear);
    const lifespan = finNum(artifact.data.customerLifespanYears);
    if (aov != null || freq != null || lifespan != null || artifact.data.cac != null) {
      if (!(artifact.data.customers && Array.isArray(artifact.data.customers) && artifact.data.customers.length)) {
        const avgOrderValue = Math.max(0, aov ?? 0);
        const purchaseFrequency = Math.max(0, freq ?? 0);
        const customerLifespanYears = Math.max(0, lifespan ?? 0);
        const cac = Math.max(0, finNum(artifact.data.cac) ?? 0);
        const ltv = round2(avgOrderValue * purchaseFrequency * customerLifespanYears);
        const ltvToCacRatio = cac > 0 ? Math.round((ltv / cac) * 100) / 100 : (ltv > 0 ? ltv : 0);
        const result = {
          generatedAt: new Date().toISOString(),
          avgOrderValue: round2(avgOrderValue),
          purchaseFrequency: Math.round(purchaseFrequency * 100) / 100,
          customerLifespanYears: Math.round(customerLifespanYears * 100) / 100,
          ltv,
          cac: round2(cac),
          ltvToCacRatio,
          profitable: ltvToCacRatio >= 3,
        };
        artifact.data.ltvReport = result;
        return { ok: true, result };
      }
    }

    const customers = artifact.data.customers || [];
    const targetId = params.customerId || null;

    const subset = targetId
      ? customers.filter((c) => c.customerId === targetId)
      : customers;

    if (subset.length === 0) {
      return { ok: true, result: { error: "No matching customers found." } };
    }

    const now = new Date();
    const ltvData = subset.map((cust) => {
      const orders = cust.orders || [];
      const totalRevenue = orders.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
      const orderCount = orders.length;
      const avgOrderValue = orderCount > 0 ? Math.round((totalRevenue / orderCount) * 100) / 100 : 0;

      // Compute lifespan in months
      const acqDate = cust.acquisitionDate ? new Date(cust.acquisitionDate) : null;
      let lifespanMonths = null;
      if (acqDate) {
        lifespanMonths = Math.max(1,
          (now.getFullYear() - acqDate.getFullYear()) * 12 + (now.getMonth() - acqDate.getMonth())
        );
      }

      // Purchase frequency: orders per month
      const purchaseFrequency = lifespanMonths ? Math.round((orderCount / lifespanMonths) * 100) / 100 : null;

      // Simple LTV = avg order value x purchase frequency x projected lifespan (default 24 months)
      const projectedMonths = params.projectedMonths || 24;
      const ltv = purchaseFrequency != null
        ? Math.round(avgOrderValue * purchaseFrequency * projectedMonths * 100) / 100
        : Math.round(totalRevenue * 100) / 100;

      // Days since last order
      let daysSinceLastOrder = null;
      if (orders.length > 0) {
        const sorted = orders.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
        daysSinceLastOrder = Math.floor((now - new Date(sorted[0].date)) / 86400000);
      }

      return {
        customerId: cust.customerId,
        name: cust.name,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        orderCount,
        avgOrderValue,
        lifespanMonths,
        purchaseFrequency,
        projectedLTV: ltv,
        daysSinceLastOrder,
        atRisk: daysSinceLastOrder != null && daysSinceLastOrder > (params.atRiskDays || 90),
      };
    });

    // Summary stats
    const totalLTV = ltvData.reduce((s, c) => s + c.projectedLTV, 0);
    const avgLTV = ltvData.length > 0 ? Math.round((totalLTV / ltvData.length) * 100) / 100 : 0;
    const atRiskCount = ltvData.filter((c) => c.atRisk).length;

    // Sort by LTV descending
    ltvData.sort((a, b) => b.projectedLTV - a.projectedLTV);

    const report = {
      generatedAt: new Date().toISOString(),
      customersAnalyzed: ltvData.length,
      totalProjectedLTV: Math.round(totalLTV * 100) / 100,
      avgProjectedLTV: avgLTV,
      atRiskCount,
      customers: ltvData,
    };

    artifact.data.ltvReport = report;

    return { ok: true, result: report };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * slaStatus
   * Check support tickets against SLA deadlines.
   * artifact.data.tickets: [{ ticketId, subject, priority, createdAt, resolvedAt, slaHours }]
   * params.defaultSlaHours — default SLA if not per-ticket (default 24)
   */
  registerLensAction("retail", "slaStatus", (ctx, artifact, params = {}) => {
  try {
    const finNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    const round2 = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

    // ── Incident response-time branch (the live RetailActionPanel SLA card) ──
    // Component sends { incidents: [...] } and renders { totalIncidents,
    //   withinSLA, breaches, complianceRate, avgResponseMinutes, tier }. Each
    //   incident carries a response time (responseMinutes | responseTime |
    //   responseHours) checked against an SLA target (slaMinutes | slaHours |
    //   targetMinutes), defaulting to a per-priority target. FAIL-CLOSED: any
    //   poisoned numeric → finite default; an incident with no response time is
    //   counted as an open breach; complianceRate/avgResponseMinutes stay finite.
    if (Array.isArray(artifact.data.incidents)) {
      const defaultTargetByPriority = params.slaTargetMinutes || { critical: 60, high: 240, medium: 1440, low: 2880 };
      const defaultTarget = finNum(params.defaultSlaMinutes) ?? 1440; // 24h
      const incidents = artifact.data.incidents.filter((i) => i && typeof i === "object");
      let withinSLA = 0;
      let breaches = 0;
      let responseSum = 0;
      let responseSamples = 0;
      for (const inc of incidents) {
        // response time in minutes (accept minutes, hours, or raw responseTime as minutes)
        let respMin = finNum(inc.responseMinutes);
        if (respMin == null && finNum(inc.responseHours) != null) respMin = finNum(inc.responseHours) * 60;
        if (respMin == null) respMin = finNum(inc.responseTime); // treated as minutes
        // sla target in minutes
        let targetMin = finNum(inc.slaMinutes) ?? finNum(inc.targetMinutes);
        if (targetMin == null && finNum(inc.slaHours) != null) targetMin = finNum(inc.slaHours) * 60;
        if (targetMin == null) targetMin = finNum(defaultTargetByPriority[inc.priority]) ?? defaultTarget;
        targetMin = Math.max(0, targetMin);
        if (respMin == null || respMin < 0) {
          // no/invalid response time → unresolved → counts as a breach
          breaches++;
          continue;
        }
        responseSum += respMin;
        responseSamples++;
        if (respMin <= targetMin) withinSLA++;
        else breaches++;
      }
      const totalIncidents = incidents.length;
      const complianceRate = totalIncidents > 0
        ? Math.round((withinSLA / totalIncidents) * 10000) / 100
        : 100;
      const avgResponseMinutes = responseSamples > 0 ? round2(responseSum / responseSamples) : 0;
      const tier = complianceRate >= 95 ? "platinum"
        : complianceRate >= 90 ? "gold"
        : complianceRate >= 80 ? "silver"
        : complianceRate >= 60 ? "bronze" : "at-risk";
      const result = {
        checkedAt: new Date().toISOString(),
        totalIncidents,
        withinSLA,
        breaches,
        complianceRate,
        avgResponseMinutes,
        tier,
      };
      artifact.data.slaReport = result;
      return { ok: true, result };
    }

    const tickets = artifact.data.tickets || [];
    const defaultSlaHours = params.defaultSlaHours || 24;
    const now = new Date();

    const slaByPriority = params.slaByPriority || {
      critical: 4,
      high: 8,
      medium: 24,
      low: 48,
    };

    const analyzed = tickets.map((ticket) => {
      const created = new Date(ticket.createdAt);
      const slaHours = ticket.slaHours || slaByPriority[ticket.priority] || defaultSlaHours;
      const deadline = new Date(created.getTime() + slaHours * 3600000);

      const resolved = ticket.resolvedAt ? new Date(ticket.resolvedAt) : null;
      const isOpen = !resolved;

      let status;
      let timeToResolutionHours = null;
      let remainingHours = null;

      if (resolved) {
        timeToResolutionHours = Math.round(((resolved - created) / 3600000) * 100) / 100;
        status = timeToResolutionHours <= slaHours ? "met" : "breached";
      } else {
        remainingHours = Math.round(((deadline - now) / 3600000) * 100) / 100;
        if (remainingHours < 0) {
          status = "breached";
        } else if (remainingHours < slaHours * 0.25) {
          status = "at-risk";
        } else {
          status = "on-track";
        }
      }

      return {
        ticketId: ticket.ticketId,
        subject: ticket.subject,
        priority: ticket.priority,
        slaHours,
        createdAt: ticket.createdAt,
        deadline: deadline.toISOString(),
        isOpen,
        status,
        timeToResolutionHours,
        remainingHours,
      };
    });

    const breached = analyzed.filter((t) => t.status === "breached");
    const atRisk = analyzed.filter((t) => t.status === "at-risk");
    const met = analyzed.filter((t) => t.status === "met");
    const onTrack = analyzed.filter((t) => t.status === "on-track");

    const closedTickets = analyzed.filter((t) => !t.isOpen);
    const slaComplianceRate = closedTickets.length > 0
      ? Math.round((met.length / closedTickets.length) * 10000) / 100
      : 100;

    const report = {
      checkedAt: new Date().toISOString(),
      totalTickets: tickets.length,
      breachedCount: breached.length,
      atRiskCount: atRisk.length,
      onTrackCount: onTrack.length,
      metCount: met.length,
      slaComplianceRate,
      breached,
      atRisk,
    };

    artifact.data.slaReport = report;

    return { ok: true, result: report };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── 2026 parity — Shopify/Square/Stripe POS / Lightspeed parity ──

  function getRetailState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.retailLens) {
      STATE.retailLens = {
        products: new Map(),  // userId -> Map<sku, product>
        orders:   new Map(),  // userId -> Array<order>
        carts:    new Map(),  // userId -> Map<cartId, cart>
        seq:      new Map(),  // userId -> { order: 1 }
      };
    }
    return STATE.retailLens;
  }
  function saveRetailState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function retailActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextRetailId(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIsoRet() { return new Date().toISOString(); }

  // ── Product catalog ──

  registerLensAction("retail", "product-list", (ctx, _artifact, _params = {}) => {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const map = s.products.get(userId);
    if (!map) return { ok: true, result: { products: [] } };
    const products = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    return { ok: true, result: { products } };
  });

  registerLensAction("retail", "product-upsert", (ctx, _artifact, params = {}) => {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const sku = String(params.sku || "").trim();
    if (!sku) return { ok: false, error: "sku required" };
    if (sku.length > 32) return { ok: false, error: "sku too long" };
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const price = Number(params.price);
    if (!Number.isFinite(price) || price < 0) return { ok: false, error: "price must be >= 0" };
    const stock = Number(params.stock);
    if (!Number.isFinite(stock) || stock < 0) return { ok: false, error: "stock must be >= 0" };
    if (!s.products.has(userId)) s.products.set(userId, new Map());
    const existing = s.products.get(userId).get(sku);
    const product = {
      sku, name, price,
      stock,
      category: String(params.category || "").slice(0, 40),
      barcode: String(params.barcode || "").slice(0, 32),
      updatedAt: nowIsoRet(),
      createdAt: existing?.createdAt || nowIsoRet(),
    };
    s.products.get(userId).set(sku, product);
    saveRetailState();
    return { ok: true, result: { product } };
  });

  registerLensAction("retail", "product-delete", (ctx, _artifact, params = {}) => {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const sku = String(params.sku || "");
    if (!sku) return { ok: false, error: "sku required" };
    const map = s.products.get(userId);
    if (!map || !map.has(sku)) return { ok: false, error: "not found" };
    map.delete(sku);
    saveRetailState();
    return { ok: true, result: { deleted: sku } };
  });

  // ── Cart + checkout ──

  registerLensAction("retail", "cart-open", (ctx, _artifact, _params = {}) => {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const cart = { id: nextRetailId("cart"), lines: [], discountPercent: 0, openedAt: nowIsoRet() };
    if (!s.carts.has(userId)) s.carts.set(userId, new Map());
    s.carts.get(userId).set(cart.id, cart);
    saveRetailState();
    return { ok: true, result: { cart } };
  });

  registerLensAction("retail", "cart-add-line", (ctx, _artifact, params = {}) => {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const cartId = String(params.cartId || "");
    const sku = String(params.sku || "");
    const qty = Number(params.qty) || 1;
    if (!cartId || !sku) return { ok: false, error: "cartId and sku required" };
    if (qty <= 0) return { ok: false, error: "qty must be > 0" };
    const cart = s.carts.get(userId)?.get(cartId);
    if (!cart) return { ok: false, error: "cart not found" };
    const product = s.products.get(userId)?.get(sku);
    if (!product) return { ok: false, error: `product not found: ${sku}` };
    const existing = cart.lines.find((l) => l.sku === sku);
    if (existing) existing.qty += qty;
    else cart.lines.push({ sku, name: product.name, unitPrice: product.price, qty });
    saveRetailState();
    return { ok: true, result: { cart } };
  });

  registerLensAction("retail", "cart-total", (ctx, _artifact, params = {}) => {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const cartId = String(params.cartId || "");
    const cart = s.carts.get(userId)?.get(cartId);
    if (!cart) return { ok: false, error: "cart not found" };
    const taxRate = Number(params.taxRate) || 0;
    const subtotal = cart.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
    const discount = (subtotal * cart.discountPercent) / 100;
    const subtotalAfterDiscount = subtotal - discount;
    const tax = subtotalAfterDiscount * (taxRate / 100);
    const total = subtotalAfterDiscount + tax;
    return {
      ok: true,
      result: {
        subtotal: Math.round(subtotal * 100) / 100,
        discount: Math.round(discount * 100) / 100,
        subtotalAfterDiscount: Math.round(subtotalAfterDiscount * 100) / 100,
        tax: Math.round(tax * 100) / 100,
        total: Math.round(total * 100) / 100,
        lineCount: cart.lines.length,
        itemCount: cart.lines.reduce((s, l) => s + l.qty, 0),
      },
    };
  });

  registerLensAction("retail", "cart-tender", (ctx, _artifact, params = {}) => {
  try {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const cartId = String(params.cartId || "");
    const cart = s.carts.get(userId)?.get(cartId);
    if (!cart) return { ok: false, error: "cart not found" };
    if (cart.lines.length === 0) return { ok: false, error: "cart is empty" };
    const taxRate = Number(params.taxRate) || 0;
    const tenders = Array.isArray(params.tenders) ? params.tenders : [];
    if (tenders.length === 0) return { ok: false, error: "tenders required (e.g. [{kind:'cash', amount:100}])" };
    // Compute total
    const subtotal = cart.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
    const discount = (subtotal * cart.discountPercent) / 100;
    const subtotalAfter = subtotal - discount;
    const tax = subtotalAfter * (taxRate / 100);
    const total = Math.round((subtotalAfter + tax) * 100) / 100;
    const tendered = tenders.reduce((s, t) => s + Number(t.amount || 0), 0);
    if (tendered < total - 0.01) return { ok: false, error: `insufficient tender: ${tendered.toFixed(2)} < ${total.toFixed(2)}` };
    const change = Math.round((tendered - total) * 100) / 100;
    // Decrement stock
    for (const line of cart.lines) {
      const product = s.products.get(userId)?.get(line.sku);
      if (product) product.stock = Math.max(0, product.stock - line.qty);
    }
    if (!s.seq.has(userId)) s.seq.set(userId, { order: 1 });
    const seq = s.seq.get(userId);
    const order = {
      id: nextRetailId("ord"),
      number: `ORD-${String(seq.order).padStart(5, "0")}`,
      lines: cart.lines,
      subtotal: Math.round(subtotal * 100) / 100,
      discount: Math.round(discount * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      total,
      tenders,
      tendered: Math.round(tendered * 100) / 100,
      change,
      completedAt: nowIsoRet(),
    };
    seq.order++;
    if (!s.orders.has(userId)) s.orders.set(userId, []);
    s.orders.get(userId).unshift(order);
    s.carts.get(userId).delete(cartId);
    saveRetailState();
    return { ok: true, result: { order } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "orders-list", (ctx, _artifact, _params = {}) => {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const orders = s.orders.get(userId) || [];
    return { ok: true, result: { orders: orders.slice(0, 100) } };
  });

  // ── Inventory low-stock report ──

  registerLensAction("retail", "low-stock", (ctx, _artifact, params = {}) => {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const threshold = Number(params.threshold) || 5;
    const map = s.products.get(userId);
    if (!map) return { ok: true, result: { lowStock: [] } };
    const lowStock = Array.from(map.values()).filter((p) => p.stock <= threshold).sort((a, b) => a.stock - b.stock);
    return { ok: true, result: { lowStock, threshold } };
  });

  // ── Stripe POS — real card tender via PaymentIntent ──
  //
  // Flow:
  //   1. cart-create-payment-intent → server-side POST to Stripe
  //      creates a PaymentIntent for the cart total. Returns
  //      { clientSecret, paymentIntentId, total }. Frontend uses
  //      Stripe Elements (or Terminal SDK for in-person readers)
  //      to confirm with the customer's card.
  //   2. cart-confirm-paid-with-intent → server verifies the
  //      PaymentIntent is succeeded, then decrements stock + writes
  //      the order. Stripe IDs persisted on the order.
  //   3. Webhook payment_intent.succeeded (server/economy/stripe.js)
  //      auto-confirms async out-of-band card captures.
  //
  // Per "everything must be real": no synthesized auth codes,
  // no skip-the-network fast path. STRIPE_SECRET_KEY env required.

  async function stripePostRetail(path, formBody) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
    const url = `https://api.stripe.com/v1${path}`;
    const body = new URLSearchParams(formBody).toString();
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Stripe-Version": "2025-09-30.acacia",
      },
      body,
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`stripe ${path} ${r.status}: ${data?.error?.message || "unknown"}`);
    return data;
  }

  async function stripeGetRetail(path) {
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");
    const url = `https://api.stripe.com/v1${path}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${stripeKey}` } });
    const data = await r.json();
    if (!r.ok) throw new Error(`stripe ${path} ${r.status}: ${data?.error?.message || "unknown"}`);
    return data;
  }

  registerLensAction("retail", "cart-create-payment-intent", async (ctx, _artifact, params = {}) => {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const cartId = String(params.cartId || "");
    const cart = s.carts.get(userId)?.get(cartId);
    if (!cart) return { ok: false, error: "cart not found" };
    if (cart.lines.length === 0) return { ok: false, error: "cart is empty" };
    if (!process.env.STRIPE_SECRET_KEY) {
      return { ok: false, error: "Stripe not configured. Set STRIPE_SECRET_KEY env to enable card tenders." };
    }
    const taxRate = Number(params.taxRate) || 0;
    const subtotal = cart.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
    const discount = (subtotal * cart.discountPercent) / 100;
    const subtotalAfter = subtotal - discount;
    const tax = subtotalAfter * (taxRate / 100);
    const total = Math.round((subtotalAfter + tax) * 100) / 100;
    const amountCents = Math.round(total * 100);
    if (amountCents < 50) return { ok: false, error: "amount below Stripe minimum ($0.50 USD)" };

    try {
      const formBody = {
        amount: String(amountCents),
        currency: "usd",
        "automatic_payment_methods[enabled]": "true",
        "metadata[concord_user_id]": userId,
        "metadata[concord_cart_id]": cartId,
      };
      // Reader-driven Terminal: caller passes terminal=true to request
      // a manual capture flow that the Terminal SDK can complete.
      if (params.terminal === true) {
        formBody.capture_method = "manual";
        formBody["payment_method_types[]"] = "card_present";
      }
      const pi = await stripePostRetail("/payment_intents", formBody);
      // Stash a pending intent on the cart so cart-confirm-paid-with-intent
      // can correlate without trusting the caller to forward the right id.
      cart.pendingPaymentIntentId = pi.id;
      cart.pendingPaymentIntentTotal = total;
      cart.pendingPaymentIntentTaxRate = taxRate;
      saveRetailState();
      return {
        ok: true,
        result: {
          clientSecret: pi.client_secret,
          paymentIntentId: pi.id,
          total,
          subtotal: Math.round(subtotalAfter * 100) / 100,
          tax: Math.round(tax * 100) / 100,
          status: pi.status,
        },
      };
    } catch (e) {
      return { ok: false, error: `stripe payment-intent creation failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  registerLensAction("retail", "cart-confirm-paid-with-intent", async (ctx, _artifact, params = {}) => {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const cartId = String(params.cartId || "");
    const cart = s.carts.get(userId)?.get(cartId);
    if (!cart) return { ok: false, error: "cart not found" };
    if (!process.env.STRIPE_SECRET_KEY) {
      return { ok: false, error: "Stripe not configured." };
    }
    const paymentIntentId = String(params.paymentIntentId || cart.pendingPaymentIntentId || "");
    if (!paymentIntentId) return { ok: false, error: "paymentIntentId required" };
    if (cart.pendingPaymentIntentId && cart.pendingPaymentIntentId !== paymentIntentId) {
      return { ok: false, error: "paymentIntentId does not match cart's pending intent" };
    }

    // Verify with Stripe — never trust the client about payment status.
    let pi;
    try {
      pi = await stripeGetRetail(`/payment_intents/${paymentIntentId}`);
    } catch (e) {
      return { ok: false, error: `stripe payment-intent fetch failed: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (pi.status !== "succeeded") {
      return { ok: false, error: `payment not succeeded (status=${pi.status}); cannot capture order` };
    }
    if (pi.metadata?.concord_user_id !== userId || pi.metadata?.concord_cart_id !== cartId) {
      return { ok: false, error: "payment-intent metadata mismatch (user/cart)" };
    }

    const total = cart.pendingPaymentIntentTotal ?? (pi.amount / 100);
    const taxRate = cart.pendingPaymentIntentTaxRate ?? 0;
    const subtotal = cart.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
    const discount = (subtotal * cart.discountPercent) / 100;
    const subtotalAfter = subtotal - discount;
    const tax = subtotalAfter * (taxRate / 100);

    // Decrement stock
    for (const line of cart.lines) {
      const product = s.products.get(userId)?.get(line.sku);
      if (product) product.stock = Math.max(0, product.stock - line.qty);
    }
    if (!s.seq.has(userId)) s.seq.set(userId, { order: 1 });
    const seq = s.seq.get(userId);
    const order = {
      id: nextRetailId("ord"),
      number: `ORD-${String(seq.order).padStart(5, "0")}`,
      lines: cart.lines,
      subtotal: Math.round(subtotal * 100) / 100,
      discount: Math.round(discount * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      total: Math.round(total * 100) / 100,
      tenders: [{ kind: "card", amount: total, provider: "stripe", paymentIntentId, charge: pi.latest_charge || null }],
      tendered: total,
      change: 0,
      stripePaymentIntentId: paymentIntentId,
      stripePaymentStatus: pi.status,
      completedAt: nowIsoRet(),
      paidVia: "stripe",
    };
    seq.order++;
    if (!s.orders.has(userId)) s.orders.set(userId, []);
    s.orders.get(userId).unshift(order);
    s.carts.get(userId).delete(cartId);
    saveRetailState();
    return { ok: true, result: { order } };
  });

  // ─── Full-app parity: Shopify 2026 admin ──────────────────────────

  function ensureRetailBucket(state, key, userId) {
    if (!state[key]) state[key] = new Map();
    if (!state[key].has(userId)) state[key].set(userId, []);
    return state[key].get(userId);
  }
  function ensureRetailMap(state, key, userId) {
    if (!state[key]) state[key] = new Map();
    if (!state[key].has(userId)) state[key].set(userId, new Map());
    return state[key].get(userId);
  }

  // ── Customers + segments ──────────────────────────────────────

  registerLensAction("retail", "customers-list", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const customers = ensureRetailBucket(s, "customers", userId);
    return { ok: true, result: { customers } };
  });

  registerLensAction("retail", "customers-add", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const name = String(params.name || "").trim();
    const email = String(params.email || "").trim().toLowerCase();
    if (!name) return { ok: false, error: "name required" };
    if (!email) return { ok: false, error: "email required" };
    const customer = {
      id: nextRetailId("cust"), name, email,
      phone: String(params.phone || ""),
      city: String(params.city || ""),
      state: String(params.state || ""),
      totalSpent: Math.max(0, Number(params.totalSpent) || 0),
      orderCount: Math.max(0, Number(params.orderCount) || 0),
      lastOrderAt: params.lastOrderAt || null,
      acceptsMarketing: params.acceptsMarketing !== false,
      tags: Array.isArray(params.tags) ? params.tags : [],
      createdAt: nowIsoRet(),
    };
    ensureRetailBucket(s, "customers", userId).push(customer);
    saveRetailState();
    return { ok: true, result: { customer } };
  });

  registerLensAction("retail", "customers-delete", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const list = ensureRetailBucket(s, "customers", userId);
    const idx = list.findIndex(c => c.id === id);
    if (idx < 0) return { ok: false, error: "customer not found" };
    list.splice(idx, 1);
    saveRetailState();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("retail", "customers-segments", (ctx, _a, _p = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const customers = ensureRetailBucket(s, "customers", userId);
    const now = Date.now();
    const day = 86400000;
    const segments = {
      new: customers.filter(c => c.orderCount <= 1),
      repeat: customers.filter(c => c.orderCount >= 2 && c.orderCount < 5),
      vip: customers.filter(c => c.totalSpent >= 1000 || c.orderCount >= 5),
      atRisk: customers.filter(c => c.lastOrderAt && (now - new Date(c.lastOrderAt).getTime()) > 90 * day && c.orderCount > 0),
      dormant: customers.filter(c => !c.lastOrderAt || (now - new Date(c.lastOrderAt).getTime()) > 180 * day),
      marketing: customers.filter(c => c.acceptsMarketing),
    };
    return {
      ok: true,
      result: {
        totalCustomers: customers.length,
        segments: {
          new: segments.new.length,
          repeat: segments.repeat.length,
          vip: segments.vip.length,
          atRisk: segments.atRisk.length,
          dormant: segments.dormant.length,
          marketingOptIn: segments.marketing.length,
        },
        detail: segments,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Discount codes ─────────────────────────────────────────────

  registerLensAction("retail", "discounts-list", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const discounts = ensureRetailBucket(s, "discounts", userId);
    return { ok: true, result: { discounts } };
  });

  registerLensAction("retail", "discounts-create", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const code = String(params.code || "").trim().toUpperCase();
    const kind = ["percentage", "fixed_amount", "free_shipping"].includes(params.kind) ? params.kind : "percentage";
    const value = Math.max(0, Number(params.value) || 0);
    if (!code) return { ok: false, error: "code required" };
    if (kind !== "free_shipping" && value <= 0) return { ok: false, error: "value must be > 0" };
    if (kind === "percentage" && value > 100) return { ok: false, error: "percentage must be ≤ 100" };
    const discounts = ensureRetailBucket(s, "discounts", userId);
    if (discounts.some(d => d.code === code)) return { ok: false, error: "code already exists" };
    const discount = {
      id: nextRetailId("disc"), code, kind, value,
      minSubtotal: Math.max(0, Number(params.minSubtotal) || 0),
      usageLimit: params.usageLimit ? Number(params.usageLimit) : null,
      usageCount: 0,
      expiresAt: params.expiresAt || null,
      active: true,
      createdAt: nowIsoRet(),
    };
    discounts.push(discount);
    saveRetailState();
    return { ok: true, result: { discount } };
  });

  registerLensAction("retail", "discounts-delete", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const list = ensureRetailBucket(s, "discounts", userId);
    const idx = list.findIndex(d => d.id === id);
    if (idx < 0) return { ok: false, error: "discount not found" };
    list.splice(idx, 1);
    saveRetailState();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("retail", "discounts-apply", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const cartId = String(params.cartId || "");
    const code = String(params.code || "").trim().toUpperCase();
    const cart = s.carts.get(userId)?.get(cartId);
    if (!cart) return { ok: false, error: "cart not found" };
    const discount = ensureRetailBucket(s, "discounts", userId).find(d => d.code === code && d.active);
    if (!discount) return { ok: false, error: "discount code invalid or expired" };
    if (discount.expiresAt && new Date(discount.expiresAt).getTime() < Date.now()) return { ok: false, error: "discount expired" };
    if (discount.usageLimit != null && discount.usageCount >= discount.usageLimit) return { ok: false, error: "discount usage limit reached" };
    const subtotal = cart.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
    if (subtotal < discount.minSubtotal) return { ok: false, error: `minimum subtotal $${discount.minSubtotal} not met` };
    let discountAmount = 0;
    if (discount.kind === "percentage") {
      cart.discountPercent = discount.value;
      discountAmount = subtotal * discount.value / 100;
    } else if (discount.kind === "fixed_amount") {
      discountAmount = Math.min(subtotal, discount.value);
      cart.discountPercent = subtotal > 0 ? (discountAmount / subtotal) * 100 : 0;
    } else {
      cart.freeShipping = true;
    }
    cart.appliedDiscountCode = code;
    discount.usageCount++;
    saveRetailState();
    return { ok: true, result: { cart, discountAmount: Math.round(discountAmount * 100) / 100 } };
  });

  // ── Abandoned carts ───────────────────────────────────────────

  registerLensAction("retail", "abandoned-carts-list", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const thresholdHours = Math.max(1, Number(params.thresholdHours) || 1);
    const now = Date.now();
    const carts = s.carts.get(userId);
    if (!carts) return { ok: true, result: { carts: [] } };
    const abandoned = [];
    for (const cart of carts.values()) {
      if (cart.lines.length === 0) continue;
      const ageMs = now - new Date(cart.openedAt).getTime();
      if (ageMs < thresholdHours * 3600000) continue;
      const subtotal = cart.lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
      abandoned.push({
        id: cart.id,
        openedAt: cart.openedAt,
        ageHours: Math.round(ageMs / 3600000),
        lineCount: cart.lines.length,
        itemCount: cart.lines.reduce((s, l) => s + l.qty, 0),
        subtotal: Math.round(subtotal * 100) / 100,
        lines: cart.lines,
      });
    }
    abandoned.sort((a, b) => b.subtotal - a.subtotal);
    const totalLost = abandoned.reduce((s, c) => s + c.subtotal, 0);
    return { ok: true, result: { carts: abandoned, totalAbandoned: abandoned.length, totalLostValue: Math.round(totalLost * 100) / 100 } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "abandoned-cart-recover", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const cartId = String(params.cartId || "");
    const discountCode = params.discountCode ? String(params.discountCode).trim().toUpperCase() : null;
    const cart = s.carts.get(userId)?.get(cartId);
    if (!cart) return { ok: false, error: "cart not found" };
    const recoveries = ensureRetailBucket(s, "recoveries", userId);
    const recovery = {
      id: nextRetailId("rec"), cartId, discountCode,
      sentAt: nowIsoRet(),
      kind: discountCode ? "discounted_recovery" : "reminder",
      shareableLink: `/cart/recover/${cartId}${discountCode ? `?discount=${discountCode}` : ""}`,
    };
    recoveries.push(recovery);
    saveRetailState();
    return { ok: true, result: { recovery } };
  });

  // ── Shipping zones + rates ────────────────────────────────────

  registerLensAction("retail", "shipping-zones-list", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const zones = ensureRetailBucket(s, "shippingZones", userId);
    return { ok: true, result: { zones } };
  });

  registerLensAction("retail", "shipping-zones-create", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const name = String(params.name || "").trim();
    const countries = Array.isArray(params.countries) ? params.countries : [];
    if (!name) return { ok: false, error: "name required" };
    if (countries.length === 0) return { ok: false, error: "at least one country required" };
    const zone = {
      id: nextRetailId("zone"), name, countries,
      rates: Array.isArray(params.rates) ? params.rates : [
        { id: nextRetailId("rate"), name: "Standard", priceCents: 500, freeThreshold: null },
      ],
      createdAt: nowIsoRet(),
    };
    ensureRetailBucket(s, "shippingZones", userId).push(zone);
    saveRetailState();
    return { ok: true, result: { zone } };
  });

  registerLensAction("retail", "shipping-zones-delete", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const list = ensureRetailBucket(s, "shippingZones", userId);
    const idx = list.findIndex(z => z.id === id);
    if (idx < 0) return { ok: false, error: "zone not found" };
    list.splice(idx, 1);
    saveRetailState();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("retail", "shipping-rate-quote", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const country = String(params.country || "").toUpperCase();
    const subtotalCents = Math.max(0, Math.round(Number(params.subtotal || 0) * 100));
    const zones = ensureRetailBucket(s, "shippingZones", userId);
    const zone = zones.find(z => z.countries.includes(country));
    if (!zone) return { ok: true, result: { quotes: [], message: "No shipping zone covers that country" } };
    const quotes = zone.rates.map(r => ({
      id: r.id, name: r.name,
      priceCents: r.freeThreshold != null && subtotalCents >= r.freeThreshold * 100 ? 0 : r.priceCents,
      free: r.freeThreshold != null && subtotalCents >= r.freeThreshold * 100,
    }));
    return { ok: true, result: { zone: zone.name, quotes } };
  });

  // ── Tax rates ─────────────────────────────────────────────────

  registerLensAction("retail", "tax-rates-list", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const rates = ensureRetailBucket(s, "taxRates", userId);
    return { ok: true, result: { rates } };
  });

  registerLensAction("retail", "tax-rates-set", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const region = String(params.region || "").trim().toUpperCase();
    const ratePct = Math.max(0, Math.min(50, Number(params.ratePct) || 0));
    if (!region) return { ok: false, error: "region required" };
    const rates = ensureRetailBucket(s, "taxRates", userId);
    const existing = rates.find(r => r.region === region);
    if (existing) {
      existing.ratePct = ratePct;
      existing.updatedAt = nowIsoRet();
    } else {
      rates.push({ id: nextRetailId("tax"), region, ratePct, createdAt: nowIsoRet() });
    }
    saveRetailState();
    return { ok: true, result: { rates } };
  });

  registerLensAction("retail", "tax-rates-delete", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const list = ensureRetailBucket(s, "taxRates", userId);
    const idx = list.findIndex(r => r.id === id);
    if (idx < 0) return { ok: false, error: "tax rate not found" };
    list.splice(idx, 1);
    saveRetailState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Gift cards ────────────────────────────────────────────────

  registerLensAction("retail", "gift-cards-list", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const cards = ensureRetailBucket(s, "giftCards", userId);
    return { ok: true, result: { giftCards: cards } };
  });

  registerLensAction("retail", "gift-cards-create", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const initialValue = Math.max(1, Number(params.initialValue) || 0);
    if (initialValue <= 0) return { ok: false, error: "initialValue must be > 0" };
    const code = `GC-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const card = {
      id: nextRetailId("gc"), code, initialValue,
      balance: initialValue,
      recipientEmail: String(params.recipientEmail || ""),
      recipientName: String(params.recipientName || ""),
      message: String(params.message || ""),
      expiresAt: params.expiresAt || null,
      issuedAt: nowIsoRet(),
      status: "active",
    };
    ensureRetailBucket(s, "giftCards", userId).push(card);
    saveRetailState();
    return { ok: true, result: { card } };
  });

  registerLensAction("retail", "gift-cards-balance", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const code = String(params.code || "").trim().toUpperCase();
    const card = ensureRetailBucket(s, "giftCards", userId).find(c => c.code === code);
    if (!card) return { ok: false, error: "gift card not found" };
    return { ok: true, result: { code, balance: card.balance, initialValue: card.initialValue, status: card.status } };
  });

  registerLensAction("retail", "gift-cards-redeem", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const code = String(params.code || "").trim().toUpperCase();
    const amount = Math.max(0, Number(params.amount) || 0);
    if (amount <= 0) return { ok: false, error: "amount must be > 0" };
    const card = ensureRetailBucket(s, "giftCards", userId).find(c => c.code === code);
    if (!card) return { ok: false, error: "gift card not found" };
    if (card.status !== "active") return { ok: false, error: `gift card ${card.status}` };
    if (card.balance < amount) return { ok: false, error: `insufficient balance ($${card.balance.toFixed(2)})` };
    card.balance = Math.round((card.balance - amount) * 100) / 100;
    if (card.balance === 0) card.status = "redeemed";
    saveRetailState();
    return { ok: true, result: { redeemed: amount, remainingBalance: card.balance, status: card.status } };
  });

  // ── Refunds ───────────────────────────────────────────────────

  registerLensAction("retail", "refunds-list", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const refunds = ensureRetailBucket(s, "refunds", userId);
    return { ok: true, result: { refunds } };
  });

  registerLensAction("retail", "refunds-create", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const orderId = String(params.orderId || "");
    const amount = Math.max(0, Number(params.amount) || 0);
    const reason = String(params.reason || "customer_request");
    const restock = params.restock !== false;
    if (!orderId || amount <= 0) return { ok: false, error: "orderId and amount required" };
    const orders = s.orders.get(userId) || [];
    const order = orders.find(o => o.id === orderId);
    if (!order) return { ok: false, error: "order not found" };
    const refundedTotal = ensureRetailBucket(s, "refunds", userId).filter(r => r.orderId === orderId).reduce((sum, r) => sum + r.amount, 0);
    if (refundedTotal + amount > order.total + 0.01) return { ok: false, error: `refund exceeds order total ($${order.total})` };
    const refund = {
      id: nextRetailId("ref"), orderId, amount, reason, restock,
      orderNumber: order.number,
      processedAt: nowIsoRet(),
    };
    ensureRetailBucket(s, "refunds", userId).push(refund);
    if (restock) {
      for (const line of order.lines) {
        const product = s.products.get(userId)?.get(line.sku);
        if (product) product.stock += line.qty;
      }
    }
    saveRetailState();
    return { ok: true, result: { refund } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Collections (product groupings) ───────────────────────────

  registerLensAction("retail", "collections-list", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const collections = ensureRetailBucket(s, "collections", userId);
    return { ok: true, result: { collections } };
  });

  registerLensAction("retail", "collections-create", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const collection = {
      id: nextRetailId("col"), name,
      description: String(params.description || ""),
      productSkus: Array.isArray(params.productSkus) ? params.productSkus : [],
      kind: ["manual", "smart"].includes(params.kind) ? params.kind : "manual",
      rule: params.rule || null,
      createdAt: nowIsoRet(),
    };
    ensureRetailBucket(s, "collections", userId).push(collection);
    saveRetailState();
    return { ok: true, result: { collection } };
  });

  registerLensAction("retail", "collections-add-product", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const sku = String(params.sku || "");
    const col = ensureRetailBucket(s, "collections", userId).find(c => c.id === id);
    if (!col) return { ok: false, error: "collection not found" };
    if (!col.productSkus.includes(sku)) col.productSkus.push(sku);
    saveRetailState();
    return { ok: true, result: { collection: col } };
  });

  registerLensAction("retail", "collections-delete", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const list = ensureRetailBucket(s, "collections", userId);
    const idx = list.findIndex(c => c.id === id);
    if (idx < 0) return { ok: false, error: "collection not found" };
    list.splice(idx, 1);
    saveRetailState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Inventory transfers between locations ─────────────────────

  registerLensAction("retail", "transfers-list", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const transfers = ensureRetailBucket(s, "transfers", userId);
    return { ok: true, result: { transfers } };
  });

  registerLensAction("retail", "transfers-create", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const fromLocation = String(params.fromLocation || "").trim();
    const toLocation = String(params.toLocation || "").trim();
    const lines = Array.isArray(params.lines) ? params.lines : [];
    if (!fromLocation || !toLocation) return { ok: false, error: "fromLocation and toLocation required" };
    if (lines.length === 0) return { ok: false, error: "at least one line required" };
    const transfer = {
      id: nextRetailId("xfer"), fromLocation, toLocation, lines,
      status: "in_transit",
      expectedArrival: params.expectedArrival || null,
      createdAt: nowIsoRet(),
    };
    ensureRetailBucket(s, "transfers", userId).push(transfer);
    saveRetailState();
    return { ok: true, result: { transfer } };
  });

  registerLensAction("retail", "transfers-receive", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const transfer = ensureRetailBucket(s, "transfers", userId).find(t => t.id === id);
    if (!transfer) return { ok: false, error: "transfer not found" };
    transfer.status = "received";
    transfer.receivedAt = nowIsoRet();
    saveRetailState();
    return { ok: true, result: { transfer } };
  });

  // ── Sales analytics ───────────────────────────────────────────

  registerLensAction("retail", "analytics-revenue-by-day", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const days = Math.max(7, Math.min(365, Number(params.days) || 30));
    const orders = s.orders.get(userId) || [];
    const now = Date.now();
    const since = now - days * 86400000;
    const byDay = new Map();
    for (let d = 0; d < days; d++) {
      const date = new Date(now - d * 86400000).toISOString().slice(0, 10);
      byDay.set(date, { date, revenue: 0, orderCount: 0 });
    }
    for (const order of orders) {
      const t = new Date(order.completedAt).getTime();
      if (t < since) continue;
      const date = new Date(order.completedAt).toISOString().slice(0, 10);
      const entry = byDay.get(date);
      if (entry) {
        entry.revenue = Math.round((entry.revenue + order.total) * 100) / 100;
        entry.orderCount++;
      }
    }
    const series = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
    const totalRevenue = series.reduce((sum, p) => sum + p.revenue, 0);
    const totalOrders = series.reduce((sum, p) => sum + p.orderCount, 0);
    return {
      ok: true,
      result: {
        series, days,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalOrders,
        avgOrderValue: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "analytics-top-products", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const limit = Math.max(1, Math.min(50, Number(params.limit) || 10));
    const days = Math.max(1, Number(params.days) || 30);
    const orders = s.orders.get(userId) || [];
    const since = Date.now() - days * 86400000;
    const stats = new Map();
    for (const order of orders) {
      if (new Date(order.completedAt).getTime() < since) continue;
      for (const line of order.lines) {
        const entry = stats.get(line.sku) || { sku: line.sku, name: line.name, qty: 0, revenue: 0 };
        entry.qty += line.qty;
        entry.revenue = Math.round((entry.revenue + line.qty * line.unitPrice) * 100) / 100;
        stats.set(line.sku, entry);
      }
    }
    const top = Array.from(stats.values()).sort((a, b) => b.revenue - a.revenue).slice(0, limit);
    return { ok: true, result: { topProducts: top, days } };
  });

  registerLensAction("retail", "analytics-summary", (ctx, _a, _p = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const orders = s.orders.get(userId) || [];
    const customers = ensureRetailBucket(s, "customers", userId);
    const products = s.products.get(userId);
    const productCount = products ? products.size : 0;
    const totalRevenue = orders.reduce((s, o) => s + o.total, 0);
    const day = 86400000;
    const now = Date.now();
    const ordersToday = orders.filter(o => (now - new Date(o.completedAt).getTime()) < day);
    const orders7d = orders.filter(o => (now - new Date(o.completedAt).getTime()) < 7 * day);
    const orders30d = orders.filter(o => (now - new Date(o.completedAt).getTime()) < 30 * day);
    return {
      ok: true,
      result: {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalOrders: orders.length,
        ordersToday: ordersToday.length,
        revenueToday: Math.round(ordersToday.reduce((s, o) => s + o.total, 0) * 100) / 100,
        revenue7d: Math.round(orders7d.reduce((s, o) => s + o.total, 0) * 100) / 100,
        revenue30d: Math.round(orders30d.reduce((s, o) => s + o.total, 0) * 100) / 100,
        avgOrderValue: orders.length > 0 ? Math.round((totalRevenue / orders.length) * 100) / 100 : 0,
        productCount,
        customerCount: customers.length,
        activeCarts: s.carts.get(userId)?.size || 0,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // feed — ingest real consumer retail products from the Open Beauty
  // Facts open database as visible DTUs. Free, no key.
  registerLensAction("retail", "feed", async (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(20, Math.round(Number(params.limit) || 12)));
    const page = (new Date().getDate() % 8) + 1;
    try {
      const r = await fetch(`https://world.openbeautyfacts.org/api/v2/search?fields=code,product_name,brands,categories&page_size=${limit}&page=${page}`);
      if (!r.ok) return { ok: false, error: `openbeautyfacts ${r.status}` };
      const data = await r.json();
      const products = (Array.isArray(data?.products) ? data.products : []).filter((p) => p.product_name).slice(0, limit);
      let ingested = 0, skipped = 0; const dtuIds = [];
      for (const p of products) {
        const id = `obf_${p.code}`;
        if (s.feedSeen.has(id)) { skipped++; continue; }
        const title = `Retail product: ${p.product_name}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `${title}\n\nBrand: ${p.brands || "?"}\nCategory: ${(p.categories || "?").slice(0, 200)}\nBarcode: ${p.code}\nSource: Open Beauty Facts`,
          tags: ["retail", "feed", "product", "openbeautyfacts"],
          source: "openbeautyfacts-feed",
          meta: { code: p.code, name: p.product_name, brands: p.brands },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(id); }
      }
      saveRetailState();
      return { ok: true, result: { ingested, skipped, source: "openbeautyfacts-products", dtuIds } };
    } catch (e) {
      return { ok: false, error: `openbeautyfacts unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ════════════════════════════════════════════════════════════════════
  //  2026 PARITY BACKLOG — Shopify feature gaps
  // ════════════════════════════════════════════════════════════════════

  // ── [M] Storefront — buyer-facing public shop ────────────────────
  //
  // A merchant publishes products to a public storefront and gets a
  // shareable slug. Buyers browse + add to a buyer cart + place an
  // order. Buyer carts are keyed off the merchant's userId so they
  // don't collide with the admin POS carts.

  function ensureStorefront(s, userId) {
    if (!s.storefronts) s.storefronts = new Map();
    if (!s.storefronts.has(userId)) {
      s.storefronts.set(userId, {
        slug: null, name: "", tagline: "",
        published: false, theme: "minimal",
        publishedSkus: [], updatedAt: nowIsoRet(),
      });
    }
    return s.storefronts.get(userId);
  }

  registerLensAction("retail", "storefront-get", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    return { ok: true, result: { storefront: ensureStorefront(s, userId) } };
  });

  registerLensAction("retail", "storefront-configure", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const sf = ensureStorefront(s, userId);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    if (name.length > 60) return { ok: false, error: "name too long" };
    sf.name = name;
    sf.tagline = String(params.tagline || "").slice(0, 140);
    if (["minimal", "bold", "warm"].includes(params.theme)) sf.theme = params.theme;
    if (!sf.slug) {
      sf.slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || `shop-${userId.slice(0, 6)}`;
    }
    sf.updatedAt = nowIsoRet();
    saveRetailState();
    return { ok: true, result: { storefront: sf } };
  });

  registerLensAction("retail", "storefront-publish", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const sf = ensureStorefront(s, userId);
    if (!sf.slug) return { ok: false, error: "configure the storefront before publishing" };
    const published = params.published !== false;
    const skus = Array.isArray(params.publishedSkus) ? params.publishedSkus.map(String) : null;
    if (skus) {
      const productMap = s.products.get(userId);
      const valid = skus.filter((sk) => productMap && productMap.has(sk));
      sf.publishedSkus = valid;
    }
    sf.published = published;
    sf.updatedAt = nowIsoRet();
    saveRetailState();
    return { ok: true, result: { storefront: sf, publicUrl: published ? `/shop/${sf.slug}` : null } };
  });

  // Buyer-facing read — returns published catalog with stock + ratings.
  registerLensAction("retail", "storefront-catalog", (ctx, _a, _p = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const sf = ensureStorefront(s, userId);
    if (!sf.published) return { ok: true, result: { published: false, products: [] } };
    const productMap = s.products.get(userId);
    const reviews = ensureRetailBucket(s, "reviews", userId);
    const skuFilter = sf.publishedSkus.length > 0 ? new Set(sf.publishedSkus) : null;
    const products = [];
    if (productMap) {
      for (const p of productMap.values()) {
        if (skuFilter && !skuFilter.has(p.sku)) continue;
        const skuReviews = reviews.filter((r) => r.sku === p.sku && r.status === "published");
        const avgRating = skuReviews.length > 0
          ? Math.round((skuReviews.reduce((sum, r) => sum + r.rating, 0) / skuReviews.length) * 10) / 10
          : null;
        products.push({
          sku: p.sku, name: p.name, price: p.price, category: p.category,
          inStock: p.stock > 0, stock: p.stock,
          avgRating, reviewCount: skuReviews.length,
        });
      }
    }
    products.sort((a, b) => a.name.localeCompare(b.name));
    return {
      ok: true,
      result: { published: true, storeName: sf.name, tagline: sf.tagline, theme: sf.theme, products },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Buyer places an order from the storefront. Decrements stock, writes
  // a real order tagged channel:'storefront'.
  registerLensAction("retail", "storefront-checkout", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const sf = ensureStorefront(s, userId);
    if (!sf.published) return { ok: false, error: "storefront not published" };
    const lines = Array.isArray(params.lines) ? params.lines : [];
    if (lines.length === 0) return { ok: false, error: "at least one line required" };
    const buyerName = String(params.buyerName || "").trim();
    const buyerEmail = String(params.buyerEmail || "").trim().toLowerCase();
    if (!buyerName) return { ok: false, error: "buyerName required" };
    if (!buyerEmail) return { ok: false, error: "buyerEmail required" };
    const productMap = s.products.get(userId);
    if (!productMap) return { ok: false, error: "no catalog" };
    const orderLines = [];
    for (const ln of lines) {
      const sku = String(ln.sku || "");
      const qty = Math.max(1, Math.round(Number(ln.qty) || 1));
      const product = productMap.get(sku);
      if (!product) return { ok: false, error: `product not found: ${sku}` };
      if (product.stock < qty) return { ok: false, error: `insufficient stock for ${product.name} (${product.stock} available)` };
      orderLines.push({ sku, name: product.name, unitPrice: product.price, qty });
    }
    for (const ln of orderLines) {
      const product = productMap.get(ln.sku);
      product.stock = Math.max(0, product.stock - ln.qty);
    }
    const subtotal = orderLines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
    if (!s.seq.has(userId)) s.seq.set(userId, { order: 1 });
    const seq = s.seq.get(userId);
    const order = {
      id: nextRetailId("ord"),
      number: `ORD-${String(seq.order).padStart(5, "0")}`,
      lines: orderLines,
      subtotal: Math.round(subtotal * 100) / 100,
      discount: 0,
      tax: 0,
      total: Math.round(subtotal * 100) / 100,
      tenders: [{ kind: "storefront", amount: Math.round(subtotal * 100) / 100 }],
      tendered: Math.round(subtotal * 100) / 100,
      change: 0,
      channel: "storefront",
      buyerName, buyerEmail,
      fulfillmentStatus: "unfulfilled",
      completedAt: nowIsoRet(),
    };
    seq.order++;
    if (!s.orders.has(userId)) s.orders.set(userId, []);
    s.orders.get(userId).unshift(order);
    saveRetailState();
    return { ok: true, result: { order } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [S] Order fulfillment workflow — pick / pack / ship ──────────

  const FULFILLMENT_STAGES = ["unfulfilled", "picking", "packed", "shipped", "delivered"];

  registerLensAction("retail", "fulfillment-queue", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const orders = s.orders.get(userId) || [];
    const queue = orders
      .filter((o) => (o.fulfillmentStatus || "unfulfilled") !== "delivered")
      .map((o) => ({
        id: o.id, number: o.number, total: o.total,
        itemCount: o.lines.reduce((sum, l) => sum + l.qty, 0),
        channel: o.channel || "pos",
        buyerName: o.buyerName || null,
        fulfillmentStatus: o.fulfillmentStatus || "unfulfilled",
        trackingNumber: o.trackingNumber || null,
        completedAt: o.completedAt,
      }));
    const counts = {};
    for (const st of FULFILLMENT_STAGES) counts[st] = 0;
    for (const o of orders) counts[o.fulfillmentStatus || "unfulfilled"]++;
    return { ok: true, result: { queue, counts, stages: FULFILLMENT_STAGES } };
  });

  registerLensAction("retail", "fulfillment-advance", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const orderId = String(params.orderId || "");
    const orders = s.orders.get(userId) || [];
    const order = orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, error: "order not found" };
    const current = order.fulfillmentStatus || "unfulfilled";
    let target = params.toStatus ? String(params.toStatus) : null;
    if (!target) {
      const idx = FULFILLMENT_STAGES.indexOf(current);
      if (idx < 0 || idx >= FULFILLMENT_STAGES.length - 1) {
        return { ok: false, error: "order already fully fulfilled" };
      }
      target = FULFILLMENT_STAGES[idx + 1];
    }
    if (!FULFILLMENT_STAGES.includes(target)) return { ok: false, error: "invalid fulfillment status" };
    if (FULFILLMENT_STAGES.indexOf(target) <= FULFILLMENT_STAGES.indexOf(current)) {
      return { ok: false, error: `cannot move fulfillment backward (${current} → ${target})` };
    }
    order.fulfillmentStatus = target;
    if (!Array.isArray(order.fulfillmentLog)) order.fulfillmentLog = [];
    order.fulfillmentLog.push({ status: target, at: nowIsoRet() });
    // A notification is recorded for the buyer when shipped/delivered.
    let notification = null;
    if ((target === "shipped" || target === "delivered") && order.buyerEmail) {
      const notes = ensureRetailBucket(s, "notifications", userId);
      notification = {
        id: nextRetailId("ntf"),
        orderId: order.id, orderNumber: order.number,
        to: order.buyerEmail,
        kind: target === "shipped" ? "shipment_notice" : "delivery_notice",
        message: target === "shipped"
          ? `Your order ${order.number} has shipped${order.trackingNumber ? ` — tracking ${order.trackingNumber}` : ""}.`
          : `Your order ${order.number} was delivered.`,
        sentAt: nowIsoRet(),
      };
      notes.unshift(notification);
    }
    saveRetailState();
    return { ok: true, result: { order: { id: order.id, number: order.number, fulfillmentStatus: order.fulfillmentStatus, fulfillmentLog: order.fulfillmentLog }, notification } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "fulfillment-notifications", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const notifications = ensureRetailBucket(s, "notifications", userId);
    return { ok: true, result: { notifications: notifications.slice(0, 100) } };
  });

  // ── [M] Shipping labels + tracking ───────────────────────────────
  //
  // Beyond rate quotes: buy a label for an order and track it. When
  // CONCORD_SHIPPING_PROVIDER_URL + token are configured, the buy/track
  // calls hit a real carrier-aggregator REST API. Without config they
  // return a clear "not configured" error — no synthesized tracking.

  async function shippingProviderFetch(path, { method = "GET", body } = {}) {
    const base = process.env.CONCORD_SHIPPING_PROVIDER_URL;
    const token = process.env.CONCORD_SHIPPING_PROVIDER_TOKEN;
    if (!base) throw new Error("CONCORD_SHIPPING_PROVIDER_URL not configured");
    const url = `${base.replace(/\/$/, "")}${path}`;
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json();
    if (!r.ok) throw new Error(`shipping provider ${path} ${r.status}: ${data?.error || data?.message || "unknown"}`);
    return data;
  }

  registerLensAction("retail", "shipping-label-buy", async (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const orderId = String(params.orderId || "");
    const carrier = String(params.carrier || "").trim().toLowerCase();
    const service = String(params.service || "ground").trim();
    const orders = s.orders.get(userId) || [];
    const order = orders.find((o) => o.id === orderId);
    if (!order) return { ok: false, error: "order not found" };
    if (!carrier) return { ok: false, error: "carrier required (e.g. usps, ups, fedex)" };
    if (order.shippingLabel) return { ok: false, error: "label already purchased for this order" };
    if (!process.env.CONCORD_SHIPPING_PROVIDER_URL) {
      return { ok: false, error: "Shipping carrier not configured. Set CONCORD_SHIPPING_PROVIDER_URL to buy real labels." };
    }
    const toAddress = params.toAddress && typeof params.toAddress === "object" ? params.toAddress : null;
    if (!toAddress) return { ok: false, error: "toAddress required" };
    try {
      const resp = await shippingProviderFetch("/v1/labels", {
        method: "POST",
        body: {
          carrier, service,
          to_address: toAddress,
          parcel: params.parcel || { weight_oz: 16 },
          reference: order.number,
        },
      });
      const label = {
        id: nextRetailId("lbl"),
        orderId: order.id, orderNumber: order.number,
        carrier, service,
        trackingNumber: String(resp.tracking_number || resp.trackingNumber || ""),
        labelUrl: String(resp.label_url || resp.labelUrl || ""),
        costCents: Math.round(Number(resp.rate_cents ?? resp.rateCents ?? 0)),
        purchasedAt: nowIsoRet(),
        trackingStatus: "label_created",
      };
      order.shippingLabel = label;
      order.trackingNumber = label.trackingNumber;
      ensureRetailBucket(s, "shippingLabels", userId).unshift(label);
      saveRetailState();
      return { ok: true, result: { label } };
    } catch (e) {
      return { ok: false, error: `label purchase failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  registerLensAction("retail", "shipping-labels-list", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const labels = ensureRetailBucket(s, "shippingLabels", userId);
    return { ok: true, result: { labels } };
  });

  registerLensAction("retail", "shipping-track", async (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const trackingNumber = String(params.trackingNumber || "").trim();
    const carrier = String(params.carrier || "").trim().toLowerCase();
    if (!trackingNumber) return { ok: false, error: "trackingNumber required" };
    if (!process.env.CONCORD_SHIPPING_PROVIDER_URL) {
      return { ok: false, error: "Shipping carrier not configured. Set CONCORD_SHIPPING_PROVIDER_URL to track shipments." };
    }
    try {
      const resp = await shippingProviderFetch(
        `/v1/tracking?tracking_number=${encodeURIComponent(trackingNumber)}${carrier ? `&carrier=${encodeURIComponent(carrier)}` : ""}`,
      );
      const status = String(resp.status || resp.tracking_status || "unknown");
      const events = Array.isArray(resp.events) ? resp.events : (Array.isArray(resp.tracking_events) ? resp.tracking_events : []);
      // Persist latest status onto any matching label.
      const labels = ensureRetailBucket(s, "shippingLabels", userId);
      const label = labels.find((l) => l.trackingNumber === trackingNumber);
      if (label) { label.trackingStatus = status; label.trackingCheckedAt = nowIsoRet(); }
      saveRetailState();
      return { ok: true, result: { trackingNumber, carrier: carrier || resp.carrier || null, status, events } };
    } catch (e) {
      return { ok: false, error: `tracking lookup failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ── [M] Marketing campaigns ──────────────────────────────────────
  //
  // Email/discount campaigns targeted at a customer segment, with
  // conversion tracking. recordConversion attributes an order back to
  // a campaign to compute revenue + ROI.

  function segmentMembers(s, userId, segment) {
    const customers = ensureRetailBucket(s, "customers", userId);
    const now = Date.now();
    const day = 86400000;
    switch (segment) {
      case "all": return customers;
      case "marketing": return customers.filter((c) => c.acceptsMarketing);
      case "vip": return customers.filter((c) => c.totalSpent >= 1000 || c.orderCount >= 5);
      case "new": return customers.filter((c) => c.orderCount <= 1);
      case "repeat": return customers.filter((c) => c.orderCount >= 2 && c.orderCount < 5);
      case "atRisk": return customers.filter((c) => c.lastOrderAt && (now - new Date(c.lastOrderAt).getTime()) > 90 * day && c.orderCount > 0);
      case "dormant": return customers.filter((c) => !c.lastOrderAt || (now - new Date(c.lastOrderAt).getTime()) > 180 * day);
      default: return customers;
    }
  }

  registerLensAction("retail", "campaigns-list", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const campaigns = ensureRetailBucket(s, "campaigns", userId);
    return { ok: true, result: { campaigns } };
  });

  registerLensAction("retail", "campaigns-create", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const channel = ["email", "sms", "discount"].includes(params.channel) ? params.channel : "email";
    const segment = ["all", "marketing", "vip", "new", "repeat", "atRisk", "dormant"].includes(params.segment)
      ? params.segment : "marketing";
    const subject = String(params.subject || "").slice(0, 160);
    const body = String(params.body || "").slice(0, 4000);
    const discountCode = params.discountCode ? String(params.discountCode).trim().toUpperCase() : null;
    if (channel === "discount" && !discountCode) {
      return { ok: false, error: "discount campaigns require a discountCode" };
    }
    const campaign = {
      id: nextRetailId("camp"), name, channel, segment, subject, body, discountCode,
      status: "draft",
      audienceSize: 0, sentCount: 0,
      conversions: 0, revenue: 0,
      createdAt: nowIsoRet(), sentAt: null,
    };
    ensureRetailBucket(s, "campaigns", userId).push(campaign);
    saveRetailState();
    return { ok: true, result: { campaign } };
  });

  registerLensAction("retail", "campaigns-send", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const campaign = ensureRetailBucket(s, "campaigns", userId).find((c) => c.id === id);
    if (!campaign) return { ok: false, error: "campaign not found" };
    if (campaign.status === "sent") return { ok: false, error: "campaign already sent" };
    const members = segmentMembers(s, userId, campaign.segment);
    const recipients = campaign.channel === "sms"
      ? members.filter((m) => m.phone)
      : members.filter((m) => m.email);
    campaign.audienceSize = members.length;
    campaign.sentCount = recipients.length;
    campaign.status = "sent";
    campaign.sentAt = nowIsoRet();
    saveRetailState();
    return {
      ok: true,
      result: { campaign, recipients: recipients.map((r) => ({ name: r.name, email: r.email, phone: r.phone })) },
    };
  });

  // Attribute an order's revenue to a campaign (conversion tracking).
  registerLensAction("retail", "campaigns-record-conversion", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const orderId = String(params.orderId || "");
    const campaign = ensureRetailBucket(s, "campaigns", userId).find((c) => c.id === id);
    if (!campaign) return { ok: false, error: "campaign not found" };
    if (campaign.status !== "sent") return { ok: false, error: "campaign not sent yet" };
    const order = (s.orders.get(userId) || []).find((o) => o.id === orderId);
    if (!order) return { ok: false, error: "order not found" };
    if (!Array.isArray(campaign.attributedOrderIds)) campaign.attributedOrderIds = [];
    if (campaign.attributedOrderIds.includes(orderId)) {
      return { ok: false, error: "order already attributed to this campaign" };
    }
    campaign.attributedOrderIds.push(orderId);
    campaign.conversions++;
    campaign.revenue = Math.round((campaign.revenue + order.total) * 100) / 100;
    saveRetailState();
    return { ok: true, result: { campaign } };
  });

  registerLensAction("retail", "campaigns-performance", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = params.id ? String(params.id) : null;
    const all = ensureRetailBucket(s, "campaigns", userId);
    const list = id ? all.filter((c) => c.id === id) : all.filter((c) => c.status === "sent");
    const rows = list.map((c) => {
      const conversionRate = c.sentCount > 0 ? Math.round((c.conversions / c.sentCount) * 10000) / 100 : 0;
      const revenuePerRecipient = c.sentCount > 0 ? Math.round((c.revenue / c.sentCount) * 100) / 100 : 0;
      return {
        id: c.id, name: c.name, channel: c.channel, segment: c.segment,
        sentCount: c.sentCount, conversions: c.conversions,
        revenue: c.revenue, conversionRate, revenuePerRecipient,
      };
    });
    const totalRevenue = rows.reduce((sum, r) => sum + r.revenue, 0);
    const totalConversions = rows.reduce((sum, r) => sum + r.conversions, 0);
    const totalSent = rows.reduce((sum, r) => sum + r.sentCount, 0);
    return {
      ok: true,
      result: {
        campaigns: rows,
        totals: {
          campaignCount: rows.length,
          totalSent, totalConversions,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          avgConversionRate: totalSent > 0 ? Math.round((totalConversions / totalSent) * 10000) / 100 : 0,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [S] Multi-channel listing — sync inventory to marketplaces ───

  const SALES_CHANNELS = ["amazon", "ebay", "etsy", "walmart", "tiktok_shop"];

  registerLensAction("retail", "channels-list", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const channels = ensureRetailBucket(s, "channels", userId);
    return { ok: true, result: { channels, available: SALES_CHANNELS } };
  });

  registerLensAction("retail", "channels-connect", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const channel = String(params.channel || "").trim().toLowerCase();
    if (!SALES_CHANNELS.includes(channel)) {
      return { ok: false, error: `unsupported channel; one of: ${SALES_CHANNELS.join(", ")}` };
    }
    const channels = ensureRetailBucket(s, "channels", userId);
    if (channels.some((c) => c.channel === channel)) return { ok: false, error: "channel already connected" };
    const conn = {
      id: nextRetailId("chan"), channel,
      storeName: String(params.storeName || "").slice(0, 80),
      listedSkus: [], status: "connected",
      lastSyncedAt: null, connectedAt: nowIsoRet(),
    };
    channels.push(conn);
    saveRetailState();
    return { ok: true, result: { channel: conn } };
  });

  registerLensAction("retail", "channels-disconnect", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const channels = ensureRetailBucket(s, "channels", userId);
    const idx = channels.findIndex((c) => c.id === id);
    if (idx < 0) return { ok: false, error: "channel not found" };
    channels.splice(idx, 1);
    saveRetailState();
    return { ok: true, result: { id, disconnected: true } };
  });

  // List specific products onto a connected channel.
  registerLensAction("retail", "channels-list-products", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const skus = Array.isArray(params.skus) ? params.skus.map(String) : [];
    const channel = ensureRetailBucket(s, "channels", userId).find((c) => c.id === id);
    if (!channel) return { ok: false, error: "channel not found" };
    if (skus.length === 0) return { ok: false, error: "at least one sku required" };
    const productMap = s.products.get(userId);
    const valid = skus.filter((sk) => productMap && productMap.has(sk));
    if (valid.length === 0) return { ok: false, error: "no valid products to list" };
    for (const sk of valid) if (!channel.listedSkus.includes(sk)) channel.listedSkus.push(sk);
    saveRetailState();
    return { ok: true, result: { channel } };
  });

  // Push current stock levels to every connected channel.
  registerLensAction("retail", "channels-sync-inventory", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = params.id ? String(params.id) : null;
    const channels = ensureRetailBucket(s, "channels", userId);
    const targets = id ? channels.filter((c) => c.id === id) : channels;
    if (targets.length === 0) return { ok: false, error: "no connected channels" };
    const productMap = s.products.get(userId);
    const syncedAt = nowIsoRet();
    const report = [];
    for (const ch of targets) {
      const updates = ch.listedSkus.map((sk) => {
        const product = productMap ? productMap.get(sk) : null;
        return { sku: sk, stock: product ? product.stock : 0, found: Boolean(product) };
      });
      ch.lastSyncedAt = syncedAt;
      ch.lastSyncCount = updates.length;
      report.push({ channelId: ch.id, channel: ch.channel, syncedSkus: updates.length, updates });
    }
    saveRetailState();
    return { ok: true, result: { syncedAt, channels: report } };
  });

  // ── [S] Product reviews + ratings ────────────────────────────────

  registerLensAction("retail", "reviews-list", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const sku = params.sku ? String(params.sku) : null;
    let reviews = ensureRetailBucket(s, "reviews", userId);
    if (sku) reviews = reviews.filter((r) => r.sku === sku);
    const sorted = reviews.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { ok: true, result: { reviews: sorted } };
  });

  registerLensAction("retail", "reviews-submit", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const sku = String(params.sku || "").trim();
    if (!sku) return { ok: false, error: "sku required" };
    const productMap = s.products.get(userId);
    if (!productMap || !productMap.has(sku)) return { ok: false, error: `product not found: ${sku}` };
    const rating = Math.round(Number(params.rating));
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) return { ok: false, error: "rating must be 1-5" };
    const authorName = String(params.authorName || "").trim();
    if (!authorName) return { ok: false, error: "authorName required" };
    const body = String(params.body || "").trim().slice(0, 2000);
    // Verified-purchase flag — true if this buyer email appears on an order with the sku.
    const buyerEmail = String(params.buyerEmail || "").trim().toLowerCase();
    let verified = false;
    if (buyerEmail) {
      const orders = s.orders.get(userId) || [];
      verified = orders.some((o) => (o.buyerEmail || "").toLowerCase() === buyerEmail && o.lines.some((l) => l.sku === sku));
    }
    const review = {
      id: nextRetailId("rev"), sku,
      productName: productMap.get(sku).name,
      rating, title: String(params.title || "").slice(0, 120), body,
      authorName, buyerEmail: buyerEmail || null,
      verified,
      status: "published",
      createdAt: nowIsoRet(),
    };
    ensureRetailBucket(s, "reviews", userId).push(review);
    saveRetailState();
    return { ok: true, result: { review } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "reviews-moderate", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const status = ["published", "hidden"].includes(params.status) ? params.status : null;
    if (!status) return { ok: false, error: "status must be published or hidden" };
    const review = ensureRetailBucket(s, "reviews", userId).find((r) => r.id === id);
    if (!review) return { ok: false, error: "review not found" };
    review.status = status;
    saveRetailState();
    return { ok: true, result: { review } };
  });

  registerLensAction("retail", "reviews-delete", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const list = ensureRetailBucket(s, "reviews", userId);
    const idx = list.findIndex((r) => r.id === id);
    if (idx < 0) return { ok: false, error: "review not found" };
    list.splice(idx, 1);
    saveRetailState();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("retail", "reviews-summary", (ctx, _a, _p = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const reviews = ensureRetailBucket(s, "reviews", userId).filter((r) => r.status === "published");
    const total = reviews.length;
    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let sum = 0;
    for (const r of reviews) { distribution[r.rating]++; sum += r.rating; }
    const bySku = new Map();
    for (const r of reviews) {
      const e = bySku.get(r.sku) || { sku: r.sku, productName: r.productName, count: 0, sum: 0 };
      e.count++; e.sum += r.rating;
      bySku.set(r.sku, e);
    }
    const topRated = Array.from(bySku.values())
      .map((e) => ({ sku: e.sku, productName: e.productName, reviewCount: e.count, avgRating: Math.round((e.sum / e.count) * 10) / 10 }))
      .sort((a, b) => b.avgRating - a.avgRating || b.reviewCount - a.reviewCount)
      .slice(0, 10);
    return {
      ok: true,
      result: {
        totalReviews: total,
        avgRating: total > 0 ? Math.round((sum / total) * 10) / 10 : 0,
        verifiedCount: reviews.filter((r) => r.verified).length,
        distribution,
        topRated,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── [S] Staff accounts + permissions ─────────────────────────────

  const STAFF_ROLES = {
    owner: ["products", "orders", "customers", "discounts", "analytics", "staff", "fulfillment", "campaigns"],
    manager: ["products", "orders", "customers", "discounts", "analytics", "fulfillment", "campaigns"],
    fulfillment: ["orders", "fulfillment"],
    cashier: ["orders", "products"],
    marketing: ["customers", "discounts", "campaigns", "analytics"],
  };

  registerLensAction("retail", "staff-list", (ctx, _a, _p = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const staff = ensureRetailBucket(s, "staff", userId);
    return { ok: true, result: { staff, roles: Object.keys(STAFF_ROLES) } };
  });

  registerLensAction("retail", "staff-invite", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const name = String(params.name || "").trim();
    const email = String(params.email || "").trim().toLowerCase();
    const role = String(params.role || "").trim().toLowerCase();
    if (!name) return { ok: false, error: "name required" };
    if (!email) return { ok: false, error: "email required" };
    if (!STAFF_ROLES[role]) return { ok: false, error: `role must be one of: ${Object.keys(STAFF_ROLES).join(", ")}` };
    const staff = ensureRetailBucket(s, "staff", userId);
    if (staff.some((m) => m.email === email)) return { ok: false, error: "a staff member with that email already exists" };
    const member = {
      id: nextRetailId("staff"), name, email, role,
      permissions: STAFF_ROLES[role].slice(),
      status: "invited",
      invitedAt: nowIsoRet(), activatedAt: null,
    };
    staff.push(member);
    saveRetailState();
    return { ok: true, result: { member } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "staff-update-role", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const role = String(params.role || "").trim().toLowerCase();
    if (!STAFF_ROLES[role]) return { ok: false, error: `role must be one of: ${Object.keys(STAFF_ROLES).join(", ")}` };
    const member = ensureRetailBucket(s, "staff", userId).find((m) => m.id === id);
    if (!member) return { ok: false, error: "staff member not found" };
    member.role = role;
    // Custom permission override, else default to the role's set.
    if (Array.isArray(params.permissions)) {
      const all = STAFF_ROLES.owner;
      member.permissions = params.permissions.map(String).filter((p) => all.includes(p));
    } else {
      member.permissions = STAFF_ROLES[role].slice();
    }
    saveRetailState();
    return { ok: true, result: { member } };
  });

  registerLensAction("retail", "staff-activate", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const member = ensureRetailBucket(s, "staff", userId).find((m) => m.id === id);
    if (!member) return { ok: false, error: "staff member not found" };
    member.status = member.status === "active" ? "suspended" : "active";
    if (member.status === "active" && !member.activatedAt) member.activatedAt = nowIsoRet();
    saveRetailState();
    return { ok: true, result: { member } };
  });

  registerLensAction("retail", "staff-remove", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const list = ensureRetailBucket(s, "staff", userId);
    const idx = list.findIndex((m) => m.id === id);
    if (idx < 0) return { ok: false, error: "staff member not found" };
    list.splice(idx, 1);
    saveRetailState();
    return { ok: true, result: { id, removed: true } };
  });

  // Permission check helper macro — answers "can role X do Y".
  registerLensAction("retail", "staff-check-permission", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const permission = String(params.permission || "").trim();
    if (!permission) return { ok: false, error: "permission required" };
    const member = ensureRetailBucket(s, "staff", userId).find((m) => m.id === id);
    if (!member) return { ok: false, error: "staff member not found" };
    const allowed = member.status === "active" && member.permissions.includes(permission);
    return { ok: true, result: { allowed, role: member.role, status: member.status } };
  });
};
