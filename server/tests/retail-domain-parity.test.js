import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerActions from "../domains/retail.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`retail.${name}`);
  if (!fn) throw new Error(`retail.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "u" }, userId: "u" };
const ctxB = { actor: { userId: "v" }, userId: "v" };

describe("retail — product catalog", () => {
  it("upsert + list", () => {
    call("product-upsert", ctxA, { sku: "ABC123", name: "Widget", price: 9.99, stock: 50 });
    const r = call("product-list", ctxA);
    assert.equal(r.result.products.length, 1);
    assert.equal(r.result.products[0].sku, "ABC123");
  });

  it("INVARIANT: products scoped per-user", () => {
    call("product-upsert", ctxA, { sku: "X", name: "a-only", price: 1, stock: 1 });
    const b = call("product-list", ctxB);
    assert.equal(b.result.products.length, 0);
  });

  it("rejects negative price", () => {
    const r = call("product-upsert", ctxA, { sku: "X", name: "x", price: -1, stock: 0 });
    assert.equal(r.ok, false);
  });

  it("delete removes", () => {
    call("product-upsert", ctxA, { sku: "X", name: "x", price: 1, stock: 1 });
    call("product-delete", ctxA, { sku: "X" });
    assert.equal(call("product-list", ctxA).result.products.length, 0);
  });
});

describe("retail — POS flow", () => {
  beforeEach(() => {
    call("product-upsert", ctxA, { sku: "WIDGET", name: "Widget", price: 10, stock: 5 });
    call("product-upsert", ctxA, { sku: "GADGET", name: "Gadget", price: 25, stock: 3 });
  });

  it("open cart, add line, total, tender", () => {
    const c = call("cart-open", ctxA);
    const cartId = c.result.cart.id;
    call("cart-add-line", ctxA, { cartId, sku: "WIDGET", qty: 2 });
    call("cart-add-line", ctxA, { cartId, sku: "GADGET", qty: 1 });
    const total = call("cart-total", ctxA, { cartId, taxRate: 10 });
    // subtotal = 20+25 = 45, tax 10% = 4.5, total = 49.5
    assert.equal(total.result.subtotal, 45);
    assert.equal(total.result.tax, 4.5);
    assert.equal(total.result.total, 49.5);
    const tender = call("cart-tender", ctxA, { cartId, taxRate: 10, tenders: [{ kind: "cash", amount: 50 }] });
    assert.equal(tender.ok, true);
    assert.equal(tender.result.order.change, 0.5);
  });

  it("rejects insufficient tender", () => {
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "WIDGET", qty: 1 });
    const r = call("cart-tender", ctxA, { cartId: c.result.cart.id, tenders: [{ kind: "cash", amount: 5 }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /insufficient/);
  });

  it("rejects unknown product", () => {
    const c = call("cart-open", ctxA);
    const r = call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "BOGUS", qty: 1 });
    assert.equal(r.ok, false);
  });

  it("rejects empty cart tender", () => {
    const c = call("cart-open", ctxA);
    const r = call("cart-tender", ctxA, { cartId: c.result.cart.id, tenders: [{ kind: "cash", amount: 100 }] });
    assert.equal(r.ok, false);
    assert.match(r.error, /empty/);
  });

  it("decrements stock on tender", () => {
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "WIDGET", qty: 3 });
    call("cart-tender", ctxA, { cartId: c.result.cart.id, tenders: [{ kind: "cash", amount: 100 }] });
    const list = call("product-list", ctxA);
    const widget = list.result.products.find((p) => p.sku === "WIDGET");
    assert.equal(widget.stock, 2); // started at 5, sold 3
  });
});

describe("retail — orders + low stock", () => {
  it("orders-list returns completed orders", () => {
    call("product-upsert", ctxA, { sku: "X", name: "x", price: 5, stock: 10 });
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "X", qty: 1 });
    call("cart-tender", ctxA, { cartId: c.result.cart.id, tenders: [{ kind: "cash", amount: 10 }] });
    const r = call("orders-list", ctxA);
    assert.equal(r.result.orders.length, 1);
  });

  it("low-stock returns items below threshold", () => {
    call("product-upsert", ctxA, { sku: "LOW", name: "low", price: 1, stock: 2 });
    call("product-upsert", ctxA, { sku: "HIGH", name: "high", price: 1, stock: 100 });
    const r = call("low-stock", ctxA, { threshold: 5 });
    assert.equal(r.result.lowStock.length, 1);
    assert.equal(r.result.lowStock[0].sku, "LOW");
  });
});

describe("retail — Stripe PaymentIntent POS (real card tender)", () => {
  it("cart-create-payment-intent returns error pointing to STRIPE_SECRET_KEY when not set", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    call("product-upsert", ctxA, { sku: "P1", name: "x", price: 10, stock: 5 });
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "P1", qty: 1 });
    const r = await call("cart-create-payment-intent", ctxA, { cartId: c.result.cart.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /STRIPE_SECRET_KEY|Stripe not configured/);
  });

  it("cart-create-payment-intent rejects amount below Stripe minimum ($0.50)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    call("product-upsert", ctxA, { sku: "P1", name: "x", price: 0.10, stock: 5 });
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "P1", qty: 1 });
    const r = await call("cart-create-payment-intent", ctxA, { cartId: c.result.cart.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /below Stripe minimum/);
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("cart-create-payment-intent POSTs to Stripe + returns clientSecret + stashes pending id", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    const calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push({ url, body: opts?.body });
      return { ok: true, json: async () => ({ id: "pi_test123", client_secret: "pi_test123_secret_abc", status: "requires_payment_method", amount: 1100 }) };
    };
    call("product-upsert", ctxA, { sku: "P1", name: "x", price: 10, stock: 5 });
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "P1", qty: 1 });
    const r = await call("cart-create-payment-intent", ctxA, { cartId: c.result.cart.id, taxRate: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.result.clientSecret, "pi_test123_secret_abc");
    assert.equal(r.result.paymentIntentId, "pi_test123");
    assert.equal(r.result.total, 11);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/payment_intents/);
    assert.match(calls[0].body, /amount=1100/);
    assert.match(calls[0].body, /currency=usd/);
    assert.match(calls[0].body, /metadata%5Bconcord_user_id%5D=u/);
    // Pending intent persisted on cart
    const cart = globalThis._concordSTATE.retailLens.carts.get("u").get(c.result.cart.id);
    assert.equal(cart.pendingPaymentIntentId, "pi_test123");
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("cart-create-payment-intent with terminal:true requests manual capture + card_present", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    let capturedBody = "";
    globalThis.fetch = async (_url, opts) => {
      capturedBody = opts?.body || "";
      return { ok: true, json: async () => ({ id: "pi_x", client_secret: "x", status: "requires_payment_method", amount: 5000 }) };
    };
    call("product-upsert", ctxA, { sku: "P1", name: "x", price: 50, stock: 5 });
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "P1", qty: 1 });
    await call("cart-create-payment-intent", ctxA, { cartId: c.result.cart.id, terminal: true });
    assert.match(capturedBody, /capture_method=manual/);
    assert.match(capturedBody, /payment_method_types%5B%5D=card_present/);
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("cart-confirm-paid-with-intent verifies server-side + decrements stock + writes order", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    let getCalled = false;
    globalThis.fetch = async (url) => {
      if (url.includes("/payment_intents") && !getCalled) {
        // First call: POST create
        getCalled = true;
        return { ok: true, json: async () => ({ id: "pi_done", client_secret: "x", status: "requires_payment_method", amount: 2000 }) };
      }
      // Second call: GET retrieve, returns succeeded
      return {
        ok: true,
        json: async () => ({
          id: "pi_done", status: "succeeded", amount: 2000,
          metadata: { concord_user_id: "u", concord_cart_id: null /* will fill below */ },
          latest_charge: "ch_test789",
        }),
      };
    };
    call("product-upsert", ctxA, { sku: "P1", name: "x", price: 20, stock: 10 });
    const c = call("cart-open", ctxA);
    const cartId = c.result.cart.id;
    call("cart-add-line", ctxA, { cartId, sku: "P1", qty: 1 });
    // Override fetch so the GET returns the right cartId in metadata
    globalThis.fetch = async (url, opts) => {
      if (opts?.method === "POST" || (!opts?.method && url.endsWith("/payment_intents"))) {
        return { ok: true, json: async () => ({ id: "pi_done", client_secret: "x", status: "requires_payment_method", amount: 2000 }) };
      }
      return {
        ok: true,
        json: async () => ({
          id: "pi_done", status: "succeeded", amount: 2000,
          metadata: { concord_user_id: "u", concord_cart_id: cartId },
          latest_charge: "ch_test789",
        }),
      };
    };
    await call("cart-create-payment-intent", ctxA, { cartId });
    const r = await call("cart-confirm-paid-with-intent", ctxA, { cartId, paymentIntentId: "pi_done" });
    assert.equal(r.ok, true);
    assert.equal(r.result.order.paidVia, "stripe");
    assert.equal(r.result.order.stripePaymentIntentId, "pi_done");
    assert.equal(r.result.order.tenders[0].kind, "card");
    // Stock decremented
    const product = globalThis._concordSTATE.retailLens.products.get("u").get("P1");
    assert.equal(product.stock, 9);
    // Cart cleared
    assert.equal(globalThis._concordSTATE.retailLens.carts.get("u").has(cartId), false);
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("cart-confirm-paid-with-intent refuses when Stripe says not-succeeded", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    globalThis.fetch = async (url, opts) => {
      if (opts?.method === "POST" || (!opts?.method && url.endsWith("/payment_intents"))) {
        return { ok: true, json: async () => ({ id: "pi_unpaid", client_secret: "x", status: "requires_payment_method", amount: 2000 }) };
      }
      return { ok: true, json: async () => ({ id: "pi_unpaid", status: "requires_action", metadata: {} }) };
    };
    call("product-upsert", ctxA, { sku: "P1", name: "x", price: 20, stock: 10 });
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "P1", qty: 1 });
    await call("cart-create-payment-intent", ctxA, { cartId: c.result.cart.id });
    const r = await call("cart-confirm-paid-with-intent", ctxA, { cartId: c.result.cart.id, paymentIntentId: "pi_unpaid" });
    assert.equal(r.ok, false);
    assert.match(r.error, /payment not succeeded/);
    // Stock NOT decremented
    assert.equal(globalThis._concordSTATE.retailLens.products.get("u").get("P1").stock, 10);
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("cart-confirm-paid-with-intent rejects metadata mismatch (anti-tamper)", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_real";
    globalThis.fetch = async (url, opts) => {
      if (opts?.method === "POST" || (!opts?.method && url.endsWith("/payment_intents"))) {
        return { ok: true, json: async () => ({ id: "pi_x", client_secret: "x", status: "requires_payment_method", amount: 2000 }) };
      }
      return {
        ok: true,
        json: async () => ({
          id: "pi_x", status: "succeeded",
          // metadata says it belongs to a different user / cart!
          metadata: { concord_user_id: "v", concord_cart_id: "other_cart" },
        }),
      };
    };
    call("product-upsert", ctxA, { sku: "P1", name: "x", price: 20, stock: 10 });
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "P1", qty: 1 });
    await call("cart-create-payment-intent", ctxA, { cartId: c.result.cart.id });
    const r = await call("cart-confirm-paid-with-intent", ctxA, { cartId: c.result.cart.id, paymentIntentId: "pi_x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /metadata mismatch/);
    delete process.env.STRIPE_SECRET_KEY;
  });
});

// ── Full-app parity (Shopify 2026) ──────────────────────────────

describe("retail.customers-* (CRUD + segments)", () => {
  it("add / list / delete per-user scoped", () => {
    const a = call("customers-add", ctxA, { name: "Alice", email: "alice@example.com", totalSpent: 500, orderCount: 3 });
    assert.equal(a.ok, true);
    const list = call("customers-list", ctxA, {});
    assert.equal(list.result.customers.length, 1);
    assert.equal(call("customers-list", ctxB, {}).result.customers.length, 0);
    const del = call("customers-delete", ctxA, { id: a.result.customer.id });
    assert.equal(del.ok, true);
    assert.equal(call("customers-list", ctxA, {}).result.customers.length, 0);
  });
  it("rejects empty name or email", () => {
    assert.equal(call("customers-add", ctxA, { name: "", email: "x@y" }).ok, false);
    assert.equal(call("customers-add", ctxA, { name: "A", email: "" }).ok, false);
  });
  it("segments classify new / repeat / vip / atRisk / dormant", () => {
    const day = 86400000;
    call("customers-add", ctxA, { name: "New", email: "new@x", orderCount: 1, totalSpent: 50 });
    call("customers-add", ctxA, { name: "Repeat", email: "rep@x", orderCount: 3, totalSpent: 200 });
    call("customers-add", ctxA, { name: "VIP", email: "vip@x", orderCount: 10, totalSpent: 5000 });
    call("customers-add", ctxA, { name: "AtRisk", email: "ar@x", orderCount: 2, totalSpent: 100, lastOrderAt: new Date(Date.now() - 120 * day).toISOString() });
    call("customers-add", ctxA, { name: "Dorm", email: "do@x", orderCount: 1, totalSpent: 30, lastOrderAt: new Date(Date.now() - 200 * day).toISOString() });
    const r = call("customers-segments", ctxA, {});
    assert.equal(r.result.totalCustomers, 5);
    assert.ok(r.result.segments.vip >= 1);
    assert.ok(r.result.segments.atRisk >= 1);
    assert.ok(r.result.segments.dormant >= 1);
  });
});

describe("retail.discounts-* (CRUD + apply)", () => {
  it("create / list / delete cycle", () => {
    const d = call("discounts-create", ctxA, { code: "save10", kind: "percentage", value: 10 });
    assert.equal(d.ok, true);
    assert.equal(d.result.discount.code, "SAVE10");
    assert.equal(call("discounts-list", ctxA, {}).result.discounts.length, 1);
    assert.equal(call("discounts-delete", ctxA, { id: d.result.discount.id }).ok, true);
  });
  it("rejects duplicate code", () => {
    call("discounts-create", ctxA, { code: "DUP", kind: "percentage", value: 5 });
    const r = call("discounts-create", ctxA, { code: "DUP", kind: "percentage", value: 10 });
    assert.equal(r.ok, false);
  });
  it("rejects percentage > 100", () => {
    assert.equal(call("discounts-create", ctxA, { code: "BIG", kind: "percentage", value: 150 }).ok, false);
  });
  it("apply percentage discount to cart", () => {
    call("discounts-create", ctxA, { code: "TEN", kind: "percentage", value: 10 });
    call("product-upsert", ctxA, { sku: "P1", name: "X", price: 100, stock: 10 });
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "P1", qty: 1 });
    const a = call("discounts-apply", ctxA, { cartId: c.result.cart.id, code: "TEN" });
    assert.equal(a.ok, true);
    assert.equal(a.result.discountAmount, 10);
  });
  it("apply rejects when min subtotal not met", () => {
    call("discounts-create", ctxA, { code: "BIG", kind: "percentage", value: 10, minSubtotal: 200 });
    call("product-upsert", ctxA, { sku: "P1", name: "X", price: 50, stock: 10 });
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "P1", qty: 1 });
    const r = call("discounts-apply", ctxA, { cartId: c.result.cart.id, code: "BIG" });
    assert.equal(r.ok, false);
  });
  it("free_shipping discount sets cart.freeShipping flag", () => {
    call("discounts-create", ctxA, { code: "FREE", kind: "free_shipping", value: 0 });
    call("product-upsert", ctxA, { sku: "P1", name: "X", price: 10, stock: 10 });
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "P1", qty: 1 });
    const r = call("discounts-apply", ctxA, { cartId: c.result.cart.id, code: "FREE" });
    assert.equal(r.ok, true);
    assert.equal(r.result.cart.freeShipping, true);
  });
});

describe("retail.abandoned-carts-* (recovery)", () => {
  it("list filters by age threshold", () => {
    call("product-upsert", ctxA, { sku: "P1", name: "X", price: 50, stock: 10 });
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "P1", qty: 2 });
    const fresh = call("abandoned-carts-list", ctxA, { thresholdHours: 24 });
    assert.equal(fresh.result.carts.length, 0);
    const cart = globalThis._concordSTATE.retailLens.carts.get("u").get(c.result.cart.id);
    cart.openedAt = new Date(Date.now() - 2 * 3600000).toISOString();
    const old = call("abandoned-carts-list", ctxA, { thresholdHours: 1 });
    assert.equal(old.result.carts.length, 1);
    assert.equal(old.result.totalLostValue, 100);
  });
  it("recovery creates discounted shareable link", () => {
    call("product-upsert", ctxA, { sku: "P1", name: "X", price: 100, stock: 10 });
    const c = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "P1", qty: 1 });
    const r = call("abandoned-cart-recover", ctxA, { cartId: c.result.cart.id, discountCode: "WIN10" });
    assert.equal(r.ok, true);
    assert.match(r.result.recovery.shareableLink, /discount=WIN10/);
    assert.equal(r.result.recovery.kind, "discounted_recovery");
  });
});

describe("retail.shipping-zones-* + rate-quote", () => {
  it("create + list + delete + quote per-country", () => {
    const z = call("shipping-zones-create", ctxA, { name: "North America", countries: ["US", "CA"], rates: [{ id: "r1", name: "Standard", priceCents: 800, freeThreshold: 50 }, { id: "r2", name: "Express", priceCents: 2000, freeThreshold: null }] });
    assert.equal(z.ok, true);
    assert.equal(call("shipping-zones-list", ctxA, {}).result.zones.length, 1);
    const q = call("shipping-rate-quote", ctxA, { country: "us", subtotal: 100 });
    assert.equal(q.result.zone, "North America");
    const standard = q.result.quotes.find(x => x.name === "Standard");
    assert.equal(standard.priceCents, 0);
    assert.equal(standard.free, true);
    const lowQ = call("shipping-rate-quote", ctxA, { country: "us", subtotal: 20 });
    const lowStd = lowQ.result.quotes.find(x => x.name === "Standard");
    assert.equal(lowStd.priceCents, 800);
    assert.equal(call("shipping-zones-delete", ctxA, { id: z.result.zone.id }).ok, true);
  });
  it("rate-quote returns empty for uncovered country", () => {
    const r = call("shipping-rate-quote", ctxA, { country: "ZW", subtotal: 100 });
    assert.equal(r.result.quotes.length, 0);
  });
});

describe("retail.tax-rates-*", () => {
  it("set creates or updates by region", () => {
    call("tax-rates-set", ctxA, { region: "CA", ratePct: 7.25 });
    call("tax-rates-set", ctxA, { region: "CA", ratePct: 7.5 });
    const list = call("tax-rates-list", ctxA, {});
    assert.equal(list.result.rates.length, 1);
    assert.equal(list.result.rates[0].ratePct, 7.5);
  });
  it("clamps rate to 0-50%", () => {
    call("tax-rates-set", ctxA, { region: "XX", ratePct: 100 });
    assert.equal(call("tax-rates-list", ctxA, {}).result.rates[0].ratePct, 50);
  });
});

describe("retail.gift-cards-* (issue + balance + redeem)", () => {
  it("create / balance / partial redeem / full redeem cycle", () => {
    const c = call("gift-cards-create", ctxA, { initialValue: 100, recipientEmail: "r@x" });
    assert.equal(c.ok, true);
    const code = c.result.card.code;
    assert.equal(call("gift-cards-balance", ctxA, { code }).result.balance, 100);
    const r1 = call("gift-cards-redeem", ctxA, { code, amount: 30 });
    assert.equal(r1.result.remainingBalance, 70);
    assert.equal(r1.result.status, "active");
    const r2 = call("gift-cards-redeem", ctxA, { code, amount: 70 });
    assert.equal(r2.result.status, "redeemed");
    const r3 = call("gift-cards-redeem", ctxA, { code, amount: 10 });
    assert.equal(r3.ok, false);
  });
  it("rejects unknown code / insufficient balance", () => {
    assert.equal(call("gift-cards-balance", ctxA, { code: "NOPE" }).ok, false);
    const c = call("gift-cards-create", ctxA, { initialValue: 10 });
    const r = call("gift-cards-redeem", ctxA, { code: c.result.card.code, amount: 100 });
    assert.equal(r.ok, false);
  });
});

describe("retail.refunds-* (order refunds + restock)", () => {
  it("creates refund and restocks inventory by default", () => {
    call("product-upsert", ctxA, { sku: "P1", name: "X", price: 100, stock: 10 });
    const cart = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: cart.result.cart.id, sku: "P1", qty: 2 });
    const o = call("cart-tender", ctxA, { cartId: cart.result.cart.id, tenders: [{ kind: "cash", amount: 200 }] });
    assert.equal(call("product-list", ctxA, {}).result.products[0].stock, 8);
    const r = call("refunds-create", ctxA, { orderId: o.result.order.id, amount: 200, reason: "defective" });
    assert.equal(r.ok, true);
    assert.equal(call("product-list", ctxA, {}).result.products[0].stock, 10);
  });
  it("rejects refund > order total", () => {
    call("product-upsert", ctxA, { sku: "P1", name: "X", price: 50, stock: 10 });
    const cart = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: cart.result.cart.id, sku: "P1", qty: 1 });
    const o = call("cart-tender", ctxA, { cartId: cart.result.cart.id, tenders: [{ kind: "cash", amount: 50 }] });
    const r = call("refunds-create", ctxA, { orderId: o.result.order.id, amount: 100 });
    assert.equal(r.ok, false);
  });
});

describe("retail.collections-* (product groupings)", () => {
  it("create + add-product + list + delete cycle", () => {
    const c = call("collections-create", ctxA, { name: "Winter Sale", productSkus: ["P1"] });
    assert.equal(c.ok, true);
    call("collections-add-product", ctxA, { id: c.result.collection.id, sku: "P2" });
    assert.equal(call("collections-list", ctxA, {}).result.collections[0].productSkus.length, 2);
    assert.equal(call("collections-delete", ctxA, { id: c.result.collection.id }).ok, true);
  });
});

describe("retail.transfers-* (inventory transfers)", () => {
  it("create / list / receive cycle", () => {
    const t = call("transfers-create", ctxA, { fromLocation: "Warehouse A", toLocation: "Store 1", lines: [{ sku: "P1", qty: 5 }] });
    assert.equal(t.ok, true);
    assert.equal(t.result.transfer.status, "in_transit");
    const r = call("transfers-receive", ctxA, { id: t.result.transfer.id });
    assert.equal(r.result.transfer.status, "received");
  });
  it("rejects empty lines or missing location", () => {
    assert.equal(call("transfers-create", ctxA, { fromLocation: "", toLocation: "B", lines: [] }).ok, false);
  });
});

describe("retail.analytics-* (revenue/top products/summary)", () => {
  it("revenue-by-day aggregates orders", () => {
    call("product-upsert", ctxA, { sku: "P1", name: "X", price: 100, stock: 100 });
    for (let i = 0; i < 3; i++) {
      const c = call("cart-open", ctxA);
      call("cart-add-line", ctxA, { cartId: c.result.cart.id, sku: "P1", qty: 1 });
      call("cart-tender", ctxA, { cartId: c.result.cart.id, tenders: [{ kind: "cash", amount: 100 }] });
    }
    const r = call("analytics-revenue-by-day", ctxA, { days: 30 });
    assert.equal(r.result.totalOrders, 3);
    assert.equal(r.result.totalRevenue, 300);
    assert.equal(r.result.avgOrderValue, 100);
  });
  it("top-products ranks by revenue", () => {
    call("product-upsert", ctxA, { sku: "P1", name: "Cheap", price: 10, stock: 100 });
    call("product-upsert", ctxA, { sku: "P2", name: "Expensive", price: 100, stock: 100 });
    const c1 = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: c1.result.cart.id, sku: "P1", qty: 5 });
    call("cart-add-line", ctxA, { cartId: c1.result.cart.id, sku: "P2", qty: 2 });
    call("cart-tender", ctxA, { cartId: c1.result.cart.id, tenders: [{ kind: "cash", amount: 250 }] });
    const r = call("analytics-top-products", ctxA, { limit: 10 });
    assert.equal(r.result.topProducts[0].sku, "P2");
    assert.equal(r.result.topProducts[0].revenue, 200);
  });
  it("summary aggregates totals", () => {
    call("product-upsert", ctxA, { sku: "P1", name: "X", price: 50, stock: 10 });
    call("customers-add", ctxA, { name: "Alice", email: "a@x" });
    const cart = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: cart.result.cart.id, sku: "P1", qty: 1 });
    call("cart-tender", ctxA, { cartId: cart.result.cart.id, tenders: [{ kind: "cash", amount: 50 }] });
    const r = call("analytics-summary", ctxA, {});
    assert.equal(r.result.totalRevenue, 50);
    assert.equal(r.result.totalOrders, 1);
    assert.equal(r.result.productCount, 1);
    assert.equal(r.result.customerCount, 1);
  });
});

// ─── 2026 parity backlog — Shopify feature gaps ─────────────────────

describe("retail.storefront-* (buyer-facing shop)", () => {
  it("configure assigns a slug + publish exposes catalog + checkout writes an order", () => {
    call("product-upsert", ctxA, { sku: "SF1", name: "Sun Hat", price: 25, stock: 10 });
    const cfg = call("storefront-configure", ctxA, { name: "Beach Co", tagline: "Summer goods", theme: "warm" });
    assert.equal(cfg.ok, true);
    assert.ok(cfg.result.storefront.slug);
    const pub = call("storefront-publish", ctxA, { published: true, publishedSkus: ["SF1"] });
    assert.equal(pub.ok, true);
    assert.equal(pub.result.publicUrl, `/shop/${cfg.result.storefront.slug}`);
    const cat = call("storefront-catalog", ctxA, {});
    assert.equal(cat.result.published, true);
    assert.equal(cat.result.products.length, 1);
    const co = call("storefront-checkout", ctxA, { buyerName: "Pat", buyerEmail: "pat@x.com", lines: [{ sku: "SF1", qty: 2 }] });
    assert.equal(co.ok, true);
    assert.equal(co.result.order.channel, "storefront");
    assert.equal(co.result.order.total, 50);
    assert.equal(call("product-list", ctxA).result.products[0].stock, 8);
  });
  it("rejects checkout when storefront not published or stock insufficient", () => {
    call("product-upsert", ctxA, { sku: "SF2", name: "Tote", price: 5, stock: 1 });
    assert.equal(call("storefront-checkout", ctxA, { buyerName: "A", buyerEmail: "a@x", lines: [{ sku: "SF2", qty: 1 }] }).ok, false);
    call("storefront-configure", ctxA, { name: "Shop B" });
    call("storefront-publish", ctxA, { published: true });
    assert.equal(call("storefront-checkout", ctxA, { buyerName: "A", buyerEmail: "a@x", lines: [{ sku: "SF2", qty: 9 }] }).ok, false);
  });
});

describe("retail.fulfillment-* (pick/pack/ship workflow)", () => {
  it("advances an order through fulfillment stages + records a shipment notice", () => {
    call("product-upsert", ctxA, { sku: "F1", name: "Box", price: 12, stock: 5 });
    call("storefront-configure", ctxA, { name: "Fulfil Co" });
    call("storefront-publish", ctxA, { published: true });
    const co = call("storefront-checkout", ctxA, { buyerName: "Lee", buyerEmail: "lee@x.com", lines: [{ sku: "F1", qty: 1 }] });
    const orderId = co.result.order.id;
    const q = call("fulfillment-queue", ctxA, {});
    assert.equal(q.result.queue.length, 1);
    assert.equal(q.result.queue[0].fulfillmentStatus, "unfulfilled");
    assert.equal(call("fulfillment-advance", ctxA, { orderId }).result.order.fulfillmentStatus, "picking");
    assert.equal(call("fulfillment-advance", ctxA, { orderId }).result.order.fulfillmentStatus, "packed");
    const shipped = call("fulfillment-advance", ctxA, { orderId });
    assert.equal(shipped.result.order.fulfillmentStatus, "shipped");
    assert.ok(shipped.result.notification);
    assert.equal(call("fulfillment-notifications", ctxA, {}).result.notifications.length, 1);
  });
  it("rejects backward fulfillment moves", () => {
    call("product-upsert", ctxA, { sku: "F2", name: "Y", price: 1, stock: 9 });
    call("storefront-configure", ctxA, { name: "C" });
    call("storefront-publish", ctxA, { published: true });
    const co = call("storefront-checkout", ctxA, { buyerName: "B", buyerEmail: "b@x", lines: [{ sku: "F2", qty: 1 }] });
    call("fulfillment-advance", ctxA, { orderId: co.result.order.id, toStatus: "packed" });
    assert.equal(call("fulfillment-advance", ctxA, { orderId: co.result.order.id, toStatus: "picking" }).ok, false);
  });
});

describe("retail.shipping-label-* + shipping-track (carrier integration)", () => {
  it("label-buy returns a clear not-configured error without a provider", async () => {
    call("product-upsert", ctxA, { sku: "L1", name: "Z", price: 1, stock: 5 });
    call("storefront-configure", ctxA, { name: "Ship Co" });
    call("storefront-publish", ctxA, { published: true });
    const co = call("storefront-checkout", ctxA, { buyerName: "B", buyerEmail: "b@x", lines: [{ sku: "L1", qty: 1 }] });
    const r = await call("shipping-label-buy", ctxA, { orderId: co.result.order.id, carrier: "usps", toAddress: { name: "B" } });
    assert.equal(r.ok, false);
    assert.match(r.error, /not configured/i);
  });
  it("shipping-track requires a tracking number + provider config", async () => {
    assert.equal((await call("shipping-track", ctxA, {})).ok, false);
    assert.equal((await call("shipping-track", ctxA, { trackingNumber: "1Z999" })).ok, false);
    assert.equal(call("shipping-labels-list", ctxA, {}).result.labels.length, 0);
  });
});

describe("retail.campaigns-* (marketing campaigns + conversion tracking)", () => {
  it("create + send + record-conversion + performance cycle", () => {
    call("customers-add", ctxA, { name: "Mia", email: "mia@x.com", acceptsMarketing: true });
    const c = call("campaigns-create", ctxA, { name: "Spring", channel: "email", segment: "marketing", subject: "Sale" });
    assert.equal(c.ok, true);
    const sent = call("campaigns-send", ctxA, { id: c.result.campaign.id });
    assert.equal(sent.result.campaign.status, "sent");
    assert.equal(sent.result.recipients.length, 1);
    call("product-upsert", ctxA, { sku: "C1", name: "Q", price: 40, stock: 5 });
    const cart = call("cart-open", ctxA);
    call("cart-add-line", ctxA, { cartId: cart.result.cart.id, sku: "C1", qty: 1 });
    const ord = call("cart-tender", ctxA, { cartId: cart.result.cart.id, tenders: [{ kind: "cash", amount: 40 }] });
    const conv = call("campaigns-record-conversion", ctxA, { id: c.result.campaign.id, orderId: ord.result.order.id });
    assert.equal(conv.result.campaign.conversions, 1);
    assert.equal(conv.result.campaign.revenue, 40);
    const perf = call("campaigns-performance", ctxA, {});
    assert.equal(perf.result.totals.totalRevenue, 40);
  });
  it("discount campaigns require a discount code", () => {
    assert.equal(call("campaigns-create", ctxA, { name: "X", channel: "discount" }).ok, false);
  });
});

describe("retail.channels-* (multi-channel listing)", () => {
  it("connect + list-products + sync-inventory cycle", () => {
    call("product-upsert", ctxA, { sku: "MC1", name: "Mug", price: 8, stock: 20 });
    const conn = call("channels-connect", ctxA, { channel: "etsy", storeName: "My Etsy" });
    assert.equal(conn.ok, true);
    const listed = call("channels-list-products", ctxA, { id: conn.result.channel.id, skus: ["MC1"] });
    assert.equal(listed.result.channel.listedSkus.length, 1);
    const sync = call("channels-sync-inventory", ctxA, {});
    assert.equal(sync.result.channels[0].updates[0].stock, 20);
    assert.equal(call("channels-disconnect", ctxA, { id: conn.result.channel.id }).ok, true);
  });
  it("rejects unsupported channels", () => {
    assert.equal(call("channels-connect", ctxA, { channel: "myspace" }).ok, false);
  });
});

describe("retail.reviews-* (product reviews + ratings)", () => {
  it("submit + summary + moderate cycle", () => {
    call("product-upsert", ctxA, { sku: "RV1", name: "Lamp", price: 30, stock: 5 });
    const sub = call("reviews-submit", ctxA, { sku: "RV1", rating: 5, authorName: "Sam", body: "Great" });
    assert.equal(sub.ok, true);
    assert.equal(sub.result.review.rating, 5);
    const sum = call("reviews-summary", ctxA, {});
    assert.equal(sum.result.totalReviews, 1);
    assert.equal(sum.result.avgRating, 5);
    const mod = call("reviews-moderate", ctxA, { id: sub.result.review.id, status: "hidden" });
    assert.equal(mod.result.review.status, "hidden");
    assert.equal(call("reviews-summary", ctxA, {}).result.totalReviews, 0);
  });
  it("rejects out-of-range ratings + missing product", () => {
    assert.equal(call("reviews-submit", ctxA, { sku: "RV1", rating: 9, authorName: "A" }).ok, false);
    assert.equal(call("reviews-submit", ctxA, { sku: "NOPE", rating: 4, authorName: "A" }).ok, false);
  });
});

describe("retail.staff-* (staff accounts + permissions)", () => {
  it("invite + activate + check-permission cycle", () => {
    const inv = call("staff-invite", ctxA, { name: "Joe", email: "joe@x.com", role: "cashier" });
    assert.equal(inv.ok, true);
    assert.equal(inv.result.member.status, "invited");
    const act = call("staff-activate", ctxA, { id: inv.result.member.id });
    assert.equal(act.result.member.status, "active");
    const ok = call("staff-check-permission", ctxA, { id: inv.result.member.id, permission: "orders" });
    assert.equal(ok.result.allowed, true);
    const denied = call("staff-check-permission", ctxA, { id: inv.result.member.id, permission: "staff" });
    assert.equal(denied.result.allowed, false);
    assert.equal(call("staff-remove", ctxA, { id: inv.result.member.id }).ok, true);
  });
  it("rejects unknown roles + duplicate emails", () => {
    assert.equal(call("staff-invite", ctxA, { name: "A", email: "a@x", role: "wizard" }).ok, false);
    call("staff-invite", ctxA, { name: "A", email: "dup@x", role: "manager" });
    assert.equal(call("staff-invite", ctxA, { name: "B", email: "dup@x", role: "manager" }).ok, false);
  });
});
