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
