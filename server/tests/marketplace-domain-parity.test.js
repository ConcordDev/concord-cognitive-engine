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

// ════════════════════════════════════════════════════════════════
//  Etsy seller-surface parity backlog — storefront, reviews,
//  messaging, variations, shipping, coupons, inventory, checkout.
// ════════════════════════════════════════════════════════════════

describe("marketplace — buyer-facing storefront (item 1)", () => {
  it("storefront-browse aggregates only published listings across sellers", () => {
    const a = call("listings-create", ctxA, { title: "Alice mug", priceUsd: 18, kind: "physical_good" }).result.listing;
    call("listings-publish", ctxA, { id: a.id });
    const aDraft = call("listings-create", ctxA, { title: "Alice draft", priceUsd: 9 }).result.listing;
    const b = call("listings-create", ctxB, { title: "Bob print", priceUsd: 40, kind: "merch_print" }).result.listing;
    call("listings-publish", ctxB, { id: b.id });
    const r = call("storefront-browse", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.ok(r.result.listings.every(l => l.title !== "Alice draft"));
    assert.ok(r.result.categories.includes("physical_good"));
    void aDraft;
  });

  it("storefront-browse honours search + price filters + sort", () => {
    const cheap = call("listings-create", ctxA, { title: "Cheap ring", priceUsd: 5 }).result.listing;
    const dear = call("listings-create", ctxA, { title: "Dear ring", priceUsd: 200 }).result.listing;
    call("listings-publish", ctxA, { id: cheap.id });
    call("listings-publish", ctxA, { id: dear.id });
    const filtered = call("storefront-browse", ctxA, { search: "ring", minPrice: 100, sort: "price_asc" });
    assert.equal(filtered.result.total, 1);
    assert.equal(filtered.result.listings[0].title, "Dear ring");
  });

  it("storefront-shop returns one seller's public catalog", () => {
    call("shop-get", ctxA);
    const l = call("listings-create", ctxA, { title: "Featured", priceUsd: 30 }).result.listing;
    call("listings-publish", ctxA, { id: l.id });
    const r = call("storefront-shop", ctxA, { sellerId: "seller_a" });
    assert.equal(r.ok, true);
    assert.equal(r.result.listingCount, 1);
    assert.equal(r.result.shop.id ? true : false, true);
  });
});

describe("marketplace — reviews & ratings (item 2)", () => {
  it("reviews-create + list computes avg + distribution", () => {
    const l = call("listings-create", ctxA, { title: "Reviewed", priceUsd: 12 }).result.listing;
    call("listings-publish", ctxA, { id: l.id });
    const r1 = call("reviews-create", ctxB, { sellerId: "seller_a", targetType: "listing", targetId: l.id, rating: 5, body: "Great" });
    assert.equal(r1.ok, true);
    const r2 = call("reviews-create", { actor: { userId: "buyer_c" }, userId: "buyer_c" }, { sellerId: "seller_a", targetType: "listing", targetId: l.id, rating: 3, body: "Okay" });
    assert.equal(r2.ok, true);
    const list = call("reviews-list", ctxA, { sellerId: "seller_a" });
    assert.equal(list.result.count, 2);
    assert.equal(list.result.avgRating, 4);
    assert.equal(list.result.distribution["5"], 1);
    assert.equal(list.result.distribution["3"], 1);
  });

  it("reviews-create rejects out-of-range rating + duplicate review", () => {
    const l = call("listings-create", ctxA, { title: "X", priceUsd: 5 }).result.listing;
    call("listings-publish", ctxA, { id: l.id });
    const bad = call("reviews-create", ctxB, { sellerId: "seller_a", targetType: "listing", targetId: l.id, rating: 9, body: "x" });
    assert.equal(bad.ok, false);
    call("reviews-create", ctxB, { sellerId: "seller_a", targetType: "shop", rating: 4, body: "good shop" });
    const dup = call("reviews-create", ctxB, { sellerId: "seller_a", targetType: "shop", rating: 5, body: "again" });
    assert.equal(dup.ok, false);
  });

  it("reviews-reply attaches a seller response", () => {
    call("reviews-create", ctxB, { sellerId: "seller_a", targetType: "shop", rating: 4, body: "nice" });
    const rev = call("reviews-list", ctxA).result.reviews[0];
    const r = call("reviews-reply", ctxA, { id: rev.id, reply: "Thank you!" });
    assert.equal(r.ok, true);
    assert.equal(r.result.review.sellerReply, "Thank you!");
  });
});

describe("marketplace — messaging threads (item 3)", () => {
  it("messages-thread-open creates a thread + messages-send appends", () => {
    const open = call("messages-thread-open", ctxA, { subject: "Hello" });
    assert.equal(open.ok, true);
    const id = open.result.thread.id;
    const sent = call("messages-send", ctxA, { id, text: "Hi there", from: "seller" });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.thread.messages.length, 1);
    assert.equal(sent.result.thread.messages[0].from, "seller");
  });

  it("messages-threads lists threads with unread flag from buyer messages", () => {
    const open = call("messages-thread-open", ctxA, { subject: "Order question" });
    call("messages-send", ctxA, { id: open.result.thread.id, text: "Where is my order?", from: "buyer" });
    const list = call("messages-threads", ctxA);
    assert.equal(list.ok, true);
    const t = list.result.threads.find(x => x.id === open.result.thread.id);
    assert.equal(t.unread, true);
    assert.equal(t.messageCount, 1);
  });

  it("messages-thread-open binds to an order", () => {
    const l = call("listings-create", ctxA, { title: "X", priceUsd: 10 }).result.listing;
    call("listings-publish", ctxA, { id: l.id });
    const o = call("orders-create", ctxA, { listingId: l.id, buyerName: "Bob" }).result.order;
    const r = call("messages-thread-open", ctxA, { orderId: o.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.thread.orderId, o.id);
  });
});

describe("marketplace — listing variations (item 4)", () => {
  it("variations-set persists + variations-list round-trips", () => {
    const l = call("listings-create", ctxA, { title: "Shirt", priceUsd: 25, kind: "merch_apparel" }).result.listing;
    const r = call("variations-set", ctxA, { listingId: l.id, variations: [
      { optionName: "Size", optionValue: "S", priceUsd: 25, stockQty: 4 },
      { optionName: "Size", optionValue: "L", priceUsd: 28, stockQty: 2 },
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.result.variations.length, 2);
    const list = call("variations-list", ctxA, { listingId: l.id });
    assert.equal(list.result.variations.length, 2);
    assert.equal(list.result.variations[1].optionValue, "L");
  });

  it("variations-set rejects unknown listing", () => {
    const r = call("variations-set", ctxA, { listingId: "nope", variations: [] });
    assert.equal(r.ok, false);
  });
});

describe("marketplace — shipping profiles (item 5)", () => {
  it("shipping-profiles-save creates + list + delete", () => {
    const r = call("shipping-profiles-save", ctxA, { name: "Standard", originCountry: "US", processingDaysMin: 1, processingDaysMax: 3, zones: [
      { region: "Domestic", rateUsd: 5, additionalItemUsd: 2 },
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.result.profile.zones.length, 1);
    const list = call("shipping-profiles-list", ctxA);
    assert.equal(list.result.profiles.length, 1);
    const del = call("shipping-profiles-delete", ctxA, { id: r.result.profile.id });
    assert.equal(del.result.deleted, true);
    assert.equal(call("shipping-profiles-list", ctxA).result.profiles.length, 0);
  });

  it("shipping-profiles-save edits an existing profile by id", () => {
    const created = call("shipping-profiles-save", ctxA, { name: "Express" }).result.profile;
    const edited = call("shipping-profiles-save", ctxA, { id: created.id, name: "Express Plus" });
    assert.equal(edited.ok, true);
    assert.equal(edited.result.profile.name, "Express Plus");
  });

  it("shipping-profiles-save requires a name", () => {
    const r = call("shipping-profiles-save", ctxA, {});
    assert.equal(r.ok, false);
  });
});

describe("marketplace — coupons / sales events (item 6)", () => {
  it("coupons-create tiered + coupons-apply picks the right tier", () => {
    const r = call("coupons-create", ctxA, { code: "tiered1", kind: "tiered", tiers: [
      { minSpendUsd: 50, percentOff: 10 },
      { minSpendUsd: 100, percentOff: 20 },
    ] });
    assert.equal(r.ok, true);
    const apply = call("coupons-apply", ctxA, { sellerId: "seller_a", code: "TIERED1", subtotalUsd: 120, qty: 1 });
    assert.equal(apply.ok, true);
    assert.equal(apply.result.discountUsd, 24);
    assert.equal(apply.result.totalAfterDiscountUsd, 96);
  });

  it("coupons-create bogo + apply computes free units", () => {
    call("coupons-create", ctxA, { code: "bogo1", kind: "bogo", buyQty: 1, getQty: 1 });
    const apply = call("coupons-apply", ctxA, { sellerId: "seller_a", code: "BOGO1", subtotalUsd: 40, qty: 4, unitPriceUsd: 10 });
    assert.equal(apply.ok, true);
    assert.equal(apply.result.discountUsd, 20);
  });

  it("coupons-toggle pauses + apply rejects inactive code", () => {
    const c = call("coupons-create", ctxA, { code: "pct1", kind: "percent", amount: 15 }).result.coupon;
    call("coupons-toggle", ctxA, { id: c.id });
    const apply = call("coupons-apply", ctxA, { sellerId: "seller_a", code: "PCT1", subtotalUsd: 100 });
    assert.equal(apply.ok, false);
    const list = call("coupons-list", ctxA);
    assert.equal(list.result.coupons[0].active, false);
  });

  it("coupons-delete removes the coupon", () => {
    const c = call("coupons-create", ctxA, { code: "del1", kind: "fixed", amount: 5 }).result.coupon;
    assert.equal(call("coupons-delete", ctxA, { id: c.id }).result.deleted, true);
    assert.equal(call("coupons-list", ctxA).result.coupons.length, 0);
  });
});

describe("marketplace — inventory alerts (item 7)", () => {
  it("inventory-alerts flags out-of-stock + low-stock listings", () => {
    const out = call("listings-create", ctxA, { title: "Sold out", priceUsd: 10, kind: "physical_good", stockQty: 0 }).result.listing;
    const low = call("listings-create", ctxA, { title: "Running low", priceUsd: 10, kind: "physical_good", stockQty: 2 }).result.listing;
    const fine = call("listings-create", ctxA, { title: "Plenty", priceUsd: 10, kind: "physical_good", stockQty: 50 }).result.listing;
    const r = call("inventory-alerts", ctxA, { lowStockThreshold: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.result.outOfStock, 1);
    assert.equal(r.result.lowStock, 1);
    assert.ok(r.result.alerts.some(a => a.listingId === out.id && a.level === "out_of_stock"));
    assert.ok(r.result.alerts.some(a => a.listingId === low.id && a.level === "low_stock"));
    assert.ok(!r.result.alerts.some(a => a.listingId === fine.id));
  });

  it("inventory-alerts includes variation stock", () => {
    const l = call("listings-create", ctxA, { title: "Variant listing", priceUsd: 20, kind: "merch_apparel" }).result.listing;
    call("variations-set", ctxA, { listingId: l.id, variations: [
      { optionName: "Size", optionValue: "S", priceUsd: 20, stockQty: 0 },
    ] });
    const r = call("inventory-alerts", ctxA, { lowStockThreshold: 3 });
    assert.ok(r.result.alerts.some(a => a.scope === "variation" && a.level === "out_of_stock"));
  });
});

describe("marketplace — cart & checkout (item 8)", () => {
  it("cart-add + cart-get + cart-update flow", () => {
    const l = call("listings-create", ctxB, { title: "Cartable", priceUsd: 15, kind: "physical_good", stockQty: 10 }).result.listing;
    call("listings-publish", ctxB, { id: l.id });
    const add = call("cart-add", ctxA, { sellerId: "seller_b", listingId: l.id, qty: 2 });
    assert.equal(add.ok, true);
    const cart = call("cart-get", ctxA);
    assert.equal(cart.result.itemCount, 2);
    const lineId = cart.result.shops[0].lines[0].id;
    call("cart-update", ctxA, { lineId, qty: 5 });
    assert.equal(call("cart-get", ctxA).result.itemCount, 5);
    call("cart-update", ctxA, { lineId, remove: true });
    assert.equal(call("cart-get", ctxA).result.itemCount, 0);
  });

  it("checkout-create places per-shop orders + decrements stock + clears cart", () => {
    const l = call("listings-create", ctxB, { title: "Buyable", priceUsd: 30, kind: "physical_good", stockQty: 8 }).result.listing;
    call("listings-publish", ctxB, { id: l.id });
    call("cart-add", ctxA, { sellerId: "seller_b", listingId: l.id, qty: 3 });
    const co = call("checkout-create", ctxA, { buyerName: "Alice", buyerEmail: "a@x.com" });
    assert.equal(co.ok, true);
    assert.equal(co.result.checkout.orders.length, 1);
    assert.equal(co.result.checkout.grandTotalUsd, 90);
    // stock decremented on seller listing
    const after = call("listings-list", ctxB).result.listings.find(x => x.id === l.id);
    assert.equal(after.stockQty, 5);
    // cart cleared
    assert.equal(call("cart-get", ctxA).result.itemCount, 0);
    // checkout recorded in buyer history
    assert.equal(call("checkout-history", ctxA).result.checkouts.length, 1);
  });

  it("checkout-create applies a per-seller coupon", () => {
    const l = call("listings-create", ctxB, { title: "Discounted", priceUsd: 100, kind: "physical_good", stockQty: 5 }).result.listing;
    call("listings-publish", ctxB, { id: l.id });
    call("coupons-create", ctxB, { code: "save20", kind: "percent", amount: 20 });
    call("cart-add", ctxA, { sellerId: "seller_b", listingId: l.id, qty: 1 });
    const co = call("checkout-create", ctxA, { coupons: { seller_b: "SAVE20" } });
    assert.equal(co.ok, true);
    assert.equal(co.result.checkout.grandTotalUsd, 80);
  });

  it("checkout-create rejects an empty cart", () => {
    const r = call("checkout-create", ctxA, {});
    assert.equal(r.ok, false);
  });
});
