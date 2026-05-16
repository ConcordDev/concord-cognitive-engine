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
