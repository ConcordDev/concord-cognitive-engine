// server/domains/retail.js
// Domain actions for retail/CRM: reorder, pipeline, LTV, SLA checks.

export default function registerRetailActions(registerLensAction) {
  // Shared SLA-target-by-priority table (minutes). This is the SINGLE source
  // of truth for "how fast must priority X be handled" across the whole
  // retail domain — the live `slaStatus` incidents branch (below) and the
  // persisted `tickets-*` queue (2026-07 Wave-4 support-desk unit, near the
  // bottom of this file) both read this SAME object so a persisted ticket's
  // computed deadline and the ad-hoc incidents-report compliance math can
  // never silently disagree. Do not invent a second set of numbers.
  const TICKET_PRIORITY_SLA_MINUTES = { critical: 60, high: 240, medium: 1440, low: 2880 };

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
    // Book source resolution (2026-07 CRM unit): the ORIGINAL contract treated
    // ANY non-Array `deals`/`opportunities` (including garbage like `{boom:true}`)
    // as an empty pasted book — that exact "malformed input → empty pipeline,
    // never crash" behavior is preserved byte-identically here by falling back
    // to the persisted book ONLY when the caller supplied NEITHER key at all
    // (checked via `in`, not truthiness/shape) — a real book was "pasted" the
    // moment either key is present, even if its value is invalid, and an
    // invalid pasted value still degrades to an empty active-deals list exactly
    // as before. Only true omission of both keys reads the caller's PERSISTED
    // deals (the deals-* macro family below), mapped into the same
    // {name,value,probability,stage,expectedCloseDate} shape this calculator
    // has always consumed. `dealSource` is stamped on the result so the UI can
    // honestly attribute the numbers.
    let deals;
    let dealSource;
    const dealsKeyPresent = "deals" in artifact.data;
    const opportunitiesKeyPresent = "opportunities" in artifact.data;
    if (dealsKeyPresent || opportunitiesKeyPresent) {
      deals = Array.isArray(artifact.data.deals)
        ? artifact.data.deals
        : (Array.isArray(artifact.data.opportunities) ? artifact.data.opportunities : []);
      dealSource = "pasted";
    } else {
      const s = getRetailState();
      const persisted = s ? ensureRetailBucket(s, "deals", retailActor(ctx)) : [];
      deals = persisted.map((d) => ({
        name: d.name, value: d.value, probability: d.probability,
        stage: d.stage, expectedCloseDate: d.expectedCloseDate || null,
      }));
      dealSource = "persisted";
    }
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
      dealSource,
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
      const defaultTargetByPriority = params.slaTargetMinutes || TICKET_PRIORITY_SLA_MINUTES;
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

    // ── Legacy hours-based ticket branch, now with a persisted-queue fallback ──
    // Mirrors the `pipelineValue` → `deals-*` fallback pattern exactly (2026-07
    // support-desk unit): the ORIGINAL contract treated any non-array/falsy
    // `tickets` (including a garbage non-array value) as an empty pasted book —
    // that "malformed input → empty report, never crash" behavior is preserved
    // BYTE-IDENTICALLY by only falling back to the persisted `tickets-*` queue
    // when the caller supplied NEITHER `incidents` NOR `tickets` at all (checked
    // via `in`, not truthiness/shape). A pasted `tickets` key — even an invalid
    // value — still degrades to an empty ticket list exactly as before; only
    // true omission of both keys reads the caller's own persisted queue.
    let tickets;
    let ticketSource;
    if ("tickets" in artifact.data) {
      tickets = Array.isArray(artifact.data.tickets) ? artifact.data.tickets : [];
      ticketSource = "pasted";
    } else {
      const s = getRetailState();
      const persisted = s ? ensureRetailBucket(s, "tickets", retailActor(ctx)) : [];
      tickets = persisted.map((t) => ({
        ticketId: t.id,
        subject: t.subject,
        priority: t.priority,
        createdAt: t.createdAt,
        resolvedAt: t.resolvedAt || null,
      }));
      ticketSource = "persisted";
    }
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
      ticketSource,
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
  //
  // Wave 4 larger-unit build (2026-07-16), fourth and final of retail's
  // originally-deferred items: richer product schema. `product-upsert` is
  // structurally different from the deals-*/tickets-*/displays-* macro
  // families built just before it in this same file (`cb45c52b`/`e9c4f7fd`/
  // `3f0dfc3d`) — those do field-by-field PARTIAL updates (only touch what
  // the caller explicitly sends); `product-upsert` does a FULL OBJECT
  // REPLACE every call, preserving only `createdAt` from `existing`. The
  // three new catalog-depth fields below (`supplier`/`leadTimeDays`/
  // `dailySalesRate`) are preserved from `existing` the SAME way `createdAt`
  // already is, whenever the caller omits them — so the pre-existing
  // minimal call shape `{sku,name,price,stock}` (still used by the POS/cart
  // flow's stock-decrement writes and by every pre-existing test) never
  // silently wipes catalog depth set by a prior richer call. Passing an
  // explicit value (including `null`/`""` for leadTimeDays) DOES update/
  // clear the field — that's the deliberate "unset" path, matching how
  // `category`/`barcode` already behave on this same macro (full-replace,
  // not preserved, pre-existing and unchanged here — out of this unit's
  // scope, only the three NEW fields get the preserve treatment).
  //
  // `priceHistory` is never caller-supplied (a caller injecting a fake
  // price history would defeat the whole point of an audit trail) — it's
  // server-computed: seeded with one entry on create (`oldPrice: null`,
  // mirrors the `statusHistory`/`stageHistory` seed-on-create convention
  // the sibling units established), then appended to ONLY when the new
  // `price` differs from `existing.price` on a later call. A same-price
  // re-upsert (e.g. the POS stock-decrement path re-upserting a product at
  // its unchanged price — it doesn't, but hypothetically could) never
  // appends a spurious entry.
  //
  // `turnoverRate` = (dailySalesRate × 365) / stock — the standard
  // "annual units sold ÷ average units on hand" inventory-turnover-rate
  // formula (higher = faster-moving stock). Honestly `null`, never
  // `Infinity`, when `stock === 0` (can't compute a rate against zero
  // inventory on hand).
  //
  // `abcClass` ("A"/"B"/"C") CANNOT be computed by a single product record
  // in isolation — ABC analysis ranks a product's revenue contribution
  // against the REST of the catalog. It's computed in `product-list`
  // (below) across the caller's full catalog, not here.

  function computeProductAbcClasses(products) {
    // Revenue proxy per product = price × dailySalesRate (a real "how much
    // this SKU is worth per day" number from the schema — never fabricated).
    // Standard Pareto/ABC bucketing: rank descending by revenue, classify
    // each product by the CUMULATIVE revenue share of every product ranked
    // ABOVE it (not including itself) — this is what correctly puts a
    // single dominant SKU (0% preceding it) into "A" instead of overshooting
    // into "C" when its own revenue alone crosses the 80% line. A = share
    // preceding it < 80%, B = 80–95%, C = >= 95%. Honestly `null` for every
    // product (not "C") when the catalog's total modeled revenue is 0 — no
    // sales-rate data exists yet to classify against.
    const revenues = products.map((p) => ({
      sku: p.sku,
      revenueRate: (Number(p.price) || 0) * (Number(p.dailySalesRate) || 0),
    }));
    const total = revenues.reduce((sum, r) => sum + r.revenueRate, 0);
    const classBySku = new Map();
    if (!(total > 0)) {
      for (const r of revenues) classBySku.set(r.sku, null);
      return classBySku;
    }
    const ranked = revenues.slice().sort((a, b) => b.revenueRate - a.revenueRate);
    let cumulativeBefore = 0;
    for (const r of ranked) {
      const shareBefore = cumulativeBefore / total;
      let cls;
      if (shareBefore < 0.80) cls = "A";
      else if (shareBefore < 0.95) cls = "B";
      else cls = "C";
      classBySku.set(r.sku, cls);
      cumulativeBefore += r.revenueRate;
    }
    return classBySku;
  }

  registerLensAction("retail", "product-list", (ctx, _artifact, _params = {}) => {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const map = s.products.get(userId);
    if (!map) {
      return { ok: true, result: { products: [], abcSummary: { A: 0, B: 0, C: 0, unclassified: 0 } } };
    }
    const productsRaw = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    const classBySku = computeProductAbcClasses(productsRaw);
    let aCount = 0, bCount = 0, cCount = 0, unclassified = 0;
    const products = productsRaw.map((p) => {
      const abcClass = classBySku.has(p.sku) ? classBySku.get(p.sku) : null;
      if (abcClass === "A") aCount++;
      else if (abcClass === "B") bCount++;
      else if (abcClass === "C") cCount++;
      else unclassified++;
      return { ...p, abcClass };
    });
    return { ok: true, result: { products, abcSummary: { A: aCount, B: bCount, C: cCount, unclassified } } };
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

    // ── Non-destructive preserve (the landmine): only touch these three
    // when the caller actually passes them; otherwise carry the existing
    // value forward exactly like `createdAt` already does. ──
    let supplier = existing?.supplier || "";
    if (params.supplier !== undefined) supplier = String(params.supplier || "").slice(0, 120);

    let leadTimeDays = existing?.leadTimeDays ?? null;
    if (params.leadTimeDays !== undefined) {
      if (params.leadTimeDays === null || params.leadTimeDays === "") {
        leadTimeDays = null;
      } else {
        const n = Number(params.leadTimeDays);
        if (!Number.isFinite(n) || n < 0) return { ok: false, error: "leadTimeDays must be >= 0" };
        leadTimeDays = n;
      }
    }

    let dailySalesRate = existing?.dailySalesRate ?? 0;
    if (params.dailySalesRate !== undefined) {
      const n = Number(params.dailySalesRate);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: "dailySalesRate must be >= 0" };
      dailySalesRate = n;
    }

    // ── Server-computed only, never caller-supplied ──
    const now = nowIsoRet();
    let priceHistory;
    if (!existing) {
      priceHistory = [{ oldPrice: null, newPrice: price, changedAt: now }];
    } else {
      priceHistory = Array.isArray(existing.priceHistory) ? existing.priceHistory.slice() : [];
      if (price !== existing.price) {
        priceHistory.push({ oldPrice: existing.price, newPrice: price, changedAt: now });
      }
    }
    // Standard inventory-turnover-rate formula: annual units sold ÷ average
    // units on hand ≈ (dailySalesRate × 365) / stock. Honest `null` (never
    // Infinity) when stock is 0.
    const turnoverRate = stock > 0 ? Math.round(((dailySalesRate * 365) / stock) * 100) / 100 : null;

    const product = {
      sku, name, price,
      stock,
      category: String(params.category || "").slice(0, 40),
      barcode: String(params.barcode || "").slice(0, 32),
      supplier,
      leadTimeDays,
      dailySalesRate,
      turnoverRate,
      priceHistory,
      updatedAt: now,
      createdAt: existing?.createdAt || now,
    };
    s.products.get(userId).set(sku, product);
    saveRetailState();
    return { ok: true, result: { product } };
  });

  // Read-only view of the auto-appended price-change audit trail for one
  // SKU. Kept as a dedicated macro (rather than requiring the whole
  // catalog via product-list) because a price-history mini-timeline widget
  // in the UI shouldn't need to fetch every other product to render one
  // product's history. `product-list`/`product-upsert` also carry
  // `priceHistory` inline on the full product record for convenience when
  // the caller already has the object in hand.
  registerLensAction("retail", "product-price-history", (ctx, _artifact, params = {}) => {
    const s = getRetailState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const sku = String(params.sku || "").trim();
    if (!sku) return { ok: false, error: "sku required" };
    const map = s.products.get(userId);
    const product = map ? map.get(sku) : null;
    if (!product) return { ok: false, error: "product not found" };
    return {
      ok: true,
      result: { sku, priceHistory: Array.isArray(product.priceHistory) ? product.priceHistory : [] },
    };
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
    // Cascade: a variant pointing at a deleted parent SKU is dangling data
    // no UI can ever legitimately show (its price derives from a parent
    // that no longer exists) — remove it rather than leave an orphan.
    const variants = ensureRetailBucket(s, "productVariants", userId);
    for (let i = variants.length - 1; i >= 0; i--) {
      if (variants[i].parentSku === sku) variants.splice(i, 1);
    }
    saveRetailState();
    return { ok: true, result: { deleted: sku } };
  });

  // ── Product variants (size/color/style sub-SKUs) ──
  //
  // Modeled as genuinely separate catalog-adjacent records (own SKU, own
  // stock, own createdAt/updatedAt) rather than an array embedded on the
  // parent product — the same reasoning the deals/tickets/displays units
  // used for their own entities: a variant is independently addressable
  // (its own SKU can be scanned at the register, its own stock decremented
  // independently of the parent), so it gets its own bucket + its own CRUD
  // rather than living inside product-upsert's full-replace object (which
  // would reintroduce the exact landmine this unit is closing). Unlike
  // product-upsert, these three macros use TRUE partial-update semantics
  // from day one (only touch fields the caller sends) — there's no legacy
  // minimal-call-shape contract to preserve here since the macros are new,
  // so there was no reason to inherit product-upsert's full-replace shape.

  registerLensAction("retail", "product-variant-upsert", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const sku = String(params.sku || "").trim();
    if (!sku) return { ok: false, error: "sku required" };
    if (sku.length > 32) return { ok: false, error: "sku too long" };

    const variants = ensureRetailBucket(s, "productVariants", userId);
    const existing = variants.find((v) => v.sku === sku);

    let parentSku = existing?.parentSku;
    if (params.parentSku !== undefined) parentSku = String(params.parentSku || "").trim();
    if (!parentSku) return { ok: false, error: "parentSku required" };
    const catalog = s.products.get(userId);
    if (!catalog || !catalog.has(parentSku)) {
      return { ok: false, error: `parent product not found for sku: ${parentSku}` };
    }
    if (!existing && catalog.has(sku)) {
      return { ok: false, error: "sku collides with an existing product SKU" };
    }
    const parent = catalog.get(parentSku);

    let stock = existing?.stock ?? 0;
    if (params.stock !== undefined) {
      const n = Number(params.stock);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: "stock must be >= 0" };
      stock = n;
    }
    let priceDelta = existing?.priceDelta ?? 0;
    if (params.priceDelta !== undefined) {
      const n = Number(params.priceDelta);
      if (!Number.isFinite(n)) return { ok: false, error: "priceDelta must be a finite number" };
      priceDelta = n;
    }
    const price = Math.round((parent.price + priceDelta) * 100) / 100;
    if (price < 0) return { ok: false, error: "parent price + priceDelta would be negative" };

    let size = existing?.size ?? "";
    if (params.size !== undefined) size = String(params.size || "").slice(0, 40);
    let color = existing?.color ?? "";
    if (params.color !== undefined) color = String(params.color || "").slice(0, 40);
    let style = existing?.style ?? "";
    if (params.style !== undefined) style = String(params.style || "").slice(0, 40);
    if (!existing && !size && !color && !style) {
      return { ok: false, error: "at least one of size/color/style is required" };
    }

    const now = nowIsoRet();
    const variant = {
      sku, parentSku,
      size, color, style,
      stock, priceDelta, price,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (existing) Object.assign(existing, variant);
    else variants.push(variant);
    saveRetailState();
    return { ok: true, result: { variant } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "product-variant-list", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const all = ensureRetailBucket(s, "productVariants", userId);
    const parentSku = params.parentSku !== undefined ? String(params.parentSku).trim() : null;
    const variants = (parentSku ? all.filter((v) => v.parentSku === parentSku) : all.slice())
      .sort((a, b) => a.sku.localeCompare(b.sku));
    return { ok: true, result: { variants } };
  });

  registerLensAction("retail", "product-variant-delete", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const sku = String(params.sku || "");
    if (!sku) return { ok: false, error: "sku required" };
    const list = ensureRetailBucket(s, "productVariants", userId);
    const idx = list.findIndex((v) => v.sku === sku);
    if (idx < 0) return { ok: false, error: "variant not found" };
    list.splice(idx, 1);
    saveRetailState();
    return { ok: true, result: { sku, deleted: true } };
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

  // ── CRM / sales pipeline — persisted deals (2026-07 Wave-4 unit) ──────────
  //
  // The persisted lead/deal record family the removed fake "Pipeline" tab was
  // standing in for (docs/lens-specs/retail-capability-map.md "Genuinely
  // missing, deferred" #1). Design decisions, documented here because tests pin
  // them:
  //   • Stage enum is a real SMB retail/wholesale CRM funnel:
  //     lead → contacted → qualified → proposal → negotiation → won | lost.
  //     Unknown stages are REJECTED, never coerced.
  //   • probability is a PERCENT (0–100) — the same unit `pipelineValue`'s
  //     pasted-book contract has always used, so persisted deals can feed that
  //     calculator without a unit conversion. When omitted at create it
  //     defaults per stage (HubSpot-style: lead 10 … negotiation 80).
  //   • Every stage change goes through `deals-stage-move` and APPENDS to
  //     `stageHistory` ({from, to, at, note?, reopened?}) — the pipeline is
  //     auditable, not a mutable label. `deals-upsert` therefore REJECTS a
  //     stage change on update instead of silently applying it.
  //   • won/lost are TERMINAL: moving out requires an explicit `reopen: true`
  //     and the target must be an OPEN stage (won→lost directly is rejected —
  //     reopen first, then close the other way; keeps every closure auditable).
  //     Closing forces probability (won→100, lost→0) and stamps `closedAt`;
  //     reopening clears `closedAt` and leaves probability for the owner to
  //     re-estimate.
  //   • `deals-list` returns computed rollups (total open pipeline value,
  //     probability-weighted value, per-stage count/value/weighted, won/lost
  //     totals) — the UI renders ONLY these, never client-invented numbers.
  //     Weighted math matches `pipelineValue` exactly: per-deal
  //     round2(value × probability/100), summed, then round2.
  //   • Relationship to `pipelineValue`: that calculator keeps its pasted-book
  //     behavior byte-identical, and now falls back to READING this persisted
  //     book when no book is pasted (see `dealSource` above) — one math, two
  //     entry points, no silent duplication.

  const DEAL_STAGES = ["lead", "contacted", "qualified", "proposal", "negotiation", "won", "lost"];
  const DEAL_OPEN_STAGES = DEAL_STAGES.slice(0, 5);
  const DEAL_TERMINAL_STAGES = new Set(["won", "lost"]);
  const DEAL_DEFAULT_PROBABILITY = { lead: 10, contacted: 20, qualified: 40, proposal: 60, negotiation: 80, won: 100, lost: 0 };
  const dealRound2 = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
  const dealWeighted = (d) => dealRound2(d.value * (d.probability / 100));

  function validateDealNumbers(params, out) {
    if (params.value !== undefined) {
      const value = Number(params.value);
      if (!Number.isFinite(value) || value < 0) return "value must be a finite number >= 0";
      out.value = dealRound2(value);
    }
    if (params.probability !== undefined) {
      const probability = Number(params.probability);
      if (!Number.isFinite(probability) || probability < 0 || probability > 100) return "probability must be 0–100 (percent)";
      out.probability = dealRound2(probability);
    }
    return null;
  }

  registerLensAction("retail", "deals-list", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const all = ensureRetailBucket(s, "deals", userId);
    const stageFilter = params.stage !== undefined ? String(params.stage) : null;
    if (stageFilter && !DEAL_STAGES.includes(stageFilter)) {
      return { ok: false, error: `unknown stage: ${stageFilter} (expected one of ${DEAL_STAGES.join(", ")})` };
    }

    // Rollups are computed from the FULL book (never the stage filter) so the
    // header numbers stay stable while the user narrows the card list.
    const byStage = {};
    for (const st of DEAL_STAGES) byStage[st] = { count: 0, value: 0, weighted: 0 };
    let totalPipelineValue = 0;   // open deals only
    let weightedPipelineValue = 0;
    let wonValue = 0; let lostValue = 0;
    for (const d of all) {
      const bucket = byStage[d.stage];
      bucket.count++;
      bucket.value = dealRound2(bucket.value + d.value);
      bucket.weighted = dealRound2(bucket.weighted + dealWeighted(d));
      if (DEAL_TERMINAL_STAGES.has(d.stage)) {
        if (d.stage === "won") wonValue += d.value; else lostValue += d.value;
      } else {
        totalPipelineValue += d.value;
        weightedPipelineValue += dealWeighted(d);
      }
    }

    const deals = (stageFilter ? all.filter((d) => d.stage === stageFilter) : all.slice())
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    return {
      ok: true,
      result: {
        deals,
        stages: DEAL_STAGES,
        openStages: DEAL_OPEN_STAGES,
        rollup: {
          totalDeals: all.length,
          openCount: all.length - byStage.won.count - byStage.lost.count,
          totalPipelineValue: dealRound2(totalPipelineValue),
          weightedPipelineValue: dealRound2(weightedPipelineValue),
          wonCount: byStage.won.count,
          wonValue: dealRound2(wonValue),
          lostCount: byStage.lost.count,
          lostValue: dealRound2(lostValue),
          byStage,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "deals-upsert", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const deals = ensureRetailBucket(s, "deals", userId);
    const id = params.id ? String(params.id) : null;

    const numeric = {};
    const numErr = validateDealNumbers(params, numeric);
    if (numErr) return { ok: false, error: numErr };

    if (id) {
      // ── update ──
      const deal = deals.find((d) => d.id === id);
      if (!deal) return { ok: false, error: "deal not found" };
      if (params.stage !== undefined && String(params.stage) !== deal.stage) {
        return { ok: false, error: "stage changes go through deals-stage-move (auditable stageHistory)" };
      }
      if (params.name !== undefined) {
        const name = String(params.name).trim();
        if (!name) return { ok: false, error: "name required" };
        deal.name = name.slice(0, 120);
      }
      if (params.company !== undefined) deal.company = String(params.company).trim().slice(0, 80);
      if (params.contactName !== undefined) deal.contactName = String(params.contactName).trim().slice(0, 80);
      if (params.assignee !== undefined) deal.assignee = String(params.assignee).trim().slice(0, 80);
      if (params.notes !== undefined) deal.notes = String(params.notes).slice(0, 2000);
      if (params.expectedCloseDate !== undefined) deal.expectedCloseDate = params.expectedCloseDate ? String(params.expectedCloseDate) : null;
      if (numeric.value !== undefined) deal.value = numeric.value;
      if (numeric.probability !== undefined) deal.probability = numeric.probability;
      deal.updatedAt = nowIsoRet();
      saveRetailState();
      return { ok: true, result: { deal } };
    }

    // ── create ──
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const stage = params.stage !== undefined ? String(params.stage) : "lead";
    if (!DEAL_STAGES.includes(stage)) {
      return { ok: false, error: `unknown stage: ${stage} (expected one of ${DEAL_STAGES.join(", ")})` };
    }
    const now = nowIsoRet();
    const deal = {
      id: nextRetailId("deal"),
      name: name.slice(0, 120),
      company: String(params.company || "").trim().slice(0, 80),
      contactName: String(params.contactName || "").trim().slice(0, 80),
      assignee: String(params.assignee || "").trim().slice(0, 80),
      notes: String(params.notes || "").slice(0, 2000),
      value: numeric.value !== undefined ? numeric.value : 0,
      probability: numeric.probability !== undefined ? numeric.probability : DEAL_DEFAULT_PROBABILITY[stage],
      stage,
      expectedCloseDate: params.expectedCloseDate ? String(params.expectedCloseDate) : null,
      stageHistory: [{ from: null, to: stage, at: now }],
      closedAt: DEAL_TERMINAL_STAGES.has(stage) ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    deals.push(deal);
    saveRetailState();
    return { ok: true, result: { deal } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "deals-stage-move", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const deal = ensureRetailBucket(s, "deals", userId).find((d) => d.id === id);
    if (!deal) return { ok: false, error: "deal not found" };
    const stage = String(params.stage || "");
    if (!DEAL_STAGES.includes(stage)) {
      return { ok: false, error: `unknown stage: ${stage} (expected one of ${DEAL_STAGES.join(", ")})` };
    }
    if (stage === deal.stage) return { ok: false, error: `deal is already in stage: ${stage}` };

    const reopening = DEAL_TERMINAL_STAGES.has(deal.stage);
    if (reopening) {
      if (params.reopen !== true) {
        return { ok: false, error: `deal is closed (${deal.stage}) — pass reopen: true to move it back into the pipeline` };
      }
      if (DEAL_TERMINAL_STAGES.has(stage)) {
        return { ok: false, error: "a closed deal reopens into an open stage only (won→lost directly is not allowed)" };
      }
    }

    const entry = { from: deal.stage, to: stage, at: nowIsoRet() };
    if (params.note) entry.note = String(params.note).slice(0, 500);
    if (reopening) entry.reopened = true;
    if (!Array.isArray(deal.stageHistory)) deal.stageHistory = [];
    deal.stageHistory.push(entry);

    deal.stage = stage;
    if (stage === "won") { deal.probability = 100; deal.closedAt = entry.at; }
    else if (stage === "lost") { deal.probability = 0; deal.closedAt = entry.at; }
    else deal.closedAt = null;
    deal.updatedAt = entry.at;
    saveRetailState();
    return { ok: true, result: { deal, moved: entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "deals-delete", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const list = ensureRetailBucket(s, "deals", userId);
    const idx = list.findIndex((d) => d.id === id);
    if (idx < 0) return { ok: false, error: "deal not found" };
    list.splice(idx, 1);
    saveRetailState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Support-ticket queue — persisted tickets (2026-07 Wave-4 unit) ────────
  //
  // The persisted ticket record family the removed fake retail "Support"
  // surface was standing in for (docs/lens-specs/retail-capability-map.md
  // "Genuinely missing, deferred" #2: "a persisted ticket queue (subject,
  // priority, SLA deadline, assignee, replies). `slaStatus` computes
  // compliance from pasted incidents but no macro creates or lists a
  // ticket."). Design decisions, documented here because tests pin them —
  // deliberately mirrors the deals-* family's proven shape, diverging only
  // where a support desk's real lifecycle actually differs from a sales
  // funnel:
  //   • `priority` reuses the EXACT 4-name enum + the EXACT per-priority SLA
  //     minutes (`TICKET_PRIORITY_SLA_MINUTES`, declared once at the top of
  //     this file) that `slaStatus`'s live incidents branch already uses —
  //     one number per priority, never a second invented set, so a
  //     persisted ticket's computed deadline and the ad-hoc incidents report
  //     can never silently disagree.
  //   • `status` is a real 5-state support-desk lifecycle: open →
  //     in-progress → waiting-on-customer → resolved → closed. Unlike the
  //     deals funnel (where BOTH won/lost are symmetric locked terminals),
  //     only **closed** is locked here — leaving closed requires an explicit
  //     `reopen: true` (mirrors deals' reopen gate) and clears
  //     closedAt/resolvedAt/resolvedWithinSla (a reopened ticket is, by
  //     definition, unresolved again). **resolved** is a real milestone but
  //     NOT locked — a ticket can move from resolved to any other status
  //     (including straight to closed, or back to an open status because the
  //     fix didn't hold) without the reopen flag, modelling the common
  //     "customer replies to a solved ticket" flow.
  //   • Moving INTO `resolved` (from any status) stamps `resolvedAt` = now
  //     and computes `resolvedWithinSla` = elapsed time <= the priority's SLA
  //     deadline — the one place a ticket's SLA outcome is actually decided.
  //     Moving INTO `closed` directly from an open status (e.g. closed as
  //     duplicate/spam, never formally resolved) leaves `resolvedAt`/
  //     `resolvedWithinSla` at `null` — honestly "not applicable", never a
  //     fabricated true/false.
  //   • Every status change goes through `tickets-status-move` and APPENDS to
  //     `statusHistory` ({from, to, at, note?, reopened?}) — auditable, not a
  //     mutable label. `tickets-upsert` REJECTS a status change on update,
  //     exactly like `deals-upsert` rejects a stage change.
  //   • `replies` is a real thread — `tickets-reply-add` appends
  //     {author, body, at}; nothing about reply content changes ticket
  //     status (no auto-transition magic — every state change stays an
  //     explicit, auditable action).
  //   • `tickets-list` returns computed rollups (open/breached counts,
  //     per-priority breakdown, resolved-in-SLA compliance rate) — the UI
  //     renders ONLY these, never a client-invented number. The "approaching
  //     deadline" threshold (remaining time < 25% of the priority's SLA
  //     window) reuses the exact ratio the legacy `slaStatus` ticket branch
  //     already uses (`remainingHours < slaHours * 0.25`).
  //   • Relationship to `slaStatus`: that calculator's legacy `tickets`
  //     branch (see above) now falls back to READING this persisted queue,
  //     but ONLY on true omission of the `tickets` key — gated the exact
  //     same way as the `pipelineValue` → `deals-*` fallback, so the
  //     pre-existing "malformed pasted payload → empty report, never crash"
  //     contract stays byte-identical (pinned by the pre-existing
  //     `retail-lens-macros.test.js` "a non-array incidents payload falls
  //     through to the legacy ticket branch" case).

  const TICKET_STATUSES = ["open", "in-progress", "waiting-on-customer", "resolved", "closed"];
  const TICKET_OPEN_STATUSES = ["open", "in-progress", "waiting-on-customer"];
  const TICKET_LOCKED_STATUS = "closed";
  const TICKET_PRIORITIES = ["critical", "high", "medium", "low"];
  const TICKET_DEFAULT_PRIORITY = "medium";
  const TICKET_APPROACHING_RATIO = 0.25; // matches slaStatus's legacy `remainingHours < slaHours * 0.25`
  const ticketRound2 = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

  function ticketSlaDeadline(createdAtIso, priority) {
    const targetMinutes = TICKET_PRIORITY_SLA_MINUTES[priority];
    return new Date(new Date(createdAtIso).getTime() + targetMinutes * 60000).toISOString();
  }

  function ticketSlaState(ticket, nowMs) {
    if (ticket.status === TICKET_LOCKED_STATUS) return "closed";
    if (ticket.status === "resolved") {
      if (ticket.resolvedWithinSla === true) return "resolved-on-time";
      if (ticket.resolvedWithinSla === false) return "resolved-late";
      return "resolved";
    }
    const deadlineMs = new Date(ticket.slaDeadline).getTime();
    const targetMinutes = TICKET_PRIORITY_SLA_MINUTES[ticket.priority];
    const windowMs = targetMinutes * 60000;
    const remainingMs = deadlineMs - nowMs;
    if (remainingMs < 0) return "breached";
    if (remainingMs < windowMs * TICKET_APPROACHING_RATIO) return "approaching";
    return "healthy";
  }

  registerLensAction("retail", "tickets-list", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const all = ensureRetailBucket(s, "tickets", userId);

    const statusFilter = params.status !== undefined ? String(params.status) : null;
    if (statusFilter && !TICKET_STATUSES.includes(statusFilter)) {
      return { ok: false, error: `unknown status: ${statusFilter} (expected one of ${TICKET_STATUSES.join(", ")})` };
    }
    const priorityFilter = params.priority !== undefined ? String(params.priority) : null;
    if (priorityFilter && !TICKET_PRIORITIES.includes(priorityFilter)) {
      return { ok: false, error: `unknown priority: ${priorityFilter} (expected one of ${TICKET_PRIORITIES.join(", ")})` };
    }

    const now = Date.now();
    const byPriority = {};
    for (const p of TICKET_PRIORITIES) byPriority[p] = { count: 0, open: 0, breached: 0 };

    // Rollups are computed from the FULL book (never the filters) so the
    // header numbers stay stable while the user narrows the list — same
    // discipline as deals-list.
    let openCount = 0;
    let breachedOpenCount = 0;
    let resolvedCount = 0;
    let metCount = 0;
    const withState = all.map((t) => {
      const slaState = ticketSlaState(t, now);
      const bucket = byPriority[t.priority];
      bucket.count++;
      const isOpen = TICKET_OPEN_STATUSES.includes(t.status);
      if (isOpen) {
        openCount++;
        bucket.open++;
        if (slaState === "breached") { breachedOpenCount++; bucket.breached++; }
      }
      if (t.resolvedWithinSla !== null && t.resolvedWithinSla !== undefined) {
        resolvedCount++;
        if (t.resolvedWithinSla === true) metCount++;
      }
      return { ...t, slaState };
    });

    const complianceRate = resolvedCount > 0 ? ticketRound2((metCount / resolvedCount) * 100) : 100;

    const tickets = (withState
      .filter((t) => (!statusFilter || t.status === statusFilter) && (!priorityFilter || t.priority === priorityFilter)))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    return {
      ok: true,
      result: {
        tickets,
        statuses: TICKET_STATUSES,
        openStatuses: TICKET_OPEN_STATUSES,
        priorities: TICKET_PRIORITIES,
        rollup: {
          totalTickets: all.length,
          openCount,
          breachedOpenCount,
          resolvedCount,
          metCount,
          complianceRate,
          byPriority,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "tickets-upsert", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const tickets = ensureRetailBucket(s, "tickets", userId);
    const id = params.id ? String(params.id) : null;

    if (id) {
      // ── update ──
      const ticket = tickets.find((t) => t.id === id);
      if (!ticket) return { ok: false, error: "ticket not found" };
      if (params.status !== undefined && String(params.status) !== ticket.status) {
        return { ok: false, error: "status changes go through tickets-status-move (auditable statusHistory)" };
      }
      if (params.subject !== undefined) {
        const subject = String(params.subject).trim();
        if (!subject) return { ok: false, error: "subject required" };
        ticket.subject = subject.slice(0, 200);
      }
      if (params.description !== undefined) ticket.description = String(params.description).slice(0, 4000);
      if (params.assignee !== undefined) ticket.assignee = String(params.assignee).trim().slice(0, 80);
      if (params.requester !== undefined) ticket.requester = String(params.requester).trim().slice(0, 80);
      if (params.contactEmail !== undefined) ticket.contactEmail = String(params.contactEmail).trim().slice(0, 120);
      if (params.priority !== undefined) {
        const priority = String(params.priority);
        if (!TICKET_PRIORITIES.includes(priority)) {
          return { ok: false, error: `unknown priority: ${priority} (expected one of ${TICKET_PRIORITIES.join(", ")})` };
        }
        ticket.priority = priority;
        // Re-triage: the SLA clock still starts at ticket creation, only the
        // per-priority target changes.
        ticket.slaDeadline = ticketSlaDeadline(ticket.createdAt, priority);
      }
      ticket.updatedAt = nowIsoRet();
      saveRetailState();
      return { ok: true, result: { ticket } };
    }

    // ── create ──
    const subject = String(params.subject || "").trim();
    if (!subject) return { ok: false, error: "subject required" };
    const priority = params.priority !== undefined ? String(params.priority) : TICKET_DEFAULT_PRIORITY;
    if (!TICKET_PRIORITIES.includes(priority)) {
      return { ok: false, error: `unknown priority: ${priority} (expected one of ${TICKET_PRIORITIES.join(", ")})` };
    }
    const now = nowIsoRet();
    const ticket = {
      id: nextRetailId("tkt"),
      subject: subject.slice(0, 200),
      description: String(params.description || "").slice(0, 4000),
      priority,
      assignee: String(params.assignee || "").trim().slice(0, 80),
      requester: String(params.requester || "").trim().slice(0, 80),
      contactEmail: String(params.contactEmail || "").trim().slice(0, 120),
      status: "open",
      slaTargetMinutes: TICKET_PRIORITY_SLA_MINUTES[priority],
      slaDeadline: ticketSlaDeadline(now, priority),
      statusHistory: [{ from: null, to: "open", at: now }],
      replies: [],
      resolvedAt: null,
      resolvedWithinSla: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    tickets.push(ticket);
    saveRetailState();
    return { ok: true, result: { ticket } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "tickets-status-move", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const ticket = ensureRetailBucket(s, "tickets", userId).find((t) => t.id === id);
    if (!ticket) return { ok: false, error: "ticket not found" };
    const status = String(params.status || "");
    if (!TICKET_STATUSES.includes(status)) {
      return { ok: false, error: `unknown status: ${status} (expected one of ${TICKET_STATUSES.join(", ")})` };
    }
    if (status === ticket.status) return { ok: false, error: `ticket is already in status: ${status}` };

    const reopening = ticket.status === TICKET_LOCKED_STATUS;
    if (reopening) {
      if (params.reopen !== true) {
        return { ok: false, error: "ticket is closed — pass reopen: true to move it back into the queue" };
      }
      if (!TICKET_OPEN_STATUSES.includes(status)) {
        return { ok: false, error: "a closed ticket reopens into an open status only (open/in-progress/waiting-on-customer)" };
      }
    }

    const at = nowIsoRet();
    const entry = { from: ticket.status, to: status, at };
    if (params.note) entry.note = String(params.note).slice(0, 500);
    if (reopening) entry.reopened = true;
    if (!Array.isArray(ticket.statusHistory)) ticket.statusHistory = [];
    ticket.statusHistory.push(entry);

    ticket.status = status;
    if (status === "resolved") {
      ticket.resolvedAt = at;
      ticket.resolvedWithinSla = new Date(at).getTime() <= new Date(ticket.slaDeadline).getTime();
    } else if (status === TICKET_LOCKED_STATUS) {
      ticket.closedAt = at;
      // resolvedAt/resolvedWithinSla are left as-is: a ticket closed straight
      // from an open status (duplicate/spam/won't-fix) was never resolved —
      // they stay null, honestly. A ticket closed after resolved keeps its
      // real resolution stamp.
    } else if (reopening) {
      // Reopening means "not resolved anymore" — clear every closure stamp.
      ticket.closedAt = null;
      ticket.resolvedAt = null;
      ticket.resolvedWithinSla = null;
    }
    ticket.updatedAt = at;
    saveRetailState();
    return { ok: true, result: { ticket, moved: entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "tickets-reply-add", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const ticket = ensureRetailBucket(s, "tickets", userId).find((t) => t.id === id);
    if (!ticket) return { ok: false, error: "ticket not found" };
    const author = String(params.author || "").trim();
    if (!author) return { ok: false, error: "author required" };
    const body = String(params.body || "").trim();
    if (!body) return { ok: false, error: "body required" };
    const reply = { author: author.slice(0, 80), body: body.slice(0, 4000), at: nowIsoRet() };
    if (!Array.isArray(ticket.replies)) ticket.replies = [];
    ticket.replies.push(reply);
    ticket.updatedAt = reply.at;
    saveRetailState();
    return { ok: true, result: { ticket, reply } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "tickets-delete", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const list = ensureRetailBucket(s, "tickets", userId);
    const idx = list.findIndex((t) => t.id === id);
    if (idx < 0) return { ok: false, error: "ticket not found" };
    list.splice(idx, 1);
    saveRetailState();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── In-store marketing displays — persisted display/endcap records (2026-07 Wave-4 unit) ──
  //
  // The persisted display/endcap record family the removed fake retail
  // "Displays" surface was standing in for
  // (docs/lens-specs/retail-capability-map.md "Genuinely missing, deferred"
  // #3: "a persisted display/endcap record (location, budget, impressions,
  // conversions). No macro anywhere."). This is a DISTINCT, PHYSICAL concept
  // from the existing `campaigns-*` family above (digital email/SMS/discount
  // sends) — a real endcap/window/floor display placed at a physical store
  // location, not a channel send. Deliberately mirrors the deals-*/tickets-*
  // families' proven shape, diverging only where a physical merchandising
  // display's real lifecycle actually differs:
  //   • `displayType` is a real retail-merchandising enum (endcap / window /
  //     checkout-counter / floor-display / shelf-talker / promotional-table)
  //     — validated, unknown values rejected.
  //   • `status` is a real 3-state physical lifecycle: planned → active →
  //     removed. `removed` is a locked terminal (mirrors tickets' `closed`)
  //     — leaving it requires an explicit `reopen: true` back into an open
  //     status (planned/active). Every status change goes through
  //     `displays-status-move` and APPENDS to `statusHistory` — auditable,
  //     never a mutable label. `displays-upsert` REJECTS a status change on
  //     update, exactly like deals-upsert/tickets-upsert.
  //   • `productSkus` links a display to the REAL product catalog
  //     (`product-list`/`product-upsert`'s SKUs) rather than a free-text
  //     product name — every SKU listed must already exist in the caller's
  //     catalog, or the whole upsert is rejected. This keeps "what is this
  //     display promoting" honestly tied to real inventory instead of a
  //     hand-typed string nobody validates.
  //   • `impressions` is a MANUALLY LOGGED count, not a fabricated sensor
  //     feed — there is no automated foot-traffic-counting system anywhere
  //     in Concord. `displays-log-impressions` takes a staff-entered count +
  //     optional note and APPENDS to `impressionLog` (a display gets
  //     checked multiple times over its run), accumulating into a running
  //     `impressions` total. The macro name deliberately says "log", not
  //     "track" or "count", so the UI/naming never implies a sensor exists.
  //   • `conversions` follows the EXACT honesty discipline
  //     `campaigns-record-conversion` (above) already established: a
  //     conversion is NEVER a free-floating incremented counter —
  //     `displays-record-conversion` requires a real `orderId` that exists
  //     in the caller's `orders-list` book, rejects an unknown/fake orderId,
  //     and prevents double-attribution of the same order via
  //     `attributedOrderIds` (identical shape to the campaigns family).
  //   • `displays-list` rollups (total impressions/conversions/conversion
  //     rate/attributed revenue, and — since budget is real —
  //     revenue-per-budget-dollar) are computed server-side ONLY, from the
  //     FULL book (never the status filter), so the UI renders nothing a
  //     client could invent. `revenuePerBudgetDollar` is honestly `null`
  //     (never Infinity/NaN) whenever budget is 0, both per-display and in
  //     the aggregate rollup.

  const DISPLAY_TYPES = ["endcap", "window", "checkout-counter", "floor-display", "shelf-talker", "promotional-table"];
  const DISPLAY_STATUSES = ["planned", "active", "removed"];
  const DISPLAY_OPEN_STATUSES = ["planned", "active"];
  const DISPLAY_LOCKED_STATUS = "removed";
  const displayRound2 = (n) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;

  registerLensAction("retail", "displays-list", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const all = ensureRetailBucket(s, "displays", userId);
    const statusFilter = params.status !== undefined ? String(params.status) : null;
    if (statusFilter && !DISPLAY_STATUSES.includes(statusFilter)) {
      return { ok: false, error: `unknown status: ${statusFilter} (expected one of ${DISPLAY_STATUSES.join(", ")})` };
    }

    // Rollups are computed from the FULL book (never the status filter) so
    // the header numbers stay stable while the user narrows the card list —
    // same discipline as deals-list/tickets-list.
    let totalImpressions = 0;
    let totalConversions = 0;
    let totalBudget = 0;
    let totalAttributedRevenue = 0;
    let plannedCount = 0, activeCount = 0, removedCount = 0;
    const withComputed = all.map((d) => {
      totalImpressions += d.impressions;
      totalConversions += d.conversions;
      totalBudget += d.budget;
      totalAttributedRevenue = displayRound2(totalAttributedRevenue + d.attributedRevenue);
      if (d.status === "planned") plannedCount++;
      else if (d.status === "active") activeCount++;
      else removedCount++;
      const conversionRate = d.impressions > 0 ? displayRound2((d.conversions / d.impressions) * 100) : 0;
      const revenuePerBudgetDollar = d.budget > 0 ? displayRound2(d.attributedRevenue / d.budget) : null;
      return { ...d, conversionRate, revenuePerBudgetDollar };
    });

    const displays = (statusFilter ? withComputed.filter((d) => d.status === statusFilter) : withComputed)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    return {
      ok: true,
      result: {
        displays,
        statuses: DISPLAY_STATUSES,
        openStatuses: DISPLAY_OPEN_STATUSES,
        displayTypes: DISPLAY_TYPES,
        rollup: {
          totalDisplays: all.length,
          plannedCount, activeCount, removedCount,
          totalImpressions, totalConversions,
          conversionRate: totalImpressions > 0 ? displayRound2((totalConversions / totalImpressions) * 100) : 0,
          totalBudget: displayRound2(totalBudget),
          totalAttributedRevenue,
          revenuePerBudgetDollar: totalBudget > 0 ? displayRound2(totalAttributedRevenue / totalBudget) : null,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "displays-upsert", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const displays = ensureRetailBucket(s, "displays", userId);
    const id = params.id ? String(params.id) : null;

    // Shared validation for both create + update.
    let budget;
    if (params.budget !== undefined) {
      budget = Number(params.budget);
      if (!Number.isFinite(budget) || budget < 0) return { ok: false, error: "budget must be a finite number >= 0" };
      budget = displayRound2(budget);
    }
    let displayType;
    if (params.displayType !== undefined) {
      displayType = String(params.displayType);
      if (!DISPLAY_TYPES.includes(displayType)) {
        return { ok: false, error: `unknown displayType: ${displayType} (expected one of ${DISPLAY_TYPES.join(", ")})` };
      }
    }
    let startDate;
    if (params.startDate !== undefined) {
      if (params.startDate === null || params.startDate === "") { startDate = null; }
      else {
        const d = new Date(params.startDate);
        if (Number.isNaN(d.getTime())) return { ok: false, error: "invalid startDate" };
        startDate = String(params.startDate);
      }
    }
    let endDate;
    if (params.endDate !== undefined) {
      if (params.endDate === null || params.endDate === "") { endDate = null; }
      else {
        const d = new Date(params.endDate);
        if (Number.isNaN(d.getTime())) return { ok: false, error: "invalid endDate" };
        endDate = String(params.endDate);
      }
    }
    let productSkus;
    if (params.productSkus !== undefined) {
      if (!Array.isArray(params.productSkus)) return { ok: false, error: "productSkus must be an array of SKUs" };
      const catalog = s.products.get(userId);
      const skus = [...new Set(params.productSkus.map((x) => String(x).trim()).filter(Boolean))];
      const missing = skus.filter((sku) => !catalog || !catalog.has(sku));
      if (missing.length > 0) {
        return { ok: false, error: `unknown productSku(s): ${missing.join(", ")} (must exist in your product catalog)` };
      }
      productSkus = skus;
    }

    if (id) {
      // ── update ──
      const display = displays.find((d) => d.id === id);
      if (!display) return { ok: false, error: "display not found" };
      if (params.status !== undefined && String(params.status) !== display.status) {
        return { ok: false, error: "status changes go through displays-status-move (auditable statusHistory)" };
      }
      if (params.location !== undefined) {
        const location = String(params.location).trim();
        if (!location) return { ok: false, error: "location required" };
        display.location = location.slice(0, 160);
      }
      if (displayType !== undefined) display.displayType = displayType;
      if (budget !== undefined) display.budget = budget;
      if (startDate !== undefined) display.startDate = startDate;
      if (endDate !== undefined) display.endDate = endDate;
      const finalStart = startDate !== undefined ? startDate : display.startDate;
      const finalEnd = endDate !== undefined ? endDate : display.endDate;
      if (finalStart && finalEnd && new Date(finalEnd).getTime() < new Date(finalStart).getTime()) {
        return { ok: false, error: "endDate must be on or after startDate" };
      }
      if (productSkus !== undefined) display.productSkus = productSkus;
      if (params.notes !== undefined) display.notes = String(params.notes).slice(0, 2000);
      display.updatedAt = nowIsoRet();
      saveRetailState();
      return { ok: true, result: { display } };
    }

    // ── create ──
    const location = String(params.location || "").trim();
    if (!location) return { ok: false, error: "location required" };
    if (displayType === undefined) {
      return { ok: false, error: `displayType required (expected one of ${DISPLAY_TYPES.join(", ")})` };
    }
    if (startDate && endDate && new Date(endDate).getTime() < new Date(startDate).getTime()) {
      return { ok: false, error: "endDate must be on or after startDate" };
    }
    const now = nowIsoRet();
    const display = {
      id: nextRetailId("disp"),
      location: location.slice(0, 160),
      displayType,
      budget: budget !== undefined ? budget : 0,
      startDate: startDate !== undefined ? startDate : null,
      endDate: endDate !== undefined ? endDate : null,
      productSkus: productSkus !== undefined ? productSkus : [],
      notes: String(params.notes || "").slice(0, 2000),
      status: "planned",
      statusHistory: [{ from: null, to: "planned", at: now }],
      impressions: 0,
      impressionLog: [],
      conversions: 0,
      attributedOrderIds: [],
      attributedRevenue: 0,
      removedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    displays.push(display);
    saveRetailState();
    return { ok: true, result: { display } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "displays-status-move", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const display = ensureRetailBucket(s, "displays", userId).find((d) => d.id === id);
    if (!display) return { ok: false, error: "display not found" };
    const status = String(params.status || "");
    if (!DISPLAY_STATUSES.includes(status)) {
      return { ok: false, error: `unknown status: ${status} (expected one of ${DISPLAY_STATUSES.join(", ")})` };
    }
    if (status === display.status) return { ok: false, error: `display is already in status: ${status}` };

    const reopening = display.status === DISPLAY_LOCKED_STATUS;
    if (reopening) {
      if (params.reopen !== true) {
        return { ok: false, error: "display is removed — pass reopen: true to move it back into planning/active" };
      }
      if (!DISPLAY_OPEN_STATUSES.includes(status)) {
        return { ok: false, error: "a removed display reopens into an open status only (planned/active)" };
      }
    }

    const at = nowIsoRet();
    const entry = { from: display.status, to: status, at };
    if (params.note) entry.note = String(params.note).slice(0, 500);
    if (reopening) entry.reopened = true;
    if (!Array.isArray(display.statusHistory)) display.statusHistory = [];
    display.statusHistory.push(entry);

    display.status = status;
    if (status === DISPLAY_LOCKED_STATUS) display.removedAt = at;
    else if (reopening) display.removedAt = null;
    display.updatedAt = at;
    saveRetailState();
    return { ok: true, result: { display, moved: entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "displays-log-impressions", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    if (!id) return { ok: false, error: "id required" };
    const display = ensureRetailBucket(s, "displays", userId).find((d) => d.id === id);
    if (!display) return { ok: false, error: "display not found" };
    const count = Number(params.count);
    if (!Number.isInteger(count) || count <= 0) return { ok: false, error: "count must be a positive integer" };
    const entry = { count, note: params.note ? String(params.note).slice(0, 500) : "", at: nowIsoRet() };
    if (!Array.isArray(display.impressionLog)) display.impressionLog = [];
    display.impressionLog.push(entry);
    display.impressions = (display.impressions || 0) + count;
    display.updatedAt = entry.at;
    saveRetailState();
    return { ok: true, result: { display, logged: entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Attribute an order's revenue to a display (conversion tracking) — mirrors
  // campaigns-record-conversion exactly: a conversion requires a REAL order.
  registerLensAction("retail", "displays-record-conversion", (ctx, _a, params = {}) => {
  try {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const orderId = String(params.orderId || "");
    if (!id) return { ok: false, error: "id required" };
    if (!orderId) return { ok: false, error: "orderId required" };
    const display = ensureRetailBucket(s, "displays", userId).find((d) => d.id === id);
    if (!display) return { ok: false, error: "display not found" };
    const order = (s.orders.get(userId) || []).find((o) => o.id === orderId);
    if (!order) return { ok: false, error: "order not found" };
    if (!Array.isArray(display.attributedOrderIds)) display.attributedOrderIds = [];
    if (display.attributedOrderIds.includes(orderId)) {
      return { ok: false, error: "order already attributed to this display" };
    }
    display.attributedOrderIds.push(orderId);
    display.conversions = (display.conversions || 0) + 1;
    display.attributedRevenue = displayRound2((display.attributedRevenue || 0) + order.total);
    display.updatedAt = nowIsoRet();
    saveRetailState();
    return { ok: true, result: { display } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("retail", "displays-delete", (ctx, _a, params = {}) => {
    const s = getRetailState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = retailActor(ctx);
    const id = String(params.id || "");
    const list = ensureRetailBucket(s, "displays", userId);
    const idx = list.findIndex((d) => d.id === id);
    if (idx < 0) return { ok: false, error: "display not found" };
    list.splice(idx, 1);
    saveRetailState();
    return { ok: true, result: { id, deleted: true } };
  });
};
