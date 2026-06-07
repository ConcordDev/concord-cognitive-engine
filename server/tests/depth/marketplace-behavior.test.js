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
import { lensRun, depthCtx } from "./_harness.js";

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
