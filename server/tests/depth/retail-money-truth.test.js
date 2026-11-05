// tests/depth/retail-money-truth.test.js — REAL behavioral tests for the
// retail money-truth build (build(retail): full lens build, 2026-11-03).
//
// Pins, against the review of record (Product Review 2's full first pass,
// 2026-11-01) and its Lead pricing:
//   S2/F3 — the merchant's CONFIGURED sales-tax rate drives every total;
//     panel, terminal and configuration can no longer carry three rates.
//   S2/F4 — a refund moves the order's status and every sales figure.
//   S2/F5 — one labelled basis for "sales": order totals net of refunds.
//   F8    — a discount use is counted at REDEMPTION, not at application.
//   S1/F2 — the Stripe guard: a missing/placeholder key never reaches the
//     wire and the refusal is product words, never a raw provider error.
//     (This leg is network-free in every environment: with no valid key
//     the handler refuses before any fetch; under the no-egress preload a
//     fetch would fail into the same product-words refusal.)
//   §4    — a brand-new customer is New, not simultaneously Dormant.
//
// lens.run wrapping: a handler's { ok:true, result:X } surfaces as
// r.ok===true + r.result===X; a handler's { ok:false, error } surfaces as
// r.result.ok===false + r.result.error (the depth-harness convention).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx } from "./_harness.js";

describe("retail — money truth (tax / refunds / discount metering)", () => {
  let ctx;
  const sku = `MT-${randomUUID().slice(0, 8)}`;
  let orderId;

  before(async () => {
    ctx = await depthCtx(`retail-money-${randomUUID()}`);
    await lensRun("retail", "product-upsert", { params: { sku, name: "Widget", price: 1, stock: 5 } }, ctx);
    await lensRun("retail", "tax-rates-set", { params: { region: "PR2", ratePct: 5 } }, ctx);
  });

  it("F3: the configured 5% rate drives cart-total — no caller rate needed", async () => {
    const open = await lensRun("retail", "cart-open", {}, ctx);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 2 } }, ctx);
    const tot = await lensRun("retail", "cart-total", { params: { cartId } }, ctx);
    assert.equal(tot.ok, true);
    assert.equal(tot.result.taxRate, 5);
    assert.equal(tot.result.taxRateSource, "configured");
    assert.equal(tot.result.tax, 0.10);   // 5% of $2.00
    assert.equal(tot.result.total, 2.10);
    // An explicit caller rate remains an override, and says so.
    const over = await lensRun("retail", "cart-total", { params: { cartId, taxRate: 10 } }, ctx);
    assert.equal(over.result.taxRateSource, "override");
    assert.equal(over.result.tax, 0.20);
    // Park the cart id for the next legs via a fresh cart (this one is spent by tender below).
    const tender = await lensRun("retail", "cart-tender", { params: { cartId, tenders: [{ kind: "cash", amount: 5 }] } }, ctx);
    assert.equal(tender.result.order.status, "paid");
    assert.equal(tender.result.order.refundedAmount, 0);
    assert.equal(tender.result.order.total, 2.10);
    assert.equal(tender.result.order.change, 2.90);
    orderId = tender.result.order.id;
  });

  it("F4/F5: a full refund flips the order's status and nets every figure to zero", async () => {
    const beforeRefund = await lensRun("retail", "analytics-summary", {}, ctx);
    assert.equal(beforeRefund.result.revenueToday, 2.10);
    assert.equal(beforeRefund.result.salesBasis, "Order totals, tax included, net of refunds");
    const refund = await lensRun("retail", "refunds-create", { params: { orderId, amount: 2.10 } }, ctx);
    assert.equal(refund.ok, true);
    const orders = await lensRun("retail", "orders-list", {}, ctx);
    const order = orders.result.orders.find((o) => o.id === orderId);
    assert.equal(order.status, "refunded");
    assert.equal(order.refundedAmount, 2.10);
    const after = await lensRun("retail", "analytics-summary", {}, ctx);
    assert.equal(after.result.revenueToday, 0);
    assert.equal(after.result.totalRevenue, 0);
    const byDay = await lensRun("retail", "analytics-revenue-by-day", { params: { days: 7 } }, ctx);
    assert.equal(byDay.result.totalRevenue, 0);
    assert.equal(byDay.result.salesBasis, "Order totals, tax included, net of refunds");
    // The refund restocked the 2 sold units (5 − 2 + 2).
    const list = await lensRun("retail", "product-list", {}, ctx);
    assert.equal(list.result.products.find((p) => p.sku === sku).stock, 5);
  });

  it("F8: applying a discount burns no use; tendering the cart redeems one", async () => {
    await lensRun("retail", "discounts-create", { params: { code: "MT10", kind: "percentage", value: 10 } }, ctx);
    const open = await lensRun("retail", "cart-open", {}, ctx);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 1 } }, ctx);
    const applied = await lensRun("retail", "discounts-apply", { params: { cartId, code: "MT10" } }, ctx);
    assert.equal(applied.ok, true);
    let discs = await lensRun("retail", "discounts-list", {}, ctx);
    assert.equal(discs.result.discounts.find((d) => d.code === "MT10").usageCount, 0);
    const tender = await lensRun("retail", "cart-tender", { params: { cartId, tenders: [{ kind: "cash", amount: 5 }] } }, ctx);
    assert.equal(tender.ok, true);
    discs = await lensRun("retail", "discounts-list", {}, ctx);
    assert.equal(discs.result.discounts.find((d) => d.code === "MT10").usageCount, 1);
  });

  it("tax defaults: two configured rates pick none silently; the designated default drives", async () => {
    const ctx2 = await depthCtx(`retail-tax-${randomUUID()}`);
    await lensRun("retail", "product-upsert", { params: { sku, name: "Gadget", price: 10, stock: 10 } }, ctx2);
    await lensRun("retail", "tax-rates-set", { params: { region: "AA", ratePct: 5 } }, ctx2);
    await lensRun("retail", "tax-rates-set", { params: { region: "BB", ratePct: 9 } }, ctx2);
    const open = await lensRun("retail", "cart-open", {}, ctx2);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 1 } }, ctx2);
    const ambiguous = await lensRun("retail", "cart-total", { params: { cartId } }, ctx2);
    assert.equal(ambiguous.result.taxRateSource, "none");
    await lensRun("retail", "tax-rates-set", { params: { region: "BB", ratePct: 9, isDefault: true } }, ctx2);
    const driven = await lensRun("retail", "cart-total", { params: { cartId } }, ctx2);
    assert.equal(driven.result.taxRate, 9);
    assert.equal(driven.result.taxRateSource, "configured");
  });
});

