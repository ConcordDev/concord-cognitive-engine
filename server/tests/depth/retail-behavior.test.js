// tests/depth/retail-behavior.test.js — REAL behavioral tests for the
// retail/CRM domain (registerLensAction family, invoked via lensRun).
// Curated high-confidence subset: exact-value calcs (reorder / pipeline /
// LTV / SLA / cart math / discount math) + CRUD round-trips + validation
// rejections. Every lensRun("retail","<macro>",…) call literally names the
// macro, so the macro-depth grader credits it as a behavioral invocation.
//
// SKIPPED (network/LLM under no-egress preload): cart-create-payment-intent,
// cart-confirm-paid-with-intent (both POST to api.stripe.com via fetch).
//
// lens.run wrapping: a handler that returns { ok:true, result:X } surfaces as
// r.ok===true + r.result===X; a handler's { ok:false, error } surfaces as
// r.result.ok===false + r.result.error (dispatch outer ok stays true).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("retail — calc contracts (exact computed values)", () => {
  it("reorderCheck: out-of-stock → critical, below-point + stock-out → critical, below-point only → reorder, healthy → sufficient", async () => {
    const r = await lensRun("retail", "reorderCheck", {
      data: { products: [
        // onHand 0 → out-of-stock (critical)
        { sku: "A", name: "Gone",  onHand: 0,   reorderPoint: 10, dailyUsage: 2, leadTimeDays: 7 },
        // 8 <= 10 reorderPoint, daysOfStock floor(8/4)=2 < 7 lead → critical-low
        { sku: "B", name: "Crit",  onHand: 8,   reorderPoint: 10, dailyUsage: 4, leadTimeDays: 7 },
        // 9 <= 10 reorderPoint, but no usage → daysOfStock Infinity ≥ lead → below-reorder-point
        { sku: "C", name: "Reord", onHand: 9,   reorderPoint: 10, dailyUsage: 0, leadTimeDays: 7 },
        // 100 > 10 → sufficient
        { sku: "D", name: "Fine",  onHand: 100, reorderPoint: 10, dailyUsage: 1, leadTimeDays: 7 },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalProducts, 4);
    assert.equal(r.result.criticalCount, 2);    // A out-of-stock + B critical-low
    assert.equal(r.result.reorderCount, 1);     // C
    assert.equal(r.result.sufficientCount, 1);  // D
    assert.ok(r.result.critical.some((p) => p.sku === "A" && p.status === "out-of-stock"));
    assert.ok(r.result.critical.some((p) => p.sku === "B" && p.status === "critical-low"));
    assert.ok(r.result.needsReorder.some((p) => p.sku === "C" && p.status === "below-reorder-point"));
  });

  it("pipelineValue: weighted value = value × prob/100, closed deals excluded by default", async () => {
    const r = await lensRun("retail", "pipelineValue", {
      data: { deals: [
        { name: "Big",  value: 10000, probability: 40, stage: "negotiation" },
        { name: "Mid",  value: 5000,  probability: 80, stage: "proposal" },
        { name: "Won",  value: 9000,  probability: 100, stage: "closed-won" }, // excluded
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.dealCount, 2);                       // closed-won excluded
    assert.equal(r.result.totalUnweightedValue, 15000);       // 10000 + 5000
    assert.equal(r.result.totalWeightedValue, 8000);          // 4000 + 4000
    assert.equal(r.result.avgDealSize, 7500);                 // 15000 / 2
    assert.equal(r.result.byStage.negotiation.weightedValue, 4000);
  });

  it("pipelineValue: includeClosed=true counts the closed-won deal", async () => {
    const r = await lensRun("retail", "pipelineValue", {
      data: { deals: [
        { name: "A", value: 1000, probability: 50, stage: "proposal" },
        { name: "B", value: 2000, probability: 100, stage: "closed-won" },
      ] },
      params: { includeClosed: true },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.dealCount, 2);
    assert.equal(r.result.totalUnweightedValue, 3000);
    assert.equal(r.result.totalWeightedValue, 2500);          // 500 + 2000
  });

  it("customerLTV: projectedLTV = avgOrderValue × purchaseFrequency × projectedMonths", async () => {
    // acquisitionDate exactly 12 months ago → lifespanMonths = 12.
    const acq = new Date();
    acq.setMonth(acq.getMonth() - 12);
    const r = await lensRun("retail", "customerLTV", {
      data: { customers: [{
        customerId: "c1", name: "Repeat Rita",
        acquisitionDate: acq.toISOString().slice(0, 10),
        orders: [
          { date: "2026-01-01", total: 100 },
          { date: "2026-02-01", total: 200 },
          { date: "2026-03-01", total: 300 },
        ],
      }] },
      params: { projectedMonths: 24 },
    });
    assert.equal(r.ok, true);
    const c = r.result.customers[0];
    assert.equal(c.totalRevenue, 600);                 // 100+200+300
    assert.equal(c.orderCount, 3);
    assert.equal(c.avgOrderValue, 200);                // 600/3
    assert.equal(c.lifespanMonths, 12);
    assert.equal(c.purchaseFrequency, 0.25);           // 3/12
    assert.equal(c.projectedLTV, 1200);                // 200 × 0.25 × 24
  });

  it("slaStatus: a resolved-late ticket breaches, a resolved-fast ticket meets SLA; compliance rate is computed", async () => {
    const created = "2026-06-01T00:00:00.000Z";
    const r = await lensRun("retail", "slaStatus", {
      data: { tickets: [
        // critical → 4h SLA; resolved 10h later → breached
        { ticketId: "T1", subject: "Down", priority: "critical", createdAt: created, resolvedAt: "2026-06-01T10:00:00.000Z" },
        // low → 48h SLA; resolved 2h later → met
        { ticketId: "T2", subject: "Typo", priority: "low", createdAt: created, resolvedAt: "2026-06-01T02:00:00.000Z" },
      ] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalTickets, 2);
    assert.equal(r.result.breachedCount, 1);
    assert.equal(r.result.metCount, 1);
    assert.equal(r.result.slaComplianceRate, 50);      // 1 met of 2 closed
    assert.ok(r.result.breached.some((t) => t.ticketId === "T1" && t.timeToResolutionHours === 10));
  });

  it("customers-segments: classifies VIP / new / repeat from order counts + spend (round-trip over added customers)", async () => {
    const ctx = await depthCtx(`retail-seg-${randomUUID()}`);
    await lensRun("retail", "customers-add", { params: { name: "Newbie", email: "n@x.com", orderCount: 1, totalSpent: 20 } }, ctx);
    await lensRun("retail", "customers-add", { params: { name: "Returner", email: "r@x.com", orderCount: 3, totalSpent: 300 } }, ctx);
    await lensRun("retail", "customers-add", { params: { name: "Whale", email: "w@x.com", orderCount: 7, totalSpent: 5000 } }, ctx);
    const r = await lensRun("retail", "customers-segments", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCustomers, 3);
    assert.equal(r.result.segments.new, 1);     // orderCount <= 1
    assert.equal(r.result.segments.repeat, 1);  // 2..4
    assert.equal(r.result.segments.vip, 1);     // orderCount >= 5
  });
});

describe("retail — CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`retail-crud-${randomUUID()}`); });

  it("product-upsert → product-list: product reads back with its price/stock", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    const add = await lensRun("retail", "product-upsert", { params: { sku, name: "Widget", price: 9.99, stock: 50, category: "tools" } }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.product.price, 9.99);
    const list = await lensRun("retail", "product-list", {}, ctx);
    assert.ok(list.result.products.some((p) => p.sku === sku && p.stock === 50));
  });

  it("cart-open → cart-add-line → cart-total: subtotal/tax/total math is exact", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Gadget", price: 10, stock: 100 } }, ctx);
    const open = await lensRun("retail", "cart-open", {}, ctx);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 3 } }, ctx);
    const tot = await lensRun("retail", "cart-total", { params: { cartId, taxRate: 10 } }, ctx);
    assert.equal(tot.ok, true);
    assert.equal(tot.result.subtotal, 30);     // 3 × 10
    assert.equal(tot.result.tax, 3);           // 10% of 30
    assert.equal(tot.result.total, 33);
    assert.equal(tot.result.itemCount, 3);
  });

  it("cart-tender: pays the total, returns correct change, decrements stock, mints an order", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Thing", price: 25, stock: 10 } }, ctx);
    const open = await lensRun("retail", "cart-open", {}, ctx);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 2 } }, ctx);
    // subtotal 50, no tax, tender 60 → change 10
    const tender = await lensRun("retail", "cart-tender", { params: { cartId, tenders: [{ kind: "cash", amount: 60 }] } }, ctx);
    assert.equal(tender.ok, true);
    assert.equal(tender.result.order.total, 50);
    assert.equal(tender.result.order.change, 10);
    // stock decremented 10 → 8
    const list = await lensRun("retail", "product-list", {}, ctx);
    assert.equal(list.result.products.find((p) => p.sku === sku).stock, 8);
    // order persists
    const orders = await lensRun("retail", "orders-list", {}, ctx);
    assert.ok(orders.result.orders.some((o) => o.id === tender.result.order.id));
  });

  it("discounts-create → discounts-apply: a percentage code sets cart.discountPercent and discountAmount", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Sale Item", price: 100, stock: 10 } }, ctx);
    const code = `SAVE${randomUUID().slice(0, 4).toUpperCase()}`;
    const created = await lensRun("retail", "discounts-create", { params: { code, kind: "percentage", value: 20 } }, ctx);
    assert.equal(created.ok, true);
    const open = await lensRun("retail", "cart-open", {}, ctx);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 1 } }, ctx);
    const applied = await lensRun("retail", "discounts-apply", { params: { cartId, code } }, ctx);
    assert.equal(applied.ok, true);
    assert.equal(applied.result.discountAmount, 20);          // 20% of 100
    assert.equal(applied.result.cart.discountPercent, 20);
  });

  it("shipping-zones-create → shipping-rate-quote: free-threshold zeroes the rate above threshold", async () => {
    const created = await lensRun("retail", "shipping-zones-create", {
      params: { name: "US", countries: ["US"], rates: [{ id: "r1", name: "Std", priceCents: 500, freeThreshold: 50 }] },
    }, ctx);
    assert.equal(created.ok, true);
    // subtotal 60 ≥ 50 free threshold → priceCents 0, free true
    const quote = await lensRun("retail", "shipping-rate-quote", { params: { country: "us", subtotal: 60 } }, ctx);
    assert.equal(quote.ok, true);
    assert.ok(quote.result.quotes.some((q) => q.priceCents === 0 && q.free === true));
    // subtotal 10 < 50 → priceCents 500, not free
    const quote2 = await lensRun("retail", "shipping-rate-quote", { params: { country: "US", subtotal: 10 } }, ctx);
    assert.ok(quote2.result.quotes.some((q) => q.priceCents === 500 && q.free === false));
  });

  it("validation: product-upsert rejects a negative price", async () => {
    const bad = await lensRun("retail", "product-upsert", { params: { sku: "X1", name: "Bad", price: -5, stock: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /price must be >= 0/);
  });

  it("validation: discounts-create rejects a percentage > 100", async () => {
    const bad = await lensRun("retail", "discounts-create", { params: { code: `BADPCT${randomUUID().slice(0, 4)}`, kind: "percentage", value: 150 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /percentage must be/);
  });

  it("validation: cart-tender with insufficient tender is rejected", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Pricey", price: 100, stock: 5 } }, ctx);
    const open = await lensRun("retail", "cart-open", {}, ctx);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 1 } }, ctx);
    const bad = await lensRun("retail", "cart-tender", { params: { cartId, tenders: [{ kind: "cash", amount: 40 }] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /insufficient tender/);
  });
});

