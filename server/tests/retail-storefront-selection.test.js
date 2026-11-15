// FIX-retail-002 — founder ruling A pins: a published storefront with
// an EMPTY publishedSkus selection exposes nothing (the old read
// treated "no products selected" as "whole catalog"). A product is
// public only when the owner explicitly selected it, and checkout
// honours the same selection.
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

const ctx = { actor: { userId: "merchant-1" }, userId: "merchant-1" };

function seedCatalog() {
  call("product-upsert", ctx, { sku: "SEL", name: "Selected", price: 10, stock: 5 });
  call("product-upsert", ctx, { sku: "UNSEL", name: "Unselected", price: 20, stock: 5 });
  call("storefront-configure", ctx, { name: "Ruling Shop" });
}

describe("FIX-retail-002 storefront selection default", () => {
  it("empty selection renders an EMPTY catalog, not the whole catalog", () => {
    seedCatalog();
    call("storefront-publish", ctx, { published: true, publishedSkus: [] });
    const cat = call("storefront-catalog", ctx, {});
    assert.equal(cat.result.published, true);
    assert.deepEqual(cat.result.products, []);
  });

  it("publishing with no selection argument at all also renders empty", () => {
    seedCatalog();
    call("storefront-publish", ctx, { published: true });
    const cat = call("storefront-catalog", ctx, {});
    assert.deepEqual(cat.result.products, []);
  });

  it("an explicit selection renders exactly the selected SKUs", () => {
    seedCatalog();
    call("storefront-publish", ctx, { published: true, publishedSkus: ["SEL"] });
    const cat = call("storefront-catalog", ctx, {});
    assert.deepEqual(cat.result.products.map((p) => p.sku), ["SEL"]);
  });

  it("a newly added product does NOT go public on an already-published storefront", () => {
    seedCatalog();
    call("storefront-publish", ctx, { published: true, publishedSkus: ["SEL"] });
    call("product-upsert", ctx, { sku: "NEW", name: "Just added", price: 1, stock: 1 });
    const cat = call("storefront-catalog", ctx, {});
    assert.deepEqual(cat.result.products.map((p) => p.sku), ["SEL"]);
  });

  it("checkout refuses an unselected SKU and sells a selected one", () => {
    seedCatalog();
    call("storefront-publish", ctx, { published: true, publishedSkus: ["SEL"] });
    const bad = call("storefront-checkout", ctx, { buyerName: "B", buyerEmail: "b@x.com", lines: [{ sku: "UNSEL", qty: 1 }] });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /not published on this storefront/);
    const good = call("storefront-checkout", ctx, { buyerName: "B", buyerEmail: "b@x.com", lines: [{ sku: "SEL", qty: 1 }] });
    assert.equal(good.ok, true);
  });
});
