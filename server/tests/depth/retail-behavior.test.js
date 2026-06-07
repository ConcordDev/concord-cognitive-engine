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