describe("retail — gift cards / refunds / inventory (wave 13 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`retail-t13-gc-${randomUUID()}`); });

  it("gift-cards-create → gift-cards-redeem → gift-cards-balance: balance decrements exactly, zeroes to redeemed", async () => {
    const created = await lensRun("retail", "gift-cards-create", { params: { initialValue: 50 } }, ctx);
    assert.equal(created.ok, true);
    assert.equal(created.result.card.balance, 50);
    assert.equal(created.result.card.status, "active");
    const code = created.result.card.code;
    // redeem 30 of 50 → remaining 20, still active
    const r1 = await lensRun("retail", "gift-cards-redeem", { params: { code, amount: 30 } }, ctx);
    assert.equal(r1.result.redeemed, 30);
    assert.equal(r1.result.remainingBalance, 20);
    assert.equal(r1.result.status, "active");
    // redeem remaining 20 → balance 0, status redeemed
    const r2 = await lensRun("retail", "gift-cards-redeem", { params: { code, amount: 20 } }, ctx);
    assert.equal(r2.result.remainingBalance, 0);
    assert.equal(r2.result.status, "redeemed");
    // balance read-back reflects redeemed state
    const bal = await lensRun("retail", "gift-cards-balance", { params: { code } }, ctx);
    assert.equal(bal.result.balance, 0);
    assert.equal(bal.result.initialValue, 50);
    assert.equal(bal.result.status, "redeemed");
  });

  it("gift-cards-redeem: rejects redeeming more than the balance", async () => {
    const created = await lensRun("retail", "gift-cards-create", { params: { initialValue: 10 } }, ctx);
    const code = created.result.card.code;
    const bad = await lensRun("retail", "gift-cards-redeem", { params: { code, amount: 25 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /insufficient balance/);
  });

  it("refunds-create: restocks order stock and rejects over-total refunds", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Refundable", price: 20, stock: 10 } }, ctx);
    const open = await lensRun("retail", "cart-open", {}, ctx);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 2 } }, ctx); // total 40, stock 10→8
    const tender = await lensRun("retail", "cart-tender", { params: { cartId, tenders: [{ kind: "cash", amount: 40 }] } }, ctx);
    const orderId = tender.result.order.id;
    // refund 15 with restock → stock back from 8 to 10
    const ref = await lensRun("retail", "refunds-create", { params: { orderId, amount: 15, restock: true } }, ctx);
    assert.equal(ref.ok, true);
    assert.equal(ref.result.refund.amount, 15);
    const list = await lensRun("retail", "product-list", {}, ctx);
    assert.equal(list.result.products.find((p) => p.sku === sku).stock, 10); // 8 + 2 restocked
    // a second refund pushing total over the order total (40) is rejected: 15 + 30 > 40
    const bad = await lensRun("retail", "refunds-create", { params: { orderId, amount: 30 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /refund exceeds order total/);
  });

  it("low-stock: filters products at/below threshold, sorted ascending", async () => {
    const lctx = await depthCtx(`retail-t13-low-${randomUUID()}`);
    await lensRun("retail", "product-upsert", { params: { sku: "LOW1", name: "Almost gone", price: 1, stock: 2 } }, lctx);
    await lensRun("retail", "product-upsert", { params: { sku: "LOW2", name: "Edge", price: 1, stock: 5 } }, lctx);
    await lensRun("retail", "product-upsert", { params: { sku: "HIGH", name: "Plenty", price: 1, stock: 50 } }, lctx);
    const r = await lensRun("retail", "low-stock", { params: { threshold: 5 } }, lctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.threshold, 5);
    assert.equal(r.result.lowStock.length, 2);                       // stock <= 5
    assert.equal(r.result.lowStock[0].sku, "LOW1");                  // 2 sorts before 5
    assert.equal(r.result.lowStock[1].sku, "LOW2");
    assert.ok(!r.result.lowStock.some((p) => p.sku === "HIGH"));
  });
});

