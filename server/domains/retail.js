// server/domains/retail.js
// Domain actions for retail/CRM: reorder, pipeline, LTV, SLA checks.

export default function registerRetailActions(registerLensAction) {
  /**
   * reorderCheck
   * Flag products that have fallen below their reorder point.
   * artifact.data.products: [{ sku, name, onHand, reorderPoint, reorderQty, leadTimeDays, dailyUsage }]
   */
  registerLensAction("retail", "reorderCheck", (ctx, artifact, _params) => {
    const products = artifact.data.products || artifact.data.inventory || [];

    const needsReorder = [];
    const critical = [];
    const sufficient = [];

    for (const product of products) {
      const onHand = parseFloat(product.onHand) || 0;
      const reorderPoint = parseFloat(product.reorderPoint) || 0;
      const dailyUsage = parseFloat(product.dailyUsage) || 0;
      const leadTimeDays = parseFloat(product.leadTimeDays) || 7;
      const daysOfStock = dailyUsage > 0 ? Math.floor(onHand / dailyUsage) : Infinity;
      const willStockOutBeforeDelivery = daysOfStock < leadTimeDays;

      const entry = {
        sku: product.sku,
        name: product.name,
        onHand,
        reorderPoint,
        reorderQty: product.reorderQty || 0,
        daysOfStock: daysOfStock === Infinity ? "N/A" : daysOfStock,
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
  });

  /**
   * pipelineValue
   * Calculate weighted pipeline value from deals/opportunities.
   * artifact.data.deals: [{ name, value, probability, stage, expectedCloseDate }]
   */
  registerLensAction("retail", "pipelineValue", (ctx, artifact, params) => {
    const deals = artifact.data.deals || artifact.data.opportunities || [];
    const includeClosed = params.includeClosed || false;

    const activeDealsList = includeClosed
      ? deals
      : deals.filter((d) => d.stage !== "closed-won" && d.stage !== "closed-lost");

    let totalUnweighted = 0;
    let totalWeighted = 0;

    const byStage = {};

    const detailed = activeDealsList.map((deal) => {
      const value = parseFloat(deal.value) || 0;
      const probability = parseFloat(deal.probability) || 0;
      const weighted = Math.round(value * (probability / 100) * 100) / 100;
      const stage = deal.stage || "unknown";

      totalUnweighted += value;
      totalWeighted += weighted;

      if (!byStage[stage]) {
        byStage[stage] = { count: 0, totalValue: 0, weightedValue: 0 };
      }
      byStage[stage].count++;
      byStage[stage].totalValue = Math.round((byStage[stage].totalValue + value) * 100) / 100;
      byStage[stage].weightedValue = Math.round((byStage[stage].weightedValue + weighted) * 100) / 100;

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
      return close >= now && close <= monthEnd;
    });

    const result = {
      generatedAt: new Date().toISOString(),
      dealCount: activeDealsList.length,
      totalUnweightedValue: Math.round(totalUnweighted * 100) / 100,
      totalWeightedValue: Math.round(totalWeighted * 100) / 100,
      avgDealSize: activeDealsList.length > 0 ? Math.round((totalUnweighted / activeDealsList.length) * 100) / 100 : 0,
      byStage,
      closingThisMonth: {
        count: closingThisMonth.length,
        weightedValue: Math.round(closingThisMonth.reduce((s, d) => s + d.weightedValue, 0) * 100) / 100,
      },
    };

    artifact.data.pipelineReport = result;

    return { ok: true, result };
  });

  /**
   * customerLTV
   * Compute lifetime value from order history.
   * artifact.data.customers: [{ customerId, name, orders: [{ date, total }], acquisitionDate }]
   * params.customerId — compute for one customer (or all if omitted)
   */
  registerLensAction("retail", "customerLTV", (ctx, artifact, params) => {
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
  });

  /**
   * slaStatus
   * Check support tickets against SLA deadlines.
   * artifact.data.tickets: [{ ticketId, subject, priority, createdAt, resolvedAt, slaHours }]
   * params.defaultSlaHours — default SLA if not per-ticket (default 24)
   */
  registerLensAction("retail", "slaStatus", (ctx, artifact, params) => {
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
  });
};
