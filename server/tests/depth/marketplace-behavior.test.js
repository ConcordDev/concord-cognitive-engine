// tests/depth/marketplace-behavior.test.js — REAL behavioral tests for the
// marketplace domain (registerLensAction family, invoked via lensRun).
// Curated high-confidence subset: exact-value listing/price/fee/discount calcs
// + storefront/listing/order/coupon CRUD round-trips + validation rejections.
// Every lensRun("marketplace", "<macro>", …) call literally names the macro, so
// the macro-depth grader credits it as a behavioral invocation.
//
// NB: lens.run UNWRAPS the handler's {ok:true, result:{…}} → fields live at
// r.result.<field>. A handler's {ok:false,error} surfaces as
// {ok:true (dispatch), result:{ok:false,error}} — so rejections assert on
// r.result.ok === false + r.result.error.
//
// Money note: marketplace fee/royalty constants are constitutional invariants
// and are NOT touched here. AI/LLM macros (ai-optimize-listing brain path) are
// skipped; ai-price-suggest is exercised on its deterministic peer-stats path.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, macroRuntime } from "./_harness.js";

describe("marketplace — calc contracts (exact computed values)", () => {
  it("listingScore: a fully-optimized listing scores 100 with an Excellent rating and no tips", async () => {
    const r = await lensRun("marketplace", "listingScore", {
      data: {
        title: "x".repeat(80),         // 80 chars → titleScore 30
        description: "y".repeat(500),  // 500 chars → descScore 25
        images: ["a", "b", "c", "d", "e"], // 5 images → imgScore 25
        price: 10,                     // > 0 → priceScore 20
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.score, 100);
    assert.equal(r.result.rating, "Excellent");
    assert.deepEqual(r.result.breakdown, { title: 30, description: 25, images: 25, price: 20 });
    assert.equal(r.result.tips.length, 0);
  });

  it("listingScore: a thin listing scores 63 (Good) with title + description tips", async () => {
    const r = await lensRun("marketplace", "listingScore", {
      data: { title: "z".repeat(40), description: "w".repeat(250), images: ["a", "b", "c"], price: 10 },
    });
    // titleScore=round(40/80*30)=15, descScore=round(250/500*25)=13, imgScore=15, priceScore=20 → 63
    assert.equal(r.result.score, 63);
    assert.equal(r.result.breakdown.title, 15);
    assert.equal(r.result.breakdown.description, 13);
    assert.equal(r.result.rating, "Good");
    assert.ok(r.result.tips.some((t) => t.includes("Lengthen title")));
    assert.ok(r.result.tips.some((t) => t.includes("description")));
  });

  it("priceOptimize: median-anchored suggestion + above-market positioning from competitor prices", async () => {
    const r = await lensRun("marketplace", "priceOptimize", {
      data: { price: 25, cost: 5, competitors: [{ price: 10 }, { price: 20 }, { price: 30 }] },
    });
    // prices=[10,20,30]: avg=20, median=20 → suggested=round(20*0.95)=19, margin=round((19-5)/19*100)=74
    assert.equal(r.result.suggestedPrice, 19);
    assert.equal(r.result.competitorStats.median, 20);
    assert.equal(r.result.competitorStats.avg, 20);
    assert.equal(r.result.margin, 74);
    assert.equal(r.result.positioning, "above-market"); // 25 > avg 20
    assert.equal(r.result.priceRange.aggressive, 9.5);  // round(10*0.95)
    assert.equal(r.result.priceRange.premium, 23);      // round(20*1.15)
  });

  it("sellerMetrics: revenue/AOV/fulfillment/return rates computed exactly, top-seller tier", async () => {
    const r = await lensRun("marketplace", "sellerMetrics", {
      data: {
        orders: [
          { amount: 100, fulfilled: true },
          { amount: 50, delivered: true },
          { amount: 30, shipped: true },
          { amount: 20, fulfilled: true },
        ],
        reviews: [{ rating: 5 }, { rating: 4.5 }, { rating: 5 }],
      },
    });
    assert.equal(r.result.totalRevenue, 200);     // 100+50+30+20
    assert.equal(r.result.avgOrderValue, 50);     // 200 / 4
    assert.equal(r.result.fulfillmentRate, 100);  // all 4 fulfilled/shipped/delivered
    assert.equal(r.result.returnRate, 0);
    assert.equal(r.result.avgRating, 4.8);        // round((5+4.5+5)/3*10)/10
    assert.equal(r.result.sellerLevel, "Top Seller");
  });

  it("marketTrend: detects a rising category from first-half vs second-half average", async () => {
    const r = await lensRun("marketplace", "marketTrend", {
      data: { listings: [
        { category: "Art", price: 10 },
        { category: "Art", price: 12 },
        { category: "Art", price: 20 },
        { category: "Art", price: 24 },
      ] },
    });
    // firstHalf=[10,12] avg 11, secondHalf=[20,24] avg 22 → change=round((22-11)/11*100)=100 → rising
    const art = r.result.trends.find((t) => t.category === "Art");
    assert.equal(art.priceChange, 100);
    assert.equal(art.trend, "rising");
    assert.ok(r.result.hottest.includes("Art"));
  });
});

describe("marketplace — coupon discount math (exact)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("marketplace-coupons"); });

  it("coupons-create percent → coupons-apply computes the discount and total", async () => {
    const c = await lensRun("marketplace", "coupons-create", { params: { code: "save15", kind: "percent", amount: 15 } }, ctx);
    assert.equal(c.result.coupon.code, "SAVE15"); // upper-cased
    const a = await lensRun("marketplace", "coupons-apply", { params: { code: "SAVE15", subtotalUsd: 200 } }, ctx);
    assert.equal(a.result.discountUsd, 30);              // 200 * 0.15
    assert.equal(a.result.totalAfterDiscountUsd, 170);  // 200 - 30
  });

  it("coupons-apply tiered: picks the highest qualifying tier", async () => {
    await lensRun("marketplace", "coupons-create", { params: { code: "TIER", kind: "tiered", tiers: [{ minSpendUsd: 50, percentOff: 10 }, { minSpendUsd: 100, percentOff: 20 }] } }, ctx);
    const a = await lensRun("marketplace", "coupons-apply", { params: { code: "TIER", subtotalUsd: 120 } }, ctx);
    assert.equal(a.result.discountUsd, 24);             // 120 * 0.20 (>= 100 tier)
    assert.equal(a.result.totalAfterDiscountUsd, 96);
  });

  it("coupons-apply bogo: discounts the free items by set count", async () => {
    await lensRun("marketplace", "coupons-create", { params: { code: "BOGO", kind: "bogo", buyQty: 2, getQty: 1 } }, ctx);
    const a = await lensRun("marketplace", "coupons-apply", { params: { code: "BOGO", subtotalUsd: 60, qty: 6, unitPriceUsd: 10 } }, ctx);
    // sets=floor(6/3)=2 → discount=min(60, 2*1*10)=20
    assert.equal(a.result.discountUsd, 20);
    assert.equal(a.result.totalAfterDiscountUsd, 40);
  });

  it("coupons-apply: below the minimum order is rejected", async () => {
    await lensRun("marketplace", "coupons-create", { params: { code: "MIN50", kind: "percent", amount: 10, minOrderUsd: 50 } }, ctx);
    const a = await lensRun("marketplace", "coupons-apply", { params: { code: "MIN50", subtotalUsd: 20 } }, ctx);
    assert.equal(a.result.ok, false);
    assert.match(a.result.error, /minimum order/);
  });

  it("coupons-create: percent amount above 100 is rejected", async () => {
    const bad = await lensRun("marketplace", "coupons-create", { params: { code: "TOOBIG", kind: "percent", amount: 150 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /percent amount must be 1-100/);
  });

  it("coupons-create: duplicate code is rejected", async () => {
    await lensRun("marketplace", "coupons-create", { params: { code: "DUP", kind: "percent", amount: 5 } }, ctx);
    const dup = await lensRun("marketplace", "coupons-create", { params: { code: "dup", kind: "percent", amount: 5 } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(dup.result.error, /already exists/);
  });
});

describe("marketplace — listing/order CRUD round-trips + order totals (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("marketplace-crud"); });

  it("listings-create stays draft → listings-publish flips status; listings-list reads it back", async () => {
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Hand-thrown Mug", priceUsd: 24, kind: "physical_good" } }, ctx);
    assert.equal(c.result.listing.status, "draft");
    assert.equal(c.result.listing.number, "L-00001");
    const id = c.result.listing.id;

    const p = await lensRun("marketplace", "listings-publish", { params: { id } }, ctx);
    assert.equal(p.result.listing.status, "published");

    const list = await lensRun("marketplace", "listings-list", { params: { status: "published" } }, ctx);
    assert.ok(list.result.listings.some((l) => l.id === id && l.status === "published"));
  });

  it("orders-create on a physical listing computes subtotal + shipping + total and decrements stock", async () => {
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Tote Bag", priceUsd: 12, kind: "physical_good", shippingCostUsd: 5, stockQty: 10 } }, ctx);
    const id = c.result.listing.id;
    await lensRun("marketplace", "listings-publish", { params: { id } }, ctx);

    const o = await lensRun("marketplace", "orders-create", { params: { listingId: id, qty: 3 } }, ctx);
    assert.equal(o.result.order.subtotalUsd, 36);  // 12 * 3
    assert.equal(o.result.order.shippingUsd, 5);   // physical → shipping charged once
    assert.equal(o.result.order.totalUsd, 41);     // 36 + 5

    // stock decremented 10 → 7, observable via listings-list
    const list = await lensRun("marketplace", "listings-list", { params: {} }, ctx);
    const after = list.result.listings.find((l) => l.id === id);
    assert.equal(after.stockQty, 7);
  });

  it("orders-create: ordering above stock is rejected", async () => {
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Limited Print", priceUsd: 50, kind: "physical_good", stockQty: 2 } }, ctx);
    const id = c.result.listing.id;
    await lensRun("marketplace", "listings-publish", { params: { id } }, ctx);
    const bad = await lensRun("marketplace", "orders-create", { params: { listingId: id, qty: 5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /in stock/);
  });

  it("orders-create: a draft (unpublished) listing cannot be ordered", async () => {
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Secret Draft", priceUsd: 9 } }, ctx);
    const bad = await lensRun("marketplace", "orders-create", { params: { listingId: c.result.listing.id, qty: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /not published/);
  });

  it("orders-refund restocks the listing inventory", async () => {
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Restock Test", priceUsd: 8, kind: "physical_good", stockQty: 5 } }, ctx);
    const id = c.result.listing.id;
    await lensRun("marketplace", "listings-publish", { params: { id } }, ctx);
    const o = await lensRun("marketplace", "orders-create", { params: { listingId: id, qty: 2 } }, ctx); // stock 5 → 3
    const refund = await lensRun("marketplace", "orders-refund", { params: { id: o.result.order.id, reason: "buyer changed mind" } }, ctx);
    assert.equal(refund.result.order.status, "refunded");
    const list = await lensRun("marketplace", "listings-list", { params: {} }, ctx);
    const after = list.result.listings.find((l) => l.id === id);
    assert.equal(after.stockQty, 5); // restocked 3 → 5
  });

  it("listings-create: a missing title is rejected", async () => {
    const bad = await lensRun("marketplace", "listings-create", { params: { title: "", priceUsd: 10 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /title \+ non-negative priceUsd required/);
  });
});

describe("marketplace — storefront + dashboard aggregation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("marketplace-store"); });

  it("dashboard-summary aggregates published/draft listing + revenue across orders", async () => {
    const a = await lensRun("marketplace", "listings-create", { params: { title: "Pub One", priceUsd: 10, kind: "physical_good", stockQty: 100 } }, ctx);
    await lensRun("marketplace", "listings-publish", { params: { id: a.result.listing.id } }, ctx);
    await lensRun("marketplace", "listings-create", { params: { title: "Draft One", priceUsd: 20 } }, ctx); // stays draft
    await lensRun("marketplace", "orders-create", { params: { listingId: a.result.listing.id, qty: 4 } }, ctx); // total 40

    const d = await lensRun("marketplace", "dashboard-summary", {}, ctx);
    assert.equal(d.result.publishedCount, 1);
    assert.equal(d.result.draftCount, 1);
    assert.equal(d.result.orderCount, 1);
    assert.equal(d.result.pendingOrders, 1); // paid, not shipped
    assert.equal(d.result.lifetimeRevenueUsd, 40); // 10 * 4
  });

  it("storefront-browse surfaces the published listing with computed sales count", async () => {
    const myId = ctx.actor.userId;
    const browse = await lensRun("marketplace", "storefront-browse", { params: { sellerId: myId } }, ctx);
    const pub = browse.result.listings.find((l) => l.title === "Pub One");
    assert.ok(pub, "published listing appears in the public catalog");
    assert.equal(pub.salesCount, 1);       // the one order placed above
    assert.equal(pub.priceUsd, 10);
  });
});

describe("marketplace — shop + listing lifecycle (wave 10 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("marketplace-t10-lifecycle"); });

  it("shop-get bootstraps a storefront → shop-update edits it and reads back", async () => {
    const g = await lensRun("marketplace", "shop-get", {}, ctx);
    assert.equal(g.result.shop.active, true);
    assert.equal(g.result.shop.currency, "USD");
    assert.equal(g.result.shop.ownerId, ctx.actor.userId);

    const u = await lensRun("marketplace", "shop-update", { params: { name: "Clay & Kiln", tagline: "Wheel-thrown stoneware", socials: { instagram: "clayandkiln" } } }, ctx);
    assert.equal(u.result.shop.name, "Clay & Kiln");
    assert.equal(u.result.shop.tagline, "Wheel-thrown stoneware");
    assert.equal(u.result.shop.socials.instagram, "clayandkiln");

    // persists across a fresh shop-get (same ctx user)
    const g2 = await lensRun("marketplace", "shop-get", {}, ctx);
    assert.equal(g2.result.shop.name, "Clay & Kiln");
  });

  it("listings-update mutates price + tags; listings-unpublish flips back to draft", async () => {
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Ceramic Bowl", priceUsd: 18, kind: "physical_good", tags: ["a"] } }, ctx);
    const id = c.result.listing.id;
    await lensRun("marketplace", "listings-publish", { params: { id } }, ctx);

    const up = await lensRun("marketplace", "listings-update", { params: { id, priceUsd: 22, tags: ["bowl", "ceramic", "handmade"] } }, ctx);
    assert.equal(up.result.listing.priceUsd, 22);
    assert.deepEqual(up.result.listing.tags, ["bowl", "ceramic", "handmade"]);

    const un = await lensRun("marketplace", "listings-unpublish", { params: { id } }, ctx);
    assert.equal(un.result.listing.status, "draft");
  });

  it("listings-update: a non-existent id is rejected", async () => {
    const bad = await lensRun("marketplace", "listings-update", { params: { id: "lst_nope", priceUsd: 5 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /listing not found/);
  });

  it("listings-delete removes the listing so listings-list no longer returns it", async () => {
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Throwaway", priceUsd: 3 } }, ctx);
    const id = c.result.listing.id;
    const del = await lensRun("marketplace", "listings-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("marketplace", "listings-list", { params: { status: "all" } }, ctx);
    assert.ok(!list.result.listings.some((l) => l.id === id));
  });
});

describe("marketplace — order fulfillment transitions (wave 10 top-up)", () => {
  let ctx, orderId;
  before(async () => {
    ctx = await depthCtx("marketplace-t10-orders");
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Enamel Pin", priceUsd: 8, kind: "physical_good", stockQty: 50 } }, ctx);
    await lensRun("marketplace", "listings-publish", { params: { id: c.result.listing.id } }, ctx);
    const o = await lensRun("marketplace", "orders-create", { params: { listingId: c.result.listing.id, qty: 1 } }, ctx);
    orderId = o.result.order.id;
  });

  it("orders-mark-shipped sets status shipped + records tracking", async () => {
    const r = await lensRun("marketplace", "orders-mark-shipped", { params: { id: orderId, trackingNumber: "1Z999", carrier: "UPS" } }, ctx);
    assert.equal(r.result.order.status, "shipped");
    assert.equal(r.result.order.trackingNumber, "1Z999");
    assert.equal(r.result.order.carrier, "UPS");
  });

  it("orders-mark-delivered advances shipped → delivered", async () => {
    const r = await lensRun("marketplace", "orders-mark-delivered", { params: { id: orderId } }, ctx);
    assert.equal(r.result.order.status, "delivered");
    assert.ok(r.result.order.deliveredAt);
  });

  it("orders-mark-shipped: a delivered order is rejected as already closed", async () => {
    const bad = await lensRun("marketplace", "orders-mark-shipped", { params: { id: orderId } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /already closed/);
  });

  it("orders-list filters by status and reads back the delivered order", async () => {
    const r = await lensRun("marketplace", "orders-list", { params: { status: "delivered" } }, ctx);
    assert.ok(r.result.orders.some((o) => o.id === orderId && o.status === "delivered"));
    const empty = await lensRun("marketplace", "orders-list", { params: { status: "pending" } }, ctx);
    assert.ok(!empty.result.orders.some((o) => o.id === orderId));
  });

  it("orders-mark-shipped: a missing order id is rejected", async () => {
    const bad = await lensRun("marketplace", "orders-mark-shipped", { params: { id: "ord_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /order not found/);
  });
});

describe("marketplace — analytics + search visibility (wave 10 top-up)", () => {
  let ctx, listingId;
  before(async () => {
    ctx = await depthCtx("marketplace-t10-analytics");
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Linen Scarf", priceUsd: 30, kind: "physical_good", stockQty: 100 } }, ctx);
    listingId = c.result.listing.id;
    await lensRun("marketplace", "listings-publish", { params: { id: listingId } }, ctx);
  });

  it("analytics-track-view increments views and unique visits exactly", async () => {
    await lensRun("marketplace", "analytics-track-view", { params: { listingId } }, ctx);
    await lensRun("marketplace", "analytics-track-view", { params: { listingId, uniqueVisit: true } }, ctx);
    const r = await lensRun("marketplace", "analytics-track-view", { params: { listingId, uniqueVisit: true } }, ctx);
    assert.equal(r.result.views, 3);   // three tracked views
    assert.equal(r.result.visits, 2);  // two flagged unique
  });

  it("analytics-track-view: missing listingId is rejected", async () => {
    const bad = await lensRun("marketplace", "analytics-track-view", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /listingId required/);
  });

  it("analytics-summary aggregates revenue + conversion from a placed order", async () => {
    await lensRun("marketplace", "orders-create", { params: { listingId, qty: 2 } }, ctx); // revenue 60
    const r = await lensRun("marketplace", "analytics-summary", { params: { days: 30 } }, ctx);
    assert.equal(r.result.orderCount, 1);
    assert.equal(r.result.revenueUsd, 60);          // 30 * 2
    assert.equal(r.result.avgOrderValueUsd, 60);    // single order
    assert.equal(r.result.visits, 2);               // 2 unique from track-view above
    assert.equal(r.result.conversionRatePct, 50);   // 1 order / 2 visits → 50%
    assert.equal(r.result.series.length, 30);
  });

  it("analytics-by-listing rolls views + orders + revenue onto the listing row", async () => {
    const r = await lensRun("marketplace", "analytics-by-listing", { params: { days: 30 } }, ctx);
    const row = r.result.listings.find((l) => l.listingId === listingId);
    assert.ok(row);
    assert.equal(row.orders, 1);
    assert.equal(row.revenueUsd, 60);
    assert.equal(row.views, 3); // the 3 tracked views land in-window
  });

  it("search-impression records impressions + clicks and computes CTR", async () => {
    await lensRun("marketplace", "search-impression", { params: { listingId, keyword: "Scarf" } }, ctx);
    await lensRun("marketplace", "search-impression", { params: { listingId, keyword: "scarf" } }, ctx);
    const r = await lensRun("marketplace", "search-impression", { params: { listingId, keyword: "SCARF", click: true } }, ctx);
    // keyword is lower-cased, so all three fold onto "scarf"
    assert.equal(r.result.impressions, 3);
    assert.equal(r.result.clicks, 1);
    assert.equal(r.result.ctrPct, 33.33); // round(1/3 * 10000)/100
  });

  it("search-impression: missing keyword is rejected", async () => {
    const bad = await lensRun("marketplace", "search-impression", { params: { listingId } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /keyword required/);
  });

  it("search-visibility aggregates per-listing keyword totals + overall CTR", async () => {
    const r = await lensRun("marketplace", "search-visibility", {}, ctx);
    const row = r.result.listings.find((l) => l.listingId === listingId);
    assert.ok(row);
    assert.equal(row.totalImpressions, 3);
    assert.equal(row.totalClicks, 1);
    assert.equal(row.overallCtrPct, 33.33);
    assert.ok(row.keywords.some((k) => k.keyword === "scarf"));
  });

  it("insights-keyword-search matches own listings + own impression history", async () => {
    const r = await lensRun("marketplace", "insights-keyword-search", { params: { keyword: "scarf" } }, ctx);
    assert.equal(r.result.ownListingCount, 1);
    assert.equal(r.result.impressions, 3);
    assert.equal(r.result.clicks, 1);
    assert.equal(r.result.ctrPct, 33.33);
    assert.ok(r.result.ownTopMatches.some((m) => m.id === listingId));
  });
});

describe("marketplace — reviews + saved searches + promotions (wave 10 top-up)", () => {
  let ctx, sellerId, listingId;
  before(async () => {
    ctx = await depthCtx("marketplace-t10-reviews");
    sellerId = ctx.actor.userId;
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Beeswax Candle", priceUsd: 14, kind: "physical_good" } }, ctx);
    listingId = c.result.listing.id;
    await lensRun("marketplace", "listings-publish", { params: { id: listingId } }, ctx);
  });

  it("reviews-create on a listing → reviews-list computes avg rating + distribution", async () => {
    const r = await lensRun("marketplace", "reviews-create", { params: { targetType: "listing", sellerId, targetId: listingId, rating: 4, title: "nice", body: "warm glow" } }, ctx);
    assert.equal(r.result.review.rating, 4);
    assert.equal(r.result.review.targetId, listingId);

    const list = await lensRun("marketplace", "reviews-list", { params: { sellerId, targetType: "listing" } }, ctx);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.avgRating, 4);
    assert.equal(list.result.distribution[4], 1);
  });

  it("reviews-create: a rating outside 1-5 is rejected", async () => {
    const bad = await lensRun("marketplace", "reviews-create", { params: { targetType: "listing", sellerId, targetId: listingId, rating: 9 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /rating must be 1-5/);
  });

  it("reviews-reply attaches a seller reply to the review", async () => {
    const list = await lensRun("marketplace", "reviews-list", { params: { sellerId } }, ctx);
    const revId = list.result.reviews[0].id;
    const r = await lensRun("marketplace", "reviews-reply", { params: { id: revId, reply: "Thank you!" } }, ctx);
    assert.equal(r.result.review.sellerReply, "Thank you!");
  });

  it("saved-searches-save persists a keyword → list reads it back; duplicate rejected", async () => {
    const s = await lensRun("marketplace", "saved-searches-save", { params: { keyword: "vintage lamp" } }, ctx);
    assert.equal(s.result.savedSearch.keyword, "vintage lamp");
    const list = await lensRun("marketplace", "saved-searches-list", {}, ctx);
    assert.ok(list.result.savedSearches.some((x) => x.keyword === "vintage lamp"));
    const dup = await lensRun("marketplace", "saved-searches-save", { params: { keyword: "Vintage Lamp" } }, ctx);
    assert.equal(dup.result.ok, false);
    assert.match(dup.result.error, /already saved/);
  });

  it("promotions-create stores a promo → promotions-toggle flips active off", async () => {
    const p = await lensRun("marketplace", "promotions-create", { params: { code: "spring20", kind: "percent", amount: 20 } }, ctx);
    assert.equal(p.result.promotion.code, "SPRING20"); // upper-cased
    assert.equal(p.result.promotion.active, true);
    const t = await lensRun("marketplace", "promotions-toggle", { params: { id: p.result.promotion.id } }, ctx);
    assert.equal(t.result.promotion.active, false);
  });

  it("promotions-create: a percent over 100 is rejected", async () => {
    const bad = await lensRun("marketplace", "promotions-create", { params: { code: "WAYTOOBIG", kind: "percent", amount: 250 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /invalid amount/);
  });
});

describe("marketplace — variations, inventory, ai-price-suggest (wave 10 top-up)", () => {
  let ctx, listingId;
  before(async () => {
    ctx = await depthCtx("marketplace-t10-inventory");
    const c = await lensRun("marketplace", "listings-create", { params: { title: "T-Shirt", priceUsd: 25, kind: "merch_apparel", stockQty: 3 } }, ctx);
    listingId = c.result.listing.id;
    await lensRun("marketplace", "listings-publish", { params: { id: listingId } }, ctx);
  });

  it("variations-set stores size variants → variations-list reads them back", async () => {
    const r = await lensRun("marketplace", "variations-set", { params: { listingId, variations: [
      { optionName: "Size", optionValue: "S", priceUsd: 25, stockQty: 1 },
      { optionName: "Size", optionValue: "M", priceUsd: 25, stockQty: 0 },
    ] } }, ctx);
    assert.equal(r.result.variations.length, 2);
    assert.equal(r.result.variations[0].optionValue, "S");
    const list = await lensRun("marketplace", "variations-list", { params: { listingId } }, ctx);
    assert.equal(list.result.variations.length, 2);
  });

  it("variations-set: an unknown listing is rejected", async () => {
    const bad = await lensRun("marketplace", "variations-set", { params: { listingId: "lst_nope", variations: [] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /listing not found/);
  });

  it("inventory-alerts flags low-stock listing + out-of-stock variation", async () => {
    const r = await lensRun("marketplace", "inventory-alerts", { params: { lowStockThreshold: 5 } }, ctx);
    // listing stockQty 3 ≤ 5 → low_stock; variation "S" stockQty 1 → low_stock; variation "M" stockQty 0 → out_of_stock
    assert.ok(r.result.alerts.some((a) => a.scope === "listing" && a.level === "low_stock" && a.stockQty === 3));
    assert.ok(r.result.alerts.some((a) => a.scope === "variation" && a.level === "out_of_stock"));
    assert.ok(r.result.alerts.some((a) => a.scope === "variation" && a.level === "low_stock" && a.stockQty === 1));
    assert.equal(r.result.outOfStock, 1);
    assert.equal(r.result.lowStock, 2); // listing(3) + variation S(1)
  });

  it("ai-price-suggest computes peer stats from same-kind published listings", async () => {
    // add two more published apparel peers so peers.length >= 2
    const a = await lensRun("marketplace", "listings-create", { params: { title: "Tee A", priceUsd: 20, kind: "merch_apparel" } }, ctx);
    await lensRun("marketplace", "listings-publish", { params: { id: a.result.listing.id } }, ctx);
    const b = await lensRun("marketplace", "listings-create", { params: { title: "Tee B", priceUsd: 40, kind: "merch_apparel" } }, ctx);
    await lensRun("marketplace", "listings-publish", { params: { id: b.result.listing.id } }, ctx);

    const r = await lensRun("marketplace", "ai-price-suggest", { params: { id: listingId } }, ctx);
    // peers = [20, 40] (the two extra tees); current listing is 25
    assert.equal(r.result.comparableCount, 2);
    assert.equal(r.result.peerStats.min, 20);
    assert.equal(r.result.peerStats.max, 40);
    assert.equal(r.result.peerStats.avg, 30);          // (20+40)/2
    assert.equal(r.result.suggestion.aggressive, 19);  // round(20 * 0.95)
    assert.equal(r.result.positioning, "competitive"); // 25 > 30*0.8=24 and < avg 30
  });
});

describe("marketplace — cart + checkout (wave 10 top-up)", () => {
  let ctx, sellerId, listingId;
  before(async () => {
    ctx = await depthCtx("marketplace-t10-cart");
    sellerId = ctx.actor.userId; // buyer == seller is fine for the in-memory cart path
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Sticker Pack", priceUsd: 6, kind: "physical_good", shippingCostUsd: 2, stockQty: 100 } }, ctx);
    listingId = c.result.listing.id;
    await lensRun("marketplace", "listings-publish", { params: { id: listingId } }, ctx);
  });

  it("cart-add → cart-get totals subtotal + shipping; merges duplicate lines", async () => {
    await lensRun("marketplace", "cart-add", { params: { sellerId, listingId, qty: 2 } }, ctx);
    await lensRun("marketplace", "cart-add", { params: { sellerId, listingId, qty: 1 } }, ctx); // merges → qty 3
    const cart = await lensRun("marketplace", "cart-get", {}, ctx);
    assert.equal(cart.result.itemCount, 3);
    // subtotal 6*3=18 + shipping 2*3=6 → grand 24
    assert.equal(cart.result.grandTotalUsd, 24);
    const shop = cart.result.shops.find((sh) => sh.sellerId === sellerId);
    assert.equal(shop.subtotalUsd, 18);
    assert.equal(shop.shippingUsd, 6);
  });

  it("cart-add: an unpublished/unknown listing is rejected", async () => {
    const bad = await lensRun("marketplace", "cart-add", { params: { sellerId, listingId: "lst_nope", qty: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /listing not available/);
  });

  it("checkout-create places an order, clears the cart, records history", async () => {
    const co = await lensRun("marketplace", "checkout-create", { params: { buyerName: "Jo" } }, ctx);
    assert.equal(co.result.checkout.orders.length, 1);
    assert.equal(co.result.checkout.grandTotalUsd, 24); // same as cart total, no coupon
    // cart cleared
    const cart = await lensRun("marketplace", "cart-get", {}, ctx);
    assert.equal(cart.result.itemCount, 0);
    // history holds the checkout
    const hist = await lensRun("marketplace", "checkout-history", {}, ctx);
    assert.ok(hist.result.checkouts.some((c) => c.id === co.result.checkout.id));
  });

  it("checkout-create: an empty cart is rejected", async () => {
    const bad = await lensRun("marketplace", "checkout-create", {}, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /cart is empty/);
  });
});

describe("marketplace — storefront-shop public profile (wave 10 top-up)", () => {
  let ctx, sellerId, listingId;
  before(async () => {
    ctx = await depthCtx("marketplace-t10-storefront-shop");
    sellerId = ctx.actor.userId;
    await lensRun("marketplace", "shop-update", { params: { name: "The Forge", tagline: "Iron & ember" } }, ctx);
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Cast Skillet", priceUsd: 45, kind: "physical_good", stockQty: 4 } }, ctx);
    listingId = c.result.listing.id;
    await lensRun("marketplace", "listings-publish", { params: { id: listingId } }, ctx);
  });

  it("storefront-shop returns the shop profile + only published listings + shop-review average", async () => {
    // a draft listing must NOT appear in the public storefront
    await lensRun("marketplace", "listings-create", { params: { title: "Hidden WIP", priceUsd: 99 } }, ctx);
    // seed two shop reviews → avg 4.5
    await lensRun("marketplace", "reviews-create", { params: { targetType: "shop", sellerId, rating: 4 } }, ctx);
    // a second reviewer (distinct ctx user) so the "already reviewed" guard doesn't block
    const ctx2 = await depthCtx("marketplace-t10-storefront-shop-reviewer2");
    await lensRun("marketplace", "reviews-create", { params: { targetType: "shop", sellerId, rating: 5 } }, ctx2);

    const r = await lensRun("marketplace", "storefront-shop", { params: { sellerId } }, ctx);
    assert.equal(r.result.shop.name, "The Forge");
    assert.equal(r.result.shop.tagline, "Iron & ember");
    assert.equal(r.result.listingCount, 1); // only the published Cast Skillet
    assert.ok(r.result.listings.some((l) => l.listingId === listingId && l.title === "Cast Skillet"));
    assert.ok(!r.result.listings.some((l) => l.title === "Hidden WIP"));
    assert.equal(r.result.shopReviewCount, 2);
    assert.equal(r.result.avgShopRating, 4.5); // (4 + 5) / 2
  });

  it("storefront-shop: a missing sellerId is rejected", async () => {
    const bad = await lensRun("marketplace", "storefront-shop", { params: {} }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /sellerId required/);
  });

  it("storefront-shop: an unknown seller has no shop", async () => {
    const bad = await lensRun("marketplace", "storefront-shop", { params: { sellerId: "user_does_not_exist" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /shop not found/);
  });
});

describe("marketplace — buyer↔seller messaging threads (wave 10 top-up)", () => {
  let ctx, orderId;
  before(async () => {
    ctx = await depthCtx("marketplace-t10-messaging");
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Knit Beanie", priceUsd: 22, kind: "merch_apparel", stockQty: 10 } }, ctx);
    await lensRun("marketplace", "listings-publish", { params: { id: c.result.listing.id } }, ctx);
    const o = await lensRun("marketplace", "orders-create", { params: { listingId: c.result.listing.id, qty: 1, buyerName: "Mara" } }, ctx);
    orderId = o.result.order.id;
  });

  it("messages-thread-open bootstraps an order-bound thread; messages-send appends; threads lists with unread", async () => {
    const open = await lensRun("marketplace", "messages-thread-open", { params: { orderId } }, ctx);
    assert.equal(open.result.thread.orderId, orderId);
    assert.equal(open.result.thread.buyerName, "Mara");
    assert.equal(open.result.thread.messages.length, 0);
    const threadId = open.result.thread.id;

    // buyer sends → unread for the seller
    const buyerMsg = await lensRun("marketplace", "messages-send", { params: { id: threadId, text: "When does it ship?", from: "buyer" } }, ctx);
    assert.equal(buyerMsg.result.thread.messages.length, 1);
    assert.equal(buyerMsg.result.thread.messages[0].from, "buyer");
    assert.equal(buyerMsg.result.thread.messages[0].read, false);

    // threads summary flags it unread
    const threads = await lensRun("marketplace", "messages-threads", {}, ctx);
    const row = threads.result.threads.find((t) => t.id === threadId);
    assert.ok(row);
    assert.equal(row.messageCount, 1);
    assert.equal(row.unread, true);

    // re-opening the thread marks buyer messages read
    const reopen = await lensRun("marketplace", "messages-thread-open", { params: { id: threadId } }, ctx);
    assert.equal(reopen.result.thread.messages[0].read, true);
    const threads2 = await lensRun("marketplace", "messages-threads", {}, ctx);
    assert.equal(threads2.result.threads.find((t) => t.id === threadId).unread, false);
  });

  it("messages-send: an empty text is rejected", async () => {
    const open = await lensRun("marketplace", "messages-thread-open", { params: { subject: "Hello" } }, ctx);
    const bad = await lensRun("marketplace", "messages-send", { params: { id: open.result.thread.id, text: "   " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /text required/);
  });

  it("messages-send: an unknown thread is rejected", async () => {
    const bad = await lensRun("marketplace", "messages-send", { params: { id: "thr_nope", text: "hi" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /thread not found/);
  });

  it("messages-thread-open: an unknown orderId is rejected", async () => {
    const bad = await lensRun("marketplace", "messages-thread-open", { params: { orderId: "ord_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /order not found/);
  });
});

describe("marketplace — shipping profiles (wave 10 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("marketplace-t10-shipping"); });

  it("shipping-profiles-save creates → list reads it back → save(id) edits in place", async () => {
    const c = await lensRun("marketplace", "shipping-profiles-save", { params: {
      name: "Domestic Flat",
      processingDaysMin: 1, processingDaysMax: 3,
      zones: [{ region: "US", rateUsd: 5, additionalItemUsd: 1.5 }],
    } }, ctx);
    assert.equal(c.result.profile.name, "Domestic Flat");
    assert.equal(c.result.profile.number, "SP-001");
    assert.equal(c.result.profile.processingDaysMin, 1);
    assert.equal(c.result.profile.processingDaysMax, 3);
    assert.equal(c.result.profile.zones[0].rateUsd, 5);
    const id = c.result.profile.id;

    const list = await lensRun("marketplace", "shipping-profiles-list", {}, ctx);
    assert.ok(list.result.profiles.some((p) => p.id === id && p.name === "Domestic Flat"));

    const edit = await lensRun("marketplace", "shipping-profiles-save", { params: { id, name: "Domestic Priority", processingDaysMax: 5 } }, ctx);
    assert.equal(edit.result.profile.name, "Domestic Priority");
    assert.equal(edit.result.profile.processingDaysMax, 5);
    // still one profile (edited, not duplicated)
    const list2 = await lensRun("marketplace", "shipping-profiles-list", {}, ctx);
    assert.equal(list2.result.profiles.filter((p) => p.id === id).length, 1);
  });

  it("shipping-profiles-save: a blank name is rejected", async () => {
    const bad = await lensRun("marketplace", "shipping-profiles-save", { params: { name: "  " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });

  it("shipping-profiles-save: editing an unknown id is rejected", async () => {
    const bad = await lensRun("marketplace", "shipping-profiles-save", { params: { id: "ship_nope", name: "Ghost" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /profile not found/);
  });

  it("shipping-profiles-delete removes the profile", async () => {
    const c = await lensRun("marketplace", "shipping-profiles-save", { params: { name: "Throwaway Zone" } }, ctx);
    const id = c.result.profile.id;
    const del = await lensRun("marketplace", "shipping-profiles-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("marketplace", "shipping-profiles-list", {}, ctx);
    assert.ok(!list.result.profiles.some((p) => p.id === id));
  });

  it("shipping-profiles-delete: an unknown id is rejected", async () => {
    const bad = await lensRun("marketplace", "shipping-profiles-delete", { params: { id: "ship_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /profile not found/);
  });
});

describe("marketplace — coupon lifecycle + fixed/free-shipping/expiry apply (wave 10 top-up)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("marketplace-t10-coupons"); });

  it("coupons-create fixed → coupons-list reports it live → coupons-apply caps fixed at subtotal", async () => {
    const c = await lensRun("marketplace", "coupons-create", { params: { code: "TENOFF", kind: "fixed", amount: 10 } }, ctx);
    assert.equal(c.result.coupon.code, "TENOFF");
    assert.equal(c.result.coupon.amount, 10);

    const list = await lensRun("marketplace", "coupons-list", {}, ctx);
    const row = list.result.coupons.find((x) => x.code === "TENOFF");
    assert.ok(row);
    assert.equal(row.live, true); // active + no start/end window

    // fixed discount on a $40 order → exactly 10
    const a = await lensRun("marketplace", "coupons-apply", { params: { code: "TENOFF", subtotalUsd: 40 } }, ctx);
    assert.equal(a.result.discountUsd, 10);
    assert.equal(a.result.totalAfterDiscountUsd, 30);
    // fixed discount is clamped to the subtotal when subtotal < amount
    const b = await lensRun("marketplace", "coupons-apply", { params: { code: "TENOFF", subtotalUsd: 6 } }, ctx);
    assert.equal(b.result.discountUsd, 6);
    assert.equal(b.result.totalAfterDiscountUsd, 0);
  });

  it("coupons-apply free_shipping discounts exactly the shipping passed in", async () => {
    await lensRun("marketplace", "coupons-create", { params: { code: "FREESHIP", kind: "free_shipping" } }, ctx);
    const a = await lensRun("marketplace", "coupons-apply", { params: { code: "FREESHIP", subtotalUsd: 50, shippingUsd: 7.5 } }, ctx);
    assert.equal(a.result.discountUsd, 7.5);
    assert.equal(a.result.totalAfterDiscountUsd, 42.5); // subtotal minus the shipping-rebate
  });

  it("coupons-create fixed: a non-positive amount is rejected", async () => {
    const bad = await lensRun("marketplace", "coupons-create", { params: { code: "ZEROFIX", kind: "fixed", amount: 0 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /fixed amount must be positive/);
  });

  it("coupons-create tiered: empty tiers is rejected", async () => {
    const bad = await lensRun("marketplace", "coupons-create", { params: { code: "NOTIERS", kind: "tiered", tiers: [] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /tiered coupon needs tiers/);
  });

  it("coupons-toggle flips active off → coupons-apply rejects the inactive coupon", async () => {
    const c = await lensRun("marketplace", "coupons-create", { params: { code: "ONOFF", kind: "percent", amount: 25 } }, ctx);
    const id = c.result.coupon.id;
    const t = await lensRun("marketplace", "coupons-toggle", { params: { id } }, ctx);
    assert.equal(t.result.coupon.active, false);
    const a = await lensRun("marketplace", "coupons-apply", { params: { code: "ONOFF", subtotalUsd: 100 } }, ctx);
    assert.equal(a.result.ok, false);
    assert.match(a.result.error, /coupon inactive/);
  });

  it("coupons-apply: an already-expired coupon is rejected", async () => {
    await lensRun("marketplace", "coupons-create", { params: { code: "STALE", kind: "percent", amount: 10, endsAt: "2000-01-01T00:00:00.000Z" } }, ctx);
    const a = await lensRun("marketplace", "coupons-apply", { params: { code: "STALE", subtotalUsd: 100 } }, ctx);
    assert.equal(a.result.ok, false);
    assert.match(a.result.error, /coupon expired/);
  });

  it("coupons-apply: a future-dated coupon has not started", async () => {
    await lensRun("marketplace", "coupons-create", { params: { code: "SOON", kind: "percent", amount: 10, startsAt: "2999-01-01T00:00:00.000Z" } }, ctx);
    const a = await lensRun("marketplace", "coupons-apply", { params: { code: "SOON", subtotalUsd: 100 } }, ctx);
    assert.equal(a.result.ok, false);
    assert.match(a.result.error, /coupon not started/);
  });

  it("coupons-apply: an unknown code is rejected", async () => {
    const a = await lensRun("marketplace", "coupons-apply", { params: { code: "NOPE", subtotalUsd: 100 } }, ctx);
    assert.equal(a.result.ok, false);
    assert.match(a.result.error, /coupon not found/);
  });

  it("coupons-delete removes the coupon so coupons-list no longer returns it", async () => {
    const c = await lensRun("marketplace", "coupons-create", { params: { code: "GONE", kind: "percent", amount: 5 } }, ctx);
    const id = c.result.coupon.id;
    const del = await lensRun("marketplace", "coupons-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("marketplace", "coupons-list", {}, ctx);
    assert.ok(!list.result.coupons.some((x) => x.code === "GONE"));
  });

  it("coupons-delete: an unknown id is rejected", async () => {
    const bad = await lensRun("marketplace", "coupons-delete", { params: { id: "cpn_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /coupon not found/);
  });
});

describe("marketplace — promotions-list + saved-search delete + cart-update (wave 10 top-up)", () => {
  let ctx, sellerId, listingId;
  before(async () => {
    ctx = await depthCtx("marketplace-t10-misc");
    sellerId = ctx.actor.userId;
    const c = await lensRun("marketplace", "listings-create", { params: { title: "Wool Socks", priceUsd: 16, kind: "physical_good", shippingCostUsd: 3, stockQty: 100 } }, ctx);
    listingId = c.result.listing.id;
    await lensRun("marketplace", "listings-publish", { params: { id: listingId } }, ctx);
  });

  it("promotions-list returns created promos including the inactive one after toggle", async () => {
    const p = await lensRun("marketplace", "promotions-create", { params: { code: "summer10", kind: "percent", amount: 10 } }, ctx);
    await lensRun("marketplace", "promotions-toggle", { params: { id: p.result.promotion.id } }, ctx); // → inactive
    const list = await lensRun("marketplace", "promotions-list", {}, ctx);
    const row = list.result.promotions.find((x) => x.code === "SUMMER10");
    assert.ok(row);
    assert.equal(row.active, false);
  });

  it("promotions-toggle: an unknown id is rejected", async () => {
    const bad = await lensRun("marketplace", "promotions-toggle", { params: { id: "prom_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /promotion not found/);
  });

  it("saved-searches-delete removes a saved search; unknown id is rejected", async () => {
    const s = await lensRun("marketplace", "saved-searches-save", { params: { keyword: "raw denim" } }, ctx);
    const id = s.result.savedSearch.id;
    const del = await lensRun("marketplace", "saved-searches-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, true);
    const list = await lensRun("marketplace", "saved-searches-list", {}, ctx);
    assert.ok(!list.result.savedSearches.some((x) => x.id === id));
    const bad = await lensRun("marketplace", "saved-searches-delete", { params: { id: "srch_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /saved search not found/);
  });

  it("cart-update changes a line qty and recomputes the cart total", async () => {
    await lensRun("marketplace", "cart-add", { params: { sellerId, listingId, qty: 2 } }, ctx);
    const cart = await lensRun("marketplace", "cart-get", {}, ctx);
    const lineId = cart.result.shops[0].lines[0].id;
    // bump qty 2 → 4: subtotal 16*4=64 + shipping 3*4=12 → 76
    const up = await lensRun("marketplace", "cart-update", { params: { lineId, qty: 4 } }, ctx);
    assert.equal(up.result.updated, true);
    const after = await lensRun("marketplace", "cart-get", {}, ctx);
    assert.equal(after.result.itemCount, 4);
    assert.equal(after.result.grandTotalUsd, 76);
  });

  it("cart-update with qty 0 removes the line, emptying that shop from the cart", async () => {
    const cart = await lensRun("marketplace", "cart-get", {}, ctx);
    const lineId = cart.result.shops[0].lines[0].id;
    const up = await lensRun("marketplace", "cart-update", { params: { lineId, remove: true } }, ctx);
    assert.equal(up.result.updated, true);
    const after = await lensRun("marketplace", "cart-get", {}, ctx);
    assert.equal(after.result.itemCount, 0);
    assert.ok(!after.result.shops.some((sh) => sh.sellerId === sellerId));
  });

  it("cart-update: an unknown line is rejected", async () => {
    const bad = await lensRun("marketplace", "cart-update", { params: { lineId: "ln_nope", qty: 1 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /cart line not found/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// register()/runMacro-family marketplace macros (NOT lens actions, so not
// reachable via lensRun). These are the DTU-marketplace + plugin-marketplace +
// royalty-cascade money paths. Invoked directly through runMacro, so SUCCESS
// fields live at r.<field> (no lens.run unwrap) and a refusal is r.ok===false.
// Money note: fee/royalty math is asserted at its REAL constitutional values
// (platformFee 5%, creatorPool 95%; ROYALTY_RATES reference 0.05 / derivative
// 0.15, DEPTH_DECAY 0.5, MAX_TOTAL 0.30) — NONE of those constants are touched.
// ─────────────────────────────────────────────────────────────────────────────

describe("marketplace — plugin marketplace (register family)", () => {
  let runMacro, ctx;
  before(async () => { ({ runMacro, ctx } = await macroRuntime("marketplace-plugins")); });

  it("submit registers a plugin listing pending review; browse surfaces it; review averages ratings", async () => {
    const s = await runMacro("marketplace", "submit", { name: "Tidy Tabs", githubUrl: "https://github.com/acme/tidy-tabs", category: "productivity", description: "keeps tabs tidy" }, ctx);
    assert.equal(s.ok, true);
    assert.equal(s.listing.status, "pending_review");
    assert.equal(s.listing.downloads, 0);
    assert.equal(s.listing.category, "productivity");
    const pluginId = s.listing.id;

    const browse = await runMacro("marketplace", "browse", { search: "tidy" }, ctx);
    assert.equal(browse.ok, true);
    assert.ok(browse.items.some((l) => l.id === pluginId), "submitted plugin appears in browse");

    // two reviews → listing.rating becomes their average
    await runMacro("marketplace", "review", { pluginId, rating: 4, comment: "good" }, ctx);
    const r2 = await runMacro("marketplace", "review", { pluginId, rating: 2 }, ctx);
    assert.equal(r2.ok, true);
    const browse2 = await runMacro("marketplace", "browse", {}, ctx);
    const row = browse2.items.find((l) => l.id === pluginId);
    assert.equal(row.rating, 3); // (4 + 2) / 2
  });

  it("submit: a missing githubUrl is rejected", async () => {
    const bad = await runMacro("marketplace", "submit", { name: "No URL Plugin" }, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /Name and GitHub URL required/);
  });

  it("install from a listing increments downloads and lands in installed", async () => {
    const s = await runMacro("marketplace", "submit", { name: "Quick Notes", githubUrl: "https://github.com/acme/quick-notes" }, ctx);
    const pluginId = s.listing.id;
    const inst = await runMacro("marketplace", "install", { pluginId }, ctx);
    assert.equal(inst.ok, true);
    assert.equal(inst.plugin.id, pluginId);
    assert.equal(inst.plugin.enabled, true);

    const installed = await runMacro("marketplace", "installed", {}, ctx);
    assert.ok(installed.plugins.some((p) => p.id === pluginId));

    // browse now reflects the bumped download count
    const browse = await runMacro("marketplace", "browse", { sort: "downloads" }, ctx);
    assert.equal(browse.items.find((l) => l.id === pluginId).downloads, 1);
  });

  it("install from a malformed GitHub URL is rejected", async () => {
    const bad = await runMacro("marketplace", "install", { fromGithub: true, githubUrl: "not-a-github-url" }, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /Invalid GitHub URL/);
  });

  it("install: an unknown pluginId is rejected", async () => {
    const bad = await runMacro("marketplace", "install", { pluginId: "plugin_nope" }, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /Plugin not found/);
  });

  it("review: missing rating is rejected", async () => {
    const bad = await runMacro("marketplace", "review", { pluginId: "plugin_x" }, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /Plugin ID and rating required/);
  });

  it("heartbeatSync reports installed + auto-update counts", async () => {
    const r = await runMacro("marketplace", "heartbeatSync", {}, ctx);
    assert.equal(r.ok, true);
    assert.ok(r.installed >= 1);            // at least the Quick Notes install above
    assert.ok(r.updateChecks >= 1);        // installed plugins default autoUpdate:true
  });
});

describe("marketplace — DTU listing + plain purchase (register family)", () => {
  let runMacro, STATE, ctx;
  before(async () => { ({ runMacro, STATE, ctx } = await macroRuntime("marketplace-dtu")); });

  function seedDtu(id, overrides = {}) {
    const dtu = {
      id,
      title: overrides.title || `DTU ${id}`,
      scope: "personal",
      ownerId: ctx.actor.userId,
      human: { summary: overrides.summary || `summary ${id}` },
      meta: { createdBy: ctx.actor.userId, type: "dtu_pack", tags: overrides.tags || [] },
      lineage: overrides.lineage || { parents: [] },
      ...overrides,
    };
    STATE.dtus.set(id, dtu);
    return dtu;
  }

  it("list flips a DTU to a marketplace listing with price + contentType; dtu_browse surfaces it", async () => {
    seedDtu("mk-dtu-1", { title: "Recipe Pack", tags: ["food"] });
    const l = await runMacro("marketplace", "list", { dtuId: "mk-dtu-1", price: 12, currency: "USD", contentType: "recipe", title: "Recipe Pack", tags: ["food"] }, ctx);
    assert.equal(l.ok, true);
    assert.equal(l.listing.listed, true);
    assert.equal(l.listing.price, 12);
    assert.equal(l.listing.contentType, "recipe");
    assert.equal(l.listing.purchases, 0);

    const browse = await runMacro("marketplace", "dtu_browse", { contentType: "recipe" }, ctx);
    assert.equal(browse.ok, true);
    const row = browse.listings.find((x) => x.id === "mk-dtu-1");
    assert.ok(row, "listed DTU appears in dtu_browse");
    assert.equal(row.price, 12);
  });

  it("list: an unknown dtuId is rejected", async () => {
    const bad = await runMacro("marketplace", "list", { dtuId: "mk-dtu-nope", price: 5 }, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /dtu_not_found/);
  });

  it("purchase clones a listed DTU to the buyer and increments the listing purchase count", async () => {
    seedDtu("mk-dtu-2", { title: "Brush Pack" });
    await runMacro("marketplace", "list", { dtuId: "mk-dtu-2", price: 0 }, ctx);
    const p = await runMacro("marketplace", "purchase", { dtuId: "mk-dtu-2" }, ctx);
    assert.equal(p.ok, true);
    assert.ok(p.purchasedDtuId, "a clone id is returned");
    const clone = STATE.dtus.get(p.purchasedDtuId);
    assert.equal(clone.scope, "local");
    assert.equal(clone.meta.purchasedFrom, "mk-dtu-2");
    assert.equal(STATE.dtus.get("mk-dtu-2").marketplace.purchases, 1);
  });

  it("purchase: a DTU that was never listed is rejected", async () => {
    seedDtu("mk-dtu-3");
    const bad = await runMacro("marketplace", "purchase", { dtuId: "mk-dtu-3" }, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /not_listed/);
  });

  it("dtu_browse sorts by price_low and filters by tag", async () => {
    seedDtu("mk-dtu-cheap", { tags: ["sort"] });
    seedDtu("mk-dtu-pricey", { tags: ["sort"] });
    await runMacro("marketplace", "list", { dtuId: "mk-dtu-cheap", price: 3, tags: ["sort"] }, ctx);
    await runMacro("marketplace", "list", { dtuId: "mk-dtu-pricey", price: 30, tags: ["sort"] }, ctx);
    const browse = await runMacro("marketplace", "dtu_browse", { tags: ["sort"], sort: "price_low" }, ctx);
    const sortRows = browse.listings.filter((x) => x.tags?.includes("sort"));
    assert.ok(sortRows.length >= 2);
    // price_low ordering: the cheaper one precedes the pricier one
    const idxCheap = sortRows.findIndex((x) => x.id === "mk-dtu-cheap");
    const idxPricey = sortRows.findIndex((x) => x.id === "mk-dtu-pricey");
    assert.ok(idxCheap < idxPricey, "price_low sorts cheapest first");
  });
});

describe("marketplace — purchaseWithRoyalties money path (register family)", () => {
  let runMacro, STATE, ctx;
  before(async () => { ({ runMacro, STATE, ctx } = await macroRuntime("marketplace-royalty")); });

  // helper: read an economic-wallet balance (0 when the wallet doesn't exist yet)
  function bal(userId) {
    return STATE.economic?.wallets?.get(userId)?.balance || 0;
  }
  function seedListedDtu(id, { price, seller, parents = [] } = {}) {
    STATE.dtus.set(id, {
      id, title: `Listed ${id}`, scope: "marketplace",
      ownerId: seller, meta: { createdBy: seller, type: "dtu_pack" },
      human: { summary: `summary ${id}` },
      lineage: { parents, citationType: "reference" },
      marketplace: { listed: true, price, currency: "USD", seller, purchases: 0, listedAt: new Date().toISOString() },
    });
  }

  it("a price-0 purchase clones the DTU with no royalties and no wallet movement", async () => {
    seedListedDtu("rk-free", { price: 0, seller: "seller-free" });
    const r = await runMacro("marketplace", "purchaseWithRoyalties", { dtuId: "rk-free" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.price, 0);
    assert.deepEqual(r.royalties, []);
    assert.ok(STATE.dtus.get(r.purchasedDtuId), "clone exists");
  });

  it("a paid purchase with NO ancestors pays seller 95% + platform 5% and credits the seller wallet exactly", async () => {
    // buyer must have funds; ctx.actor.userId is the buyer
    const buyer = ctx.actor.userId;
    STATE.economic = STATE.economic || { wallets: new Map() };
    STATE.economic.wallets.set(buyer, { odId: buyer, balance: 1000, tokensEarned: 0, tokensSpent: 0 });
    seedListedDtu("rk-noanc", { price: 100, seller: "seller-noanc" });

    const sellerBefore = bal("seller-noanc");
    const r = await runMacro("marketplace", "purchaseWithRoyalties", { dtuId: "rk-noanc" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.price, 100);
    // no ancestors → empty cascade; seller gets the full 95% creator pool
    assert.equal(r.breakdown.royaltiesPaid.length, 0);
    assert.equal(r.breakdown.platformFee, 5);       // 100 * 0.05
    assert.equal(r.breakdown.sellerReceived, 95);   // 100 * 0.95
    // seller wallet actually credited 95 (this path threw a TDZ ReferenceError
    // before the clone-ordering fix, so nothing was ever credited)
    assert.equal(bal("seller-noanc") - sellerBefore, 95);
    // buyer debited the full price
    assert.equal(bal(buyer), 900);
  });

  it("a paid purchase WITH one cited ancestor pays the reference royalty (5% of creator pool) and the seller the remainder", async () => {
    const buyer = ctx.actor.userId;
    STATE.economic.wallets.set(buyer, { odId: buyer, balance: 1000, tokensEarned: 0, tokensSpent: 0 });
    // ancestor DTU authored by a creator with an existing wallet so it pays direct (not escrow)
    STATE.dtus.set("rk-parent", {
      id: "rk-parent", title: "Ancestor", scope: "personal", ownerId: "creator-anc",
      meta: { createdBy: "creator-anc" }, human: { summary: "ancestor work" }, lineage: { parents: [] },
    });
    STATE.economic.wallets.set("creator-anc", { odId: "creator-anc", balance: 0, tokensEarned: 0, tokensSpent: 0 });
    seedListedDtu("rk-deriv", { price: 200, seller: "seller-deriv", parents: ["rk-parent"] });

    const ancBefore = bal("creator-anc");
    const sellerBefore = bal("seller-deriv");
    const r = await runMacro("marketplace", "purchaseWithRoyalties", { dtuId: "rk-deriv" }, ctx);
    assert.equal(r.ok, true);
    // creatorPool = 200 * 0.95 = 190; reference royalty rate 0.05 at depth 0 → 190 * 0.05 = 9.5
    assert.equal(r.breakdown.royaltiesPaid.length, 1);
    assert.equal(r.breakdown.royaltiesPaid[0].amount, 9.5);
    assert.equal(r.breakdown.royaltiesPaid[0].recipient, "creator-anc");
    // seller gets the remainder of the pool: 190 - 9.5 = 180.5
    assert.equal(r.breakdown.sellerReceived, 180.5);
    assert.equal(r.breakdown.platformFee, 10);          // 200 * 0.05
    assert.equal(r.breakdown.totalRoyaltyPercent, 5);   // reference rate 5%
    // wallets actually credited
    assert.equal(bal("creator-anc") - ancBefore, 9.5);
    assert.equal(bal("seller-deriv") - sellerBefore, 180.5);
  });

  it("an unlisted DTU is rejected", async () => {
    STATE.dtus.set("rk-unlisted", { id: "rk-unlisted", title: "Nope", scope: "personal", meta: {}, lineage: { parents: [] } });
    const bad = await runMacro("marketplace", "purchaseWithRoyalties", { dtuId: "rk-unlisted" }, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /not_listed/);
  });

  it("a paid purchase with insufficient buyer balance is rejected before any settlement", async () => {
    const buyer = ctx.actor.userId;
    STATE.economic.wallets.set(buyer, { odId: buyer, balance: 5, tokensEarned: 0, tokensSpent: 0 });
    seedListedDtu("rk-broke", { price: 50, seller: "seller-broke" });
    const sellerBefore = bal("seller-broke");
    const bad = await runMacro("marketplace", "purchaseWithRoyalties", { dtuId: "rk-broke" }, ctx);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /insufficient_balance/);
    assert.equal(bad.balance, 5);
    assert.equal(bad.price, 50);
    assert.equal(bal("seller-broke"), sellerBefore); // nothing credited
  });
});

describe("marketplace — royalties earnings query (register family)", () => {
  let runMacro, STATE, ctx;
  before(async () => { ({ runMacro, STATE, ctx } = await macroRuntime("marketplace-royalties-query")); });

  it("royalties aggregates royalty_record DTUs naming the user into totalEarned + per-source streams", async () => {
    const me = ctx.actor.userId;
    // seed two royalty_record DTUs that mention this user in their summary
    STATE.dtus.set("ry-rec-1", {
      id: "ry-rec-1", machine: { kind: "royalty_record" },
      human: { summary: `Royalty: $9.5 to ${me} for reference of Source Alpha` },
      core: { claims: ["Amount: $9.5", "Type: reference", "Depth: 0"] },
      lineage: { parents: ["src-buy", "src-alpha"] },
      meta: { createdAt: new Date().toISOString() },
    });
    STATE.dtus.set("ry-rec-2", {
      id: "ry-rec-2", machine: { kind: "royalty_record" },
      human: { summary: `Royalty: $4 to ${me} for reference of Source Alpha` },
      core: { claims: ["Amount: $4", "Type: reference", "Depth: 0"] },
      lineage: { parents: ["src-buy", "src-alpha"] },
      meta: { createdAt: new Date().toISOString() },
    });
    const r = await runMacro("marketplace", "royalties", {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.totalEarned, 13.5); // 9.5 + 4
    assert.equal(r.thisMonth, 13.5);   // both created just now
    const stream = r.streams.find((s) => s.id === "src-alpha");
    assert.ok(stream, "a per-source royalty stream is rolled up");
    assert.equal(stream.totalSales, 2);
    assert.equal(stream.totalRoyalties, 13.5);
  });

  it("royalties: no resolvable userId is rejected", async () => {
    // an internal ctx that passes authz but carries no actor.userId, and no
    // input.userId → the handler's `input?.userId || ctx?.actor?.userId` is empty
    const anon = { ...ctx, internal: true, actor: { ...ctx.actor, userId: undefined } };
    const bad = await runMacro("marketplace", "royalties", {}, anon);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /userId required/);
  });
});
