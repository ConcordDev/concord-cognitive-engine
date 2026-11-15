// FIX-retail-013 — the published storefront URL must resolve.
// storefront-publish returns publicUrl /shop/<slug> and the manager UI
// prints "Published at /shop/<slug>", but the only catalog read was
// owner-scoped, so the shared URL had nothing to serve. Pins the
// by-slug public read: a visitor (any identity, incl. anon) resolves
// the slug to the published catalog, the FIX-retail-002 selection
// filter applies identically, unpublished stores say so plainly,
// unknown slugs refuse, and no owner identity leaks.
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

const merchant = { actor: { userId: "merchant-1" }, userId: "merchant-1" };
const visitor = { actor: { userId: "someone-else" }, userId: "someone-else" };
const anon = { actor: { userId: "anon" }, userId: "anon" };

function seedPublishedStore() {
  call("product-upsert", merchant, { sku: "SEL", name: "Selected", price: 10, stock: 5 });
  call("product-upsert", merchant, { sku: "UNSEL", name: "Unselected", price: 20, stock: 5 });
  const cfg = call("storefront-configure", merchant, { name: "Slug Shop", tagline: "Open for business" });
  call("storefront-publish", merchant, { published: true, publishedSkus: ["SEL"] });
  return cfg.result.storefront.slug;
}

describe("FIX-retail-013 public storefront by slug", () => {
  it("a visitor resolves the slug to the published, selection-filtered catalog", () => {
    const slug = seedPublishedStore();
    assert.equal(slug, "slug-shop");
    const pub = call("storefront-public", visitor, { slug });
    assert.equal(pub.ok, true);
    assert.equal(pub.result.published, true);
    assert.equal(pub.result.storeName, "Slug Shop");
    assert.deepEqual(pub.result.products.map((p) => p.sku), ["SEL"]);
    // No owner identity anywhere in the public payload.
    assert.equal(JSON.stringify(pub.result).includes("merchant-1"), false);
  });

  it("an anonymous caller can read a published storefront, case-insensitively", () => {
    seedPublishedStore();
    const pub = call("storefront-public", anon, { slug: "SLUG-SHOP" });
    assert.equal(pub.ok, true);
    assert.equal(pub.result.published, true);
    assert.equal(pub.result.products.length, 1);
  });

  it("unknown slug refuses as not found; a missing slug is a usage error", () => {
    seedPublishedStore();
    const miss = call("storefront-public", visitor, { slug: "no-such-store" });
    assert.equal(miss.ok, false);
    assert.match(miss.error, /not found/i);
    const empty = call("storefront-public", visitor, {});
    assert.equal(empty.ok, false);
  });

  it("an unpublished storefront reads as published:false, never its catalog", () => {
    call("product-upsert", merchant, { sku: "SEL", name: "Selected", price: 10, stock: 5 });
    const cfg = call("storefront-configure", merchant, { name: "Draft Shop" });
    const pub = call("storefront-public", visitor, { slug: cfg.result.storefront.slug });
    assert.equal(pub.ok, true);
    assert.equal(pub.result.published, false);
    assert.equal(pub.result.products, undefined);
  });

  it("the owner-scoped catalog still returns the same catalog (shared shaping)", () => {
    seedPublishedStore();
    const own = call("storefront-catalog", merchant, {});
    assert.equal(own.ok, true);
    assert.equal(own.result.published, true);
    assert.equal(own.result.slug, "slug-shop");
    assert.deepEqual(own.result.products.map((p) => p.sku), ["SEL"]);
  });
});