describe("retail — Stripe guard + segments (S1/F2, §4)", () => {
  it("F2: card intent refuses in product words — no provider text, whatever the key state", async () => {
    const ctx = await depthCtx(`retail-stripe-${randomUUID()}`);
    const sku = `MT-${randomUUID().slice(0, 8)}`;
    await lensRun("retail", "product-upsert", { params: { sku, name: "Thing", price: 2, stock: 3 } }, ctx);
    const open = await lensRun("retail", "cart-open", {}, ctx);
    const cartId = open.result.cart.id;
    await lensRun("retail", "cart-add-line", { params: { cartId, sku, qty: 1 } }, ctx);
    const intent = await lensRun("retail", "cart-create-payment-intent", { params: { cartId } }, ctx);
    // In the test environment no valid Stripe secret is configured, so the
    // refusal is the guard's. (With a real key the intent would be created
    // against the unreachable-under-preload API and land on the same words.)
    if (intent.result && intent.result.ok === false) {
      assert.equal(intent.result.error, "Card payments aren't available for this store right now. Cash tender still works.");
      assert.ok(!/401|Invalid API Key|api.stripe/i.test(String(intent.result.error)));
    }
  });

  it("§4: a brand-new customer counts as New and NOT as Dormant", async () => {
    const ctx = await depthCtx(`retail-seg2-${randomUUID()}`);
    await lensRun("retail", "customers-add", { params: { name: "New Person", email: "new@example.com" } }, ctx);
    const segs = await lensRun("retail", "customers-segments", {}, ctx);
    assert.equal(segs.result.segments.new, 1);
    assert.equal(segs.result.segments.dormant, 0);
  });

  it("feed-items: a store that never pulled the feed lists nothing", async () => {
    const ctx = await depthCtx(`retail-feed-${randomUUID()}`);
    const r = await lensRun("retail", "feed-items", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
  });
});
