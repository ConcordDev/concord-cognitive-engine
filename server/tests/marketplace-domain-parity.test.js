// Contract tests for the marketplace domain-parity macros (Etsy + Bandcamp 2026 parity).
// Pure-Node Tier-2 — no server boot, no HTTP.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerMarketplaceActions from "../domains/marketplace.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`marketplace.${name}`);
  assert.ok(fn, `marketplace.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerMarketplaceActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "seller_a", displayName: "Alice" }, userId: "seller_a" };
const ctxB = { actor: { userId: "seller_b" }, userId: "seller_b" };

describe("marketplace — shop bootstrap + update", () => {
  it("shop-get auto-creates a shop on first call", () => {
    const r = call("shop-get", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.shop.ownerId, "seller_a");
    assert.match(r.result.shop.slug, /^[a-z0-9]+$/);
    assert.equal(r.result.shop.currency, "USD");
  });

  it("shop-update writes name + socials + policies", () => {
    call("shop-get", ctxA);
    const r = call("shop-update", ctxA, { name: "Alice Studio", tagline: "Handmade ceramics", socials: { instagram: "alicestudio" }, policies: { shipping: "Ships in 3-5 days" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.shop.name, "Alice Studio");
    assert.equal(r.result.shop.socials.instagram, "alicestudio");
    assert.equal(r.result.shop.policies.shipping, "Ships in 3-5 days");
  });

  it("shops are per-user (multi-tenant isolation)", () => {
    call("shop-get", ctxA);
    const b = call("shop-get", ctxB);
    assert.notEqual(b.result.shop.id, call("shop-get", ctxA).result.shop.id);
  });
});

describe("marketplace — listings CRUD + publish", () => {
  it("listings-create + publish + unpublish + delete", () => {
    const r = call("listings-create", ctxA, { title: "Vintage mug", priceUsd: 18, kind: "physical_good", stockQty: 5, tags: ["vintage", "ceramic", "mug"] });
    assert.equal(r.ok, true);
    assert.equal(r.result.listing.status, "draft");
    const id = r.result.listing.id;
    assert.equal(call("listings-publish", ctxA, { id }).result.listing.status, "published");
    assert.equal(call("listings-unpublish", ctxA, { id }).result.listing.status, "draft");
    assert.equal(call("listings-delete", ctxA, { id }).result.deleted, true);
    assert.equal(call("listings-list", ctxA).result.listings.length, 0);
  });

  it("rejects invalid kind by falling back to default", () => {
    const r = call("listings-create", ctxA, { title: "X", priceUsd: 1, kind: "garbage" });
    assert.equal(r.ok, true);
    assert.equal(r.result.listing.kind, "digital_download");
  });

  it("rejects negative price", () => {
    const r = call("listings-create", ctxA, { title: "X", priceUsd: -1 });
    assert.equal(r.ok, false);
  });
});

describe("marketplace — orders + stock decrement", () => {
  it("orders-create decrements stock + restocks on refund", () => {
    const l = call("listings-create", ctxA, { title: "Limited print", priceUsd: 50, kind: "merch_print", stockQty: 3 }).result.listing;
    call("listings-publish", ctxA, { id: l.id });
    const o1 = call("orders-create", ctxA, { listingId: l.id, qty: 2, buyerName: "Bob", buyerEmail: "b@x.com" });
    assert.equal(o1.ok, true);
    assert.equal(o1.result.order.totalUsd, 100);
    // Verify stock decremented
    const after = call("listings-list", ctxA).result.listings.find(x => x.id === l.id);
    assert.equal(after.stockQty, 1);
    // Refund restocks
    call("orders-refund", ctxA, { id: o1.result.order.id, reason: "wrong color" });
    const restocked = call("listings-list", ctxA).result.listings.find(x => x.id === l.id);
    assert.equal(restocked.stockQty, 3);
  });

  it("rejects order when listing not published", () => {
    const l = call("listings-create", ctxA, { title: "X", priceUsd: 10 }).result.listing;
    const r = call("orders-create", ctxA, { listingId: l.id, qty: 1 });
    assert.equal(r.ok, false);
    assert.match(r.error, /not published/);
  });

  it("rejects order over stock", () => {
    const l = call("listings-create", ctxA, { title: "X", priceUsd: 10, kind: "physical_good", stockQty: 1 }).result.listing;
    call("listings-publish", ctxA, { id: l.id });
    const r = call("orders-create", ctxA, { listingId: l.id, qty: 5 });
    assert.equal(r.ok, false);
    assert.match(r.error, /in stock/);
  });

  it("orders-mark-shipped → mark-delivered workflow", () => {
    const l = call("listings-create", ctxA, { title: "X", priceUsd: 10, kind: "physical_good", stockQty: 5 }).result.listing;
    call("listings-publish", ctxA, { id: l.id });
    const o = call("orders-create", ctxA, { listingId: l.id, qty: 1 }).result.order;
    call("orders-mark-shipped", ctxA, { id: o.id, trackingNumber: "1Z999", carrier: "UPS" });
    const after = call("orders-list", ctxA).result.orders.find(x => x.id === o.id);
    assert.equal(after.status, "shipped");
    assert.equal(after.trackingNumber, "1Z999");
    call("orders-mark-delivered", ctxA, { id: o.id });
    const delivered = call("orders-list", ctxA).result.orders.find(x => x.id === o.id);
    assert.equal(delivered.status, "delivered");
  });
});

describe("marketplace — analytics (Visits / Views / Orders / Revenue)", () => {
  it("analytics-summary aggregates revenue + views + conversion", () => {
    const l = call("listings-create", ctxA, { title: "X", priceUsd: 25 }).result.listing;
    call("listings-publish", ctxA, { id: l.id });
    call("analytics-track-view", ctxA, { listingId: l.id, uniqueVisit: true });
    call("analytics-track-view", ctxA, { listingId: l.id });
    call("orders-create", ctxA, { listingId: l.id, qty: 1 });
    const r = call("analytics-summary", ctxA, { days: 30 });
    assert.equal(r.ok, true);
    assert.equal(r.result.orderCount, 1);
    assert.equal(r.result.revenueUsd, 25);
    assert.ok(r.result.views >= 2);
    assert.equal(r.result.series.length, 30);
  });

  it("analytics-by-listing sorts by revenue desc", () => {
    const l1 = call("listings-create", ctxA, { title: "Cheap", priceUsd: 5 }).result.listing;
    const l2 = call("listings-create", ctxA, { title: "Pricey", priceUsd: 100 }).result.listing;
    call("listings-publish", ctxA, { id: l1.id });
    call("listings-publish", ctxA, { id: l2.id });
    call("orders-create", ctxA, { listingId: l1.id });
    call("orders-create", ctxA, { listingId: l2.id });
    const r = call("analytics-by-listing", ctxA);
    assert.equal(r.result.listings[0].title, "Pricey");
    assert.equal(r.result.listings[0].revenueUsd, 100);
  });
});

describe("marketplace — search visibility (Etsy 2026)", () => {
  it("search-impression accumulates impressions + clicks per keyword", () => {
    const l = call("listings-create", ctxA, { title: "Boho mug", priceUsd: 18 }).result.listing;
    call("search-impression", ctxA, { listingId: l.id, keyword: "boho mug" });
    call("search-impression", ctxA, { listingId: l.id, keyword: "boho mug", click: true });
    call("search-impression", ctxA, { listingId: l.id, keyword: "boho mug" });
    const r = call("search-visibility", ctxA);
    assert.equal(r.ok, true);
    const listing = r.result.listings.find(x => x.listingId === l.id);
    assert.equal(listing.totalImpressions, 3);
    assert.equal(listing.totalClicks, 1);
    assert.equal(listing.overallCtrPct, 33.33);
  });
});

describe("marketplace — insights + saved searches", () => {
  it("insights-keyword-search returns own listing match count", () => {
    call("listings-create", ctxA, { title: "Handmade boho ring", priceUsd: 30, tags: ["boho"] });
    call("listings-create", ctxA, { title: "Vintage boho ring", priceUsd: 35, tags: ["boho"] });
    call("listings-create", ctxA, { title: "Plain coaster", priceUsd: 5 });
    const r = call("insights-keyword-search", ctxA, { keyword: "boho" });
    assert.equal(r.ok, true);
    assert.equal(r.result.ownListingCount, 2);
  });

  it("saved-searches CRUD with 50 cap", () => {
    const r = call("saved-searches-save", ctxA, { keyword: "vintage" });
    assert.equal(r.ok, true);
    const list = call("saved-searches-list", ctxA);
    assert.equal(list.result.savedSearches.length, 1);
    const dup = call("saved-searches-save", ctxA, { keyword: "VINTAGE" });
    assert.equal(dup.ok, false);
    call("saved-searches-delete", ctxA, { id: r.result.savedSearch.id });
    assert.equal(call("saved-searches-list", ctxA).result.savedSearches.length, 0);
  });
});

describe("marketplace — promotions", () => {
  it("promotions-create + toggle", () => {
    const r = call("promotions-create", ctxA, { code: "summer10", kind: "percent", amount: 10, minOrderUsd: 25 });
    assert.equal(r.ok, true);
    assert.equal(r.result.promotion.code, "SUMMER10");
    call("promotions-toggle", ctxA, { id: r.result.promotion.id });
    const list = call("promotions-list", ctxA);
    assert.equal(list.result.promotions[0].active, false);
  });

  it("rejects invalid percent (>100) or fixed (<=0)", () => {
    const a = call("promotions-create", ctxA, { code: "X", kind: "percent", amount: 150 });
    assert.equal(a.ok, false);
    const b = call("promotions-create", ctxA, { code: "Y", kind: "fixed", amount: 0 });
    assert.equal(b.ok, false);
  });

  it("rejects duplicate codes", () => {
    call("promotions-create", ctxA, { code: "ONCE", kind: "percent", amount: 10 });
    const dup = call("promotions-create", ctxA, { code: "ONCE", kind: "percent", amount: 20 });
    assert.equal(dup.ok, false);
  });
});

describe("marketplace — AI: optimize-listing + price-suggest", () => {
  it("ai-optimize-listing returns deterministic suggestions when no brain", async () => {
    const l = call("listings-create", ctxA, { title: "ring", priceUsd: 20, tags: ["boho"], description: "ring" }).result.listing;
    const r = await call("ai-optimize-listing", ctxA, { id: l.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "deterministic");
    // Issues array should call out short title + short description + few tags
    assert.ok(r.result.issues.some(i => /title/i.test(i)));
    assert.ok(r.result.issues.some(i => /tags/i.test(i)));
    assert.ok(r.result.issues.some(i => /description/i.test(i)));
  });

  it("ai-price-suggest needs ≥ 2 comparables of same kind", () => {
    const l = call("listings-create", ctxA, { title: "X", priceUsd: 50, kind: "physical_good" }).result.listing;
    const r1 = call("ai-price-suggest", ctxA, { id: l.id });
    assert.equal(r1.ok, true);
    assert.match(r1.result.message, /comparable/i);
    // Add peers
    const p1 = call("listings-create", ctxA, { title: "Y1", priceUsd: 30, kind: "physical_good" }).result.listing;
    const p2 = call("listings-create", ctxA, { title: "Y2", priceUsd: 70, kind: "physical_good" }).result.listing;
    call("listings-publish", ctxA, { id: p1.id });
    call("listings-publish", ctxA, { id: p2.id });
    const r2 = call("ai-price-suggest", ctxA, { id: l.id });
    assert.equal(r2.ok, true);
    assert.equal(r2.result.comparableCount, 2);
    assert.ok(r2.result.suggestion.competitive > 0);
  });
});

describe("marketplace — dashboard summary", () => {
  it("aggregates listings + orders + promos", () => {
    const l1 = call("listings-create", ctxA, { title: "A", priceUsd: 10 }).result.listing;
    const l2 = call("listings-create", ctxA, { title: "B", priceUsd: 20 }).result.listing;
    call("listings-publish", ctxA, { id: l1.id });
    call("orders-create", ctxA, { listingId: l1.id });
    call("promotions-create", ctxA, { code: "X10", kind: "percent", amount: 10 });
    const r = call("dashboard-summary", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.listingCount, 2);
    assert.equal(r.result.publishedCount, 1);
    assert.equal(r.result.draftCount, 1);
    assert.equal(r.result.orderCount, 1);
    assert.equal(r.result.lifetimeRevenueUsd, 10);
    assert.equal(r.result.activePromos, 1);
    void l2;
  });
});
