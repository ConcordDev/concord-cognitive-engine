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
};