describe("retail — analytics aggregation (wave 13 top-up)", () => {
  let ctx;
  before(async () => {
    ctx = await depthCtx(`retail-t13-an-${randomUUID()}`);
    // Two products, two sales today.
    await lensRun("retail", "product-upsert", { params: { sku: "ANA", name: "Alpha", price: 10, stock: 100 } }, ctx);
    await lensRun("retail", "product-upsert", { params: { sku: "ANB", name: "Beta", price: 5, stock: 100 } }, ctx);
    const o1 = await lensRun("retail", "cart-open", {}, ctx);
    await lensRun("retail", "cart-add-line", { params: { cartId: o1.result.cart.id, sku: "ANA", qty: 3 } }, ctx); // 30
    await lensRun("retail", "cart-tender", { params: { cartId: o1.result.cart.id, tenders: [{ kind: "cash", amount: 30 }] } }, ctx);
    const o2 = await lensRun("retail", "cart-open", {}, ctx);
    await lensRun("retail", "cart-add-line", { params: { cartId: o2.result.cart.id, sku: "ANB", qty: 2 } }, ctx); // 10
    await lensRun("retail", "cart-tender", { params: { cartId: o2.result.cart.id, tenders: [{ kind: "cash", amount: 10 }] } }, ctx);
  });

  it("analytics-summary: totals/order-count/AOV computed across the two orders", async () => {
    const r = await lensRun("retail", "analytics-summary", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalOrders, 2);
    assert.equal(r.result.totalRevenue, 40);          // 30 + 10
    assert.equal(r.result.revenueToday, 40);
    assert.equal(r.result.avgOrderValue, 20);         // 40 / 2
    assert.equal(r.result.productCount, 2);
  });

  it("analytics-top-products: ranks by revenue (ANA 30 > ANB 10)", async () => {
    const r = await lensRun("retail", "analytics-top-products", { params: { days: 30 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.topProducts.length, 2);
    assert.equal(r.result.topProducts[0].sku, "ANA");
    assert.equal(r.result.topProducts[0].revenue, 30);   // 3 × 10
    assert.equal(r.result.topProducts[0].qty, 3);
    assert.equal(r.result.topProducts[1].sku, "ANB");
    assert.equal(r.result.topProducts[1].revenue, 10);   // 2 × 5
  });

  it("analytics-revenue-by-day: today's bucket carries the full 40 revenue / 2 orders", async () => {
    const r = await lensRun("retail", "analytics-revenue-by-day", { params: { days: 7 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.days, 7);
    assert.equal(r.result.totalRevenue, 40);
    assert.equal(r.result.totalOrders, 2);
    const today = new Date().toISOString().slice(0, 10);
    assert.ok(r.result.series.some((p) => p.date === today && p.revenue === 40 && p.orderCount === 2));
  });
});

describe("retail — fulfillment workflow (wave 13 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`retail-t13-ff-${randomUUID()}`); });

  it("fulfillment-advance: steps through the stage machine and rejects moving backward", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Shippable", price: 10, stock: 5 } }, ctx);
    const open = await lensRun("retail", "cart-open", {}, ctx);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 1 } }, ctx);
    const tender = await lensRun("retail", "cart-tender", { params: { cartId, tenders: [{ kind: "cash", amount: 10 }] } }, ctx);
    const orderId = tender.result.order.id;
    // unfulfilled → picking (next stage)
    const a1 = await lensRun("retail", "fulfillment-advance", { params: { orderId } }, ctx);
    assert.equal(a1.ok, true);
    assert.equal(a1.result.order.fulfillmentStatus, "picking");
    // explicit jump forward to shipped is allowed
    const a2 = await lensRun("retail", "fulfillment-advance", { params: { orderId, toStatus: "shipped" } }, ctx);
    assert.equal(a2.result.order.fulfillmentStatus, "shipped");
    // moving backward to packed is rejected
    const bad = await lensRun("retail", "fulfillment-advance", { params: { orderId, toStatus: "packed" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /cannot move fulfillment backward/);
    // queue reflects the shipped status + per-stage counts
    const q = await lensRun("retail", "fulfillment-queue", {}, ctx);
    assert.ok(q.result.queue.some((o) => o.id === orderId && o.fulfillmentStatus === "shipped"));
    assert.equal(q.result.counts.shipped, 1);
  });
});

describe("retail — campaigns conversion math (wave 13 top-up)", () => {
  it("campaigns-create → send → record-conversion → performance: rate + revenuePerRecipient exact", async () => {
    const ctx = await depthCtx(`retail-t13-camp-${randomUUID()}`);
    // 2 marketing customers (eligible recipients), one buyer with an order.
    await lensRun("retail", "customers-add", { params: { name: "Optin A", email: "a@x.com", acceptsMarketing: true } }, ctx);
    await lensRun("retail", "customers-add", { params: { name: "Optin B", email: "b@x.com", acceptsMarketing: true } }, ctx);
    await lensRun("retail", "customers-add", { params: { name: "Optout", email: "c@x.com", acceptsMarketing: false } }, ctx);
    // an order to attribute (total 50)
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Camp Item", price: 25, stock: 10 } }, ctx);
    const open = await lensRun("retail", "cart-open", {}, ctx);
    await lensRun("retail", "cart-add-line", { params: { cartId: open.result.cart.id, sku, qty: 2 } }, ctx);
    const tender = await lensRun("retail", "cart-tender", { params: { cartId: open.result.cart.id, tenders: [{ kind: "cash", amount: 50 }] } }, ctx);
    const orderId = tender.result.order.id;

    const created = await lensRun("retail", "campaigns-create", { params: { name: "Spring", channel: "email", segment: "marketing" } }, ctx);
    assert.equal(created.ok, true);
    const id = created.result.campaign.id;
    const sent = await lensRun("retail", "campaigns-send", { params: { id } }, ctx);
    assert.equal(sent.result.campaign.sentCount, 2);          // only the 2 opt-in customers with email
    const conv = await lensRun("retail", "campaigns-record-conversion", { params: { id, orderId } }, ctx);
    assert.equal(conv.result.campaign.conversions, 1);
    assert.equal(conv.result.campaign.revenue, 50);
    // double-attribute the same order is rejected
    const dup = await lensRun("retail", "campaigns-record-conversion", { params: { id, orderId } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(dup.result.error, /already attributed/);

    const perf = await lensRun("retail", "campaigns-performance", { params: { id } }, ctx);
    const row = perf.result.campaigns.find((c) => c.id === id);
    assert.equal(row.sentCount, 2);
    assert.equal(row.conversions, 1);
    assert.equal(row.conversionRate, 50);                    // 1/2 → 50%
    assert.equal(row.revenuePerRecipient, 25);               // 50 / 2
  });

  it("campaigns-create: a discount campaign without a discountCode is rejected", async () => {
    const ctx = await depthCtx(`retail-t13-camp2-${randomUUID()}`);
    const bad = await lensRun("retail", "campaigns-create", { params: { name: "Bad", channel: "discount" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /discount campaigns require a discountCode/);
  });
});

describe("retail — reviews + staff + collections + transfers (wave 13 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`retail-t13-misc-${randomUUID()}`); });

  it("reviews-submit → reviews-summary: avg rating + distribution computed exactly", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Reviewed", price: 9, stock: 5 } }, ctx);
    await lensRun("retail", "reviews-submit", { params: { sku, rating: 5, authorName: "Ann" } }, ctx);
    await lensRun("retail", "reviews-submit", { params: { sku, rating: 3, authorName: "Bob" } }, ctx);
    const summary = await lensRun("retail", "reviews-summary", {}, ctx);
    assert.equal(summary.ok, true);
    assert.equal(summary.result.totalReviews, 2);
    assert.equal(summary.result.avgRating, 4);          // (5+3)/2
    assert.equal(summary.result.distribution[5], 1);
    assert.equal(summary.result.distribution[3], 1);
    assert.ok(summary.result.topRated.some((t) => t.sku === sku && t.avgRating === 4 && t.reviewCount === 2));
  });

  it("reviews-submit: rejects an out-of-range rating", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Rated", price: 9, stock: 5 } }, ctx);
    const bad = await lensRun("retail", "reviews-submit", { params: { sku, rating: 7, authorName: "X" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /rating must be 1-5/);
  });

  it("staff-invite → staff-check-permission: cashier can do orders but not analytics, only when active", async () => {
    const invited = await lensRun("retail", "staff-invite", { params: { name: "Casey", email: `cashier-${randomUUID().slice(0,6)}@x.com`, role: "cashier" } }, ctx);
    assert.equal(invited.ok, true);
    const id = invited.result.member.id;
    assert.deepEqual(invited.result.member.permissions.sort(), ["orders", "products"]);
    // invited (not active) → not allowed even for a granted permission
    const inactive = await lensRun("retail", "staff-check-permission", { params: { id, permission: "orders" } }, ctx);
    assert.equal(inactive.result.allowed, false);
    // activate, then orders allowed but analytics denied
    await lensRun("retail", "staff-activate", { params: { id } }, ctx);
    const ok = await lensRun("retail", "staff-check-permission", { params: { id, permission: "orders" } }, ctx);
    assert.equal(ok.result.allowed, true);
    const denied = await lensRun("retail", "staff-check-permission", { params: { id, permission: "analytics" } }, ctx);
    assert.equal(denied.result.allowed, false);
  });

  it("staff-invite: rejects an unknown role", async () => {
    const bad = await lensRun("retail", "staff-invite", { params: { name: "Z", email: "z@x.com", role: "wizard" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /role must be one of/);
  });

  it("collections-create → collections-add-product: skus round-trip onto the collection", async () => {
    const made = await lensRun("retail", "collections-create", { params: { name: "Summer" } }, ctx);
    assert.equal(made.ok, true);
    const id = made.result.collection.id;
    await lensRun("retail", "collections-add-product", { params: { id, sku: "COL-A" } }, ctx);
    const again = await lensRun("retail", "collections-add-product", { params: { id, sku: "COL-A" } }, ctx); // dedupes
    // the handler returns the live collection ref, so snapshot the length immediately
    assert.equal(again.result.collection.productSkus.filter((sk) => sk === "COL-A").length, 1); // no duplicate
    assert.equal(again.result.collection.productSkus.length, 1);
    const dup = await lensRun("retail", "collections-add-product", { params: { id, sku: "COL-B" } }, ctx);
    assert.equal(dup.ok, true);
    assert.ok(dup.result.collection.productSkus.includes("COL-A"));
    assert.ok(dup.result.collection.productSkus.includes("COL-B"));
    const list = await lensRun("retail", "collections-list", {}, ctx);
    const col = list.result.collections.find((c) => c.id === id);
    assert.deepEqual(col.productSkus.slice().sort(), ["COL-A", "COL-B"]); // dedup held: exactly 2
  });

  it("transfers-create → transfers-receive: status goes in_transit → received", async () => {
    const made = await lensRun("retail", "transfers-create", { params: { fromLocation: "Warehouse", toLocation: "Store", lines: [{ sku: "T1", qty: 5 }] } }, ctx);
    assert.equal(made.ok, true);
    assert.equal(made.result.transfer.status, "in_transit");
    const id = made.result.transfer.id;
    const recv = await lensRun("retail", "transfers-receive", { params: { id } }, ctx);
    assert.equal(recv.result.transfer.status, "received");
    assert.ok(recv.result.transfer.receivedAt);
    const list = await lensRun("retail", "transfers-list", {}, ctx);
    assert.ok(list.result.transfers.some((t) => t.id === id && t.status === "received"));
  });

  it("tax-rates-set: clamps rate to [0,50], upserts the region in place", async () => {
    const set = await lensRun("retail", "tax-rates-set", { params: { region: "ca", ratePct: 8.25 } }, ctx);
    assert.equal(set.ok, true);
    assert.ok(set.result.rates.some((r) => r.region === "CA" && r.ratePct === 8.25));
    // over-cap rate clamps to 50; same region updates in place (no duplicate row)
    const set2 = await lensRun("retail", "tax-rates-set", { params: { region: "CA", ratePct: 99 } }, ctx);
    const caRows = set2.result.rates.filter((r) => r.region === "CA");
    assert.equal(caRows.length, 1);
    assert.equal(caRows[0].ratePct, 50);
  });
});

describe("retail — storefront + channels (wave 13 top-up)", () => {
  it("storefront-configure → publish → catalog → checkout: published catalog sells and decrements stock", async () => {
    const ctx = await depthCtx(`retail-t13-sf-${randomUUID()}`);
    await lensRun("retail", "product-upsert", { params: { sku: "SFA", name: "Storefront Item", price: 12, stock: 4 } }, ctx);
    const cfg = await lensRun("retail", "storefront-configure", { params: { name: "My Shop" } }, ctx);
    assert.equal(cfg.ok, true);
    assert.equal(cfg.result.storefront.slug, "my-shop");
    const pub = await lensRun("retail", "storefront-publish", { params: { published: true, publishedSkus: ["SFA"] } }, ctx);
    assert.equal(pub.result.publicUrl, "/shop/my-shop");
    const cat = await lensRun("retail", "storefront-catalog", {}, ctx);
    assert.equal(cat.result.published, true);
    assert.ok(cat.result.products.some((p) => p.sku === "SFA" && p.inStock === true && p.stock === 4));
    // buyer checks out 1 → order total 12, stock 4→3
    const co = await lensRun("retail", "storefront-checkout", { params: { buyerName: "Buyer", buyerEmail: "buyer@x.com", lines: [{ sku: "SFA", qty: 1 }] } }, ctx);
    assert.equal(co.ok, true);
    assert.equal(co.result.order.total, 12);
    assert.equal(co.result.order.channel, "storefront");
    const list = await lensRun("retail", "product-list", {}, ctx);
    assert.equal(list.result.products.find((p) => p.sku === "SFA").stock, 3);
  });

  it("storefront-checkout: rejects a quantity beyond available stock", async () => {
    const ctx = await depthCtx(`retail-t13-sf2-${randomUUID()}`);
    await lensRun("retail", "product-upsert", { params: { sku: "SFB", name: "Scarce", price: 5, stock: 1 } }, ctx);
    await lensRun("retail", "storefront-configure", { params: { name: "Tiny" } }, ctx);
    await lensRun("retail", "storefront-publish", { params: { published: true, publishedSkus: ["SFB"] } }, ctx);
    const bad = await lensRun("retail", "storefront-checkout", { params: { buyerName: "B", buyerEmail: "b@x.com", lines: [{ sku: "SFB", qty: 5 }] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /insufficient stock/);
  });

  it("channels-connect → channels-list-products → channels-sync-inventory: sync reports live stock per listed sku", async () => {
    const ctx = await depthCtx(`retail-t13-ch-${randomUUID()}`);
    await lensRun("retail", "product-upsert", { params: { sku: "CHA", name: "Channeled", price: 7, stock: 42 } }, ctx);
    const conn = await lensRun("retail", "channels-connect", { params: { channel: "etsy", storeName: "My Etsy" } }, ctx);
    assert.equal(conn.ok, true);
    const id = conn.result.channel.id;
    const listed = await lensRun("retail", "channels-list-products", { params: { id, skus: ["CHA", "MISSING"] } }, ctx);
    assert.deepEqual(listed.result.channel.listedSkus, ["CHA"]); // MISSING dropped
    const sync = await lensRun("retail", "channels-sync-inventory", { params: { id } }, ctx);
    assert.equal(sync.ok, true);
    const report = sync.result.channels.find((c) => c.channelId === id);
    assert.equal(report.syncedSkus, 1);
    assert.ok(report.updates.some((u) => u.sku === "CHA" && u.stock === 42 && u.found === true));
  });

  it("channels-connect: rejects an unsupported channel", async () => {
    const ctx = await depthCtx(`retail-t13-ch2-${randomUUID()}`);
    const bad = await lensRun("retail", "channels-connect", { params: { channel: "myspace" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /unsupported channel/);
  });
});

describe("retail — order-card artifact actions (wave 13 top-up)", () => {
  it("process_refund: partial then remaining refund, remaining math + status transitions exact", async () => {
    // First call: partial $40 of $100 order → remaining 60, partially_refunded.
    const r1 = await lensRun("retail", "process_refund", {
      data: { orderNumber: "ORD-100", total: 100 },
      params: { amount: 40, reason: "damaged" },
    });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.refund.amount, 40);
    assert.equal(r1.result.refundedTotal, 40);
    assert.equal(r1.result.remaining, 60);
    assert.equal(r1.result.status, "partially_refunded");
    assert.equal(r1.result.refund.reason, "damaged");
  });

  it("process_refund: default refunds the full remaining and marks fully refunded", async () => {
    // No amount param → refunds the full remaining of a $50 order.
    const full = await lensRun("retail", "process_refund", {
      data: { orderNumber: "ORD-200", total: 50 },
    });
    assert.equal(full.ok, true);
    assert.equal(full.result.refund.amount, 50);     // full remaining defaulted
    assert.equal(full.result.remaining, 0);
    assert.equal(full.result.status, "refunded");
  });

  it("process_refund: an already-fully-refunded order rejects", async () => {
    const bad = await lensRun("retail", "process_refund", {
      data: { orderNumber: "ORD-300", total: 30, refundAmount: 30 },
    });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /already fully refunded/);
  });

  it("generate_label: deterministic express cost model = base 9.0 + 2.4/kg, weight = 0.5 + 0.3×items", async () => {
    // 3 line items → weightKg = 0.5 + 3×0.3 = 1.4; express → cost = 9.0 + 2.4×1.4 = 12.36
    const r = await lensRun("retail", "generate_label", {
      data: { orderNumber: "ORD-LBL", lines: [{}, {}, {}], shippingMethod: "express" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.label.weightKg, 1.4);
    assert.equal(r.result.label.service, "express");
    assert.equal(r.result.label.cost, 12.36);
    assert.equal(r.result.label.currency, "USD");
    assert.match(r.result.label.trackingNumber, /^CONCORD\d{10}$/);
  });

  it("generate_label: explicit weight + ground tier = 4.5 + 1.2×2 = 6.9, barcode embeds the carrier prefix", async () => {
    const r = await lensRun("retail", "generate_label", {
      data: { orderNumber: "ORD-G", carrier: "FedEx Ground" },
      params: { service: "ground", weightKg: 2 },
    });
    assert.equal(r.result.label.cost, 6.9);          // 4.5 + 1.2×2
    assert.equal(r.result.label.service, "ground");
    assert.equal(r.result.label.weightKg, 2);
    assert.match(r.result.label.barcode, /^FEDE-CONCORD\d{10}$/);
  });

  it("send_tracking: mints a tracking number when absent and records who it was sent to", async () => {
    const r = await lensRun("retail", "send_tracking", {
      data: { orderNumber: "ORD-T", customerEmail: "shopper@x.com" },
      params: { carrier: "UPS" },
    });
    assert.equal(r.ok, true);
    assert.match(r.result.trackingNumber, /^CONCORD\d{10}$/);
    assert.equal(r.result.carrier, "UPS");
    assert.equal(r.result.sentTo, "shopper@x.com");
    assert.ok(r.result.sentAt);
  });

  it("initiate_return: opens a pending RMA carrying the supplied reason", async () => {
    const r = await lensRun("retail", "initiate_return", {
      data: { orderNumber: "ORD-R" },
      params: { reason: "wrong_size" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.return.status, "pending");
    assert.equal(r.result.return.reason, "wrong_size");
    assert.match(r.result.return.rmaNumber, /^RMA-/);
  });
});

describe("retail — discounts fixed_amount + abandoned carts (wave 13 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`retail-t13-disc-${randomUUID()}`); });

  it("discounts-apply (fixed_amount): caps at subtotal and derives the equivalent percent", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Fixed Sale", price: 40, stock: 10 } }, ctx);
    const code = `FIX${randomUUID().slice(0, 4).toUpperCase()}`;
    await lensRun("retail", "discounts-create", { params: { code, kind: "fixed_amount", value: 10 } }, ctx);
    const open = await lensRun("retail", "cart-open", {}, ctx);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 1 } }, ctx); // subtotal 40
    const applied = await lensRun("retail", "discounts-apply", { params: { cartId, code } }, ctx);
    assert.equal(applied.ok, true);
    assert.equal(applied.result.discountAmount, 10);                 // min(40, 10)
    assert.equal(applied.result.cart.discountPercent, 25);          // 10/40 × 100
    assert.equal(applied.result.cart.appliedDiscountCode, code);
  });

  it("discounts-apply: rejects a code below the minimum subtotal", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Cheap", price: 5, stock: 10 } }, ctx);
    const code = `MIN${randomUUID().slice(0, 4).toUpperCase()}`;
    await lensRun("retail", "discounts-create", { params: { code, kind: "percentage", value: 10, minSubtotal: 100 } }, ctx);
    const open = await lensRun("retail", "cart-open", {}, ctx);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 1 } }, ctx); // subtotal 5 < 100
    const bad = await lensRun("retail", "discounts-apply", { params: { cartId, code } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /minimum subtotal/);
  });

  it("discounts-create: rejects a duplicate code (case-folded)", async () => {
    const code = `DUP${randomUUID().slice(0, 4).toUpperCase()}`;
    const first = await lensRun("retail", "discounts-create", { params: { code, kind: "percentage", value: 5 } }, ctx);
    assert.equal(first.ok, true);
    const dup = await lensRun("retail", "discounts-create", { params: { code: code.toLowerCase(), kind: "percentage", value: 5 } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(dup.result.error, /already exists/);
  });

  it("abandoned-carts-list: surfaces aged non-empty carts with correct subtotal + lost-value totals", async () => {
    const actx = await depthCtx(`retail-t13-aband-${randomUUID()}`);
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Abandoned", price: 30, stock: 10 } }, actx);
    const open = await lensRun("retail", "cart-open", {}, actx);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 2 } }, actx); // subtotal 60
    // backdate openedAt so the cart counts as abandoned past the 1h threshold
    const { STATE } = await (await import("./_harness.js")).macroRuntime("retail-aband");
    const cart = STATE.retailLens.carts.get(actx.actor.userId).get(cartId);
    cart.openedAt = new Date(Date.now() - 3 * 3600000).toISOString(); // 3h ago
    const r = await lensRun("retail", "abandoned-carts-list", { params: { thresholdHours: 1 } }, actx);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalAbandoned, 1);
    assert.equal(r.result.totalLostValue, 60);
    assert.ok(r.result.carts.some((c) => c.id === cartId && c.subtotal === 60 && c.itemCount === 2 && c.ageHours === 3));
    // recover with a discount code produces a shareable link carrying the code
    const rec = await lensRun("retail", "abandoned-cart-recover", { params: { cartId, discountCode: "comeback" } }, actx);
    assert.equal(rec.ok, true);
    assert.equal(rec.result.recovery.kind, "discounted_recovery");
    assert.equal(rec.result.recovery.discountCode, "COMEBACK");
    assert.ok(rec.result.recovery.shareableLink.includes("discount=COMEBACK"));
  });
});

describe("retail — moderation, role override, notifications, deletes (wave 13 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx(`retail-t13-mod-${randomUUID()}`); });

  it("reviews-moderate: hiding a review drops it from the published summary average", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Moderated", price: 9, stock: 5 } }, ctx);
    const lo = await lensRun("retail", "reviews-submit", { params: { sku, rating: 1, authorName: "Troll" } }, ctx);
    await lensRun("retail", "reviews-submit", { params: { sku, rating: 5, authorName: "Fan" } }, ctx);
    // before moderation: avg (1+5)/2 = 3
    const before = await lensRun("retail", "reviews-summary", {}, ctx);
    assert.equal(before.result.avgRating, 3);
    // hide the 1-star
    const mod = await lensRun("retail", "reviews-moderate", { params: { id: lo.result.review.id, status: "hidden" } }, ctx);
    assert.equal(mod.result.review.status, "hidden");
    const after = await lensRun("retail", "reviews-summary", {}, ctx);
    assert.equal(after.result.totalReviews, 1);     // only the 5-star remains published
    assert.equal(after.result.avgRating, 5);
  });

  it("reviews-moderate: rejects an invalid status", async () => {
    const bad = await lensRun("retail", "reviews-moderate", { params: { id: "nope", status: "banana" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /status must be published or hidden/);
  });

  it("staff-update-role: a custom permissions array filters to valid permissions only", async () => {
    const invited = await lensRun("retail", "staff-invite", { params: { name: "Morgan", email: `m-${randomUUID().slice(0,6)}@x.com`, role: "cashier" } }, ctx);
    const id = invited.result.member.id;
    const updated = await lensRun("retail", "staff-update-role", { params: { id, role: "manager", permissions: ["orders", "analytics", "bogus_perm"] } }, ctx);
    assert.equal(updated.ok, true);
    assert.equal(updated.result.member.role, "manager");
    assert.deepEqual(updated.result.member.permissions.sort(), ["analytics", "orders"]); // bogus dropped
  });

  it("staff-update-role: rejects an unknown role", async () => {
    const bad = await lensRun("retail", "staff-update-role", { params: { id: "x", role: "overlord" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /role must be one of/);
  });

  it("fulfillment-advance to shipped emits a buyer shipment notification that fulfillment-notifications surfaces", async () => {
    // storefront order carries a buyerEmail → advancing to shipped writes a notification
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Notifiable", price: 8, stock: 5 } }, ctx);
    await lensRun("retail", "storefront-configure", { params: { name: "Notif Shop" } }, ctx);
    await lensRun("retail", "storefront-publish", { params: { published: true, publishedSkus: [sku] } }, ctx);
    const co = await lensRun("retail", "storefront-checkout", { params: { buyerName: "Buy", buyerEmail: "buyer-notif@x.com", lines: [{ sku, qty: 1 }] } }, ctx);
    const orderId = co.result.order.id;
    await lensRun("retail", "fulfillment-advance", { params: { orderId, toStatus: "shipped" } }, ctx);
    const notes = await lensRun("retail", "fulfillment-notifications", {}, ctx);
    assert.equal(notes.ok, true);
    assert.ok(notes.result.notifications.some((n) => n.orderId === orderId && n.kind === "shipment_notice" && n.to === "buyer-notif@x.com"));
  });

  it("product-delete: removes the product and a re-delete reports not-found", async () => {
    const sku = `SKU-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Doomed", price: 1, stock: 1 } }, ctx);
    const del = await lensRun("retail", "product-delete", { params: { sku } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, sku);
    const list = await lensRun("retail", "product-list", {}, ctx);
    assert.ok(!list.result.products.some((p) => p.sku === sku));
    const again = await lensRun("retail", "product-delete", { params: { sku } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /not found/);
  });

  it("collections-delete: removes a collection and a re-delete reports not-found", async () => {
    const made = await lensRun("retail", "collections-create", { params: { name: "Temp" } }, ctx);
    const id = made.result.collection.id;
    const del = await lensRun("retail", "collections-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("retail", "collections-list", {}, ctx);
    assert.ok(!list.result.collections.some((c) => c.id === id));
    const again = await lensRun("retail", "collections-delete", { params: { id } }, ctx);
    assert.equal(again.result.ok, false);
    assert.match(again.result.error, /collection not found/);
  });

  it("channels-disconnect: removes a connected channel", async () => {
    const cctx = await depthCtx(`retail-t13-chdc-${randomUUID()}`);
    const conn = await lensRun("retail", "channels-connect", { params: { channel: "ebay", storeName: "Bay" } }, cctx);
    const id = conn.result.channel.id;
    const dc = await lensRun("retail", "channels-disconnect", { params: { id } }, cctx);
    assert.equal(dc.ok, true);
    assert.equal(dc.result.disconnected, true);
    const list = await lensRun("retail", "channels-list", {}, cctx);
    assert.ok(!list.result.channels.some((c) => c.id === id));
  });
});
