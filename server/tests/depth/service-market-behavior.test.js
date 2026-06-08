// tests/depth/service-market-behavior.test.js — REAL behavioral tests for the
// service-market domain (registerLensAction family). This domain is NOT YET
// globally registered in domains/index.js, so we cannot drive it through the
// server-booting `lensRun` harness. Instead we register the handlers into a
// LOCAL shim Map and invoke them directly with the same (ctx, artifact, params)
// signature the live `lens.run` dispatch uses.
//
// Shim contract mirrors the live path: handlers receive (ctx, { data }, params)
// and return { ok, result }. We assert exact totals, CRUD round-trips,
// owner-gating, can't-order-own, status-transition + not-found rejections.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import register from "../../domains/service-market.js";

// Local shim — register actions into a Map keyed by the action name.
const H = new Map();
register((_domain, action, fn) => H.set(action, fn));
const run = (action, data = {}, params = {}, ctx = { actor: { userId: "u1" } }) =>
  H.get(action)(ctx, { data }, params);

// Convenience contexts for two distinct users (provider vs buyer).
const provider = { actor: { userId: "provider1" } };
const buyer = { actor: { userId: "buyer1" } };

// The domain's stores live on globalThis._concordSTATE. Reset between tests so
// counts/totals are exact and isolated.
beforeEach(() => {
  if (globalThis._concordSTATE) {
    globalThis._concordSTATE.serviceListings = new Map();
    globalThis._concordSTATE.serviceOrders = new Map();
  }
});

describe("service-market — listing CRUD + validation", () => {
  it("listing-create requires title, price, category; rejects each missing", () => {
    const noTitle = run("listing-create", {}, { price: 100, category: "Design Review" });
    assert.equal(noTitle.ok, false);
    assert.ok(noTitle.error.includes("title"));

    const noPrice = run("listing-create", {}, { title: "X", category: "Design Review" });
    assert.equal(noPrice.ok, false);
    assert.ok(noPrice.error.includes("price"));

    const noCat = run("listing-create", {}, { title: "X", price: 100 });
    assert.equal(noCat.ok, false);
    assert.ok(noCat.error.includes("category"));
  });

  it("listing-create → listing-get round-trips with provider = actor", () => {
    const created = run("listing-create", {},
      { title: "Structural review", price: 250, category: "Structural Analysis" }, provider);
    assert.equal(created.ok, true);
    assert.equal(created.result.listing.provider, "provider1");
    assert.equal(created.result.listing.price, 250);
    assert.equal(created.result.listing.status, "active");

    const id = created.result.listing.id;
    const got = run("listing-get", {}, { id });
    assert.equal(got.ok, true);
    assert.equal(got.result.listing.id, id);
    assert.equal(got.result.listing.title, "Structural review");
  });

  it("listing-get on an unknown id is not-found", () => {
    const got = run("listing-get", {}, { id: "nope_999" });
    assert.equal(got.ok, false);
    assert.ok(got.error.includes("not found"));
  });

  it("listing-list filters by category + query and sorts by price", () => {
    run("listing-create", {}, { title: "Cheap review", price: 50, category: "Design Review" }, provider);
    run("listing-create", {}, { title: "Pricey review", price: 500, category: "Design Review" }, provider);
    run("listing-create", {}, { title: "Quest help", price: 120, category: "Quest Design" }, provider);

    const all = run("listing-list", {}, {});
    assert.equal(all.result.count, 3);
    assert.ok(all.result.categories.includes("Quest Design"));

    const design = run("listing-list", {}, { category: "Design Review", sort: "price-asc" });
    assert.equal(design.result.count, 2);
    assert.equal(design.result.listings[0].price, 50);
    assert.equal(design.result.listings[1].price, 500);

    const search = run("listing-list", {}, { query: "quest" });
    assert.equal(search.result.count, 1);
    assert.equal(search.result.listings[0].title, "Quest help");
  });

  it("listing-delete is owner-gated and handles not-found", () => {
    const created = run("listing-create", {},
      { title: "Mine", price: 10, category: "Other" }, provider);
    const id = created.result.listing.id;

    const notOwner = run("listing-delete", {}, { id }, buyer);
    assert.equal(notOwner.ok, false);
    assert.ok(notOwner.error.includes("forbidden"));

    const missing = run("listing-delete", {}, { id: "nope_999" }, provider);
    assert.equal(missing.ok, false);
    assert.ok(missing.error.includes("not found"));

    const ok = run("listing-delete", {}, { id }, provider);
    assert.equal(ok.ok, true);
    assert.equal(ok.result.deleted, true);
    const after = run("listing-list", {}, {});
    assert.equal(after.result.count, 0);
  });
});

describe("service-market — order lifecycle", () => {
  it("order-create computes total = unitPrice × quantity", () => {
    const listing = run("listing-create", {},
      { title: "Hourly consult", price: 75, category: "Mentoring" }, provider);
    const order = run("order-create", {},
      { listingId: listing.result.listing.id, quantity: 3, requirements: "need help" }, buyer);
    assert.equal(order.ok, true);
    assert.equal(order.result.order.unitPrice, 75);
    assert.equal(order.result.order.quantity, 3);
    assert.equal(order.result.order.total, 225);
    assert.equal(order.result.order.status, "pending");
    assert.equal(order.result.order.buyer, "buyer1");
    assert.equal(order.result.order.provider, "provider1");
  });

  it("order-create rejects ordering your own listing + unknown listing", () => {
    const listing = run("listing-create", {},
      { title: "Self", price: 10, category: "Other" }, provider);
    const own = run("order-create", {}, { listingId: listing.result.listing.id }, provider);
    assert.equal(own.ok, false);
    assert.ok(own.error.includes("own listing"));

    const missing = run("order-create", {}, { listingId: "nope_999" }, buyer);
    assert.equal(missing.ok, false);
    assert.ok(missing.error.includes("not found"));
  });

  it("order-list filters by buyer vs seller role", () => {
    const listing = run("listing-create", {},
      { title: "Svc", price: 40, category: "Other" }, provider);
    run("order-create", {}, { listingId: listing.result.listing.id }, buyer);

    const asBuyer = run("order-list", {}, { role: "buyer" }, buyer);
    assert.equal(asBuyer.result.count, 1);
    assert.equal(asBuyer.result.orders[0].buyer, "buyer1");

    const asSeller = run("order-list", {}, { role: "seller" }, provider);
    assert.equal(asSeller.result.count, 1);
    assert.equal(asSeller.result.orders[0].provider, "provider1");

    // The buyer is not the seller of anything → seller view is empty.
    const buyerAsSeller = run("order-list", {}, { role: "seller" }, buyer);
    assert.equal(buyerAsSeller.result.count, 0);
  });

  it("order-update-status follows the transition machine; rejects invalid + not-found", () => {
    const listing = run("listing-create", {},
      { title: "Flow", price: 100, category: "Other" }, provider);
    const order = run("order-create", {}, { listingId: listing.result.listing.id }, buyer);
    const id = order.result.order.id;

    // pending → completed is NOT a legal direct hop.
    const illegal = run("order-update-status", {}, { id, status: "completed" }, provider);
    assert.equal(illegal.ok, false);
    assert.ok(illegal.error.includes("invalid transition"));

    // pending → accepted → completed is legal.
    const accept = run("order-update-status", {}, { id, status: "accepted" }, provider);
    assert.equal(accept.ok, true);
    assert.equal(accept.result.order.status, "accepted");
    const complete = run("order-update-status", {}, { id, status: "completed" }, provider);
    assert.equal(complete.ok, true);
    assert.equal(complete.result.order.status, "completed");

    // An unknown status string is rejected.
    const created2 = run("order-create", {}, { listingId: listing.result.listing.id }, buyer);
    const bad = run("order-update-status", {}, { id: created2.result.order.id, status: "teleported" }, buyer);
    assert.equal(bad.ok, false);
    assert.ok(bad.error.includes("invalid status"));

    // Unknown order id is not-found.
    const missing = run("order-update-status", {}, { id: "nope_999", status: "accepted" }, provider);
    assert.equal(missing.ok, false);
    assert.ok(missing.error.includes("not found"));
  });

  it("order-update-status is gated to parties of the order", () => {
    const listing = run("listing-create", {},
      { title: "Gated", price: 100, category: "Other" }, provider);
    const order = run("order-create", {}, { listingId: listing.result.listing.id }, buyer);
    const stranger = { actor: { userId: "stranger1" } };
    const denied = run("order-update-status", {}, { id: order.result.order.id, status: "accepted" }, stranger);
    assert.equal(denied.ok, false);
    assert.ok(denied.error.includes("forbidden"));
  });
});

describe("service-market — market-summary exact totals", () => {
  it("tallies listing/order counts and gross by status", () => {
    const l1 = run("listing-create", {}, { title: "A", price: 100, category: "Design Review" }, provider);
    run("listing-create", {}, { title: "B", price: 200, category: "Mentoring" }, provider);

    // Two orders against l1: one stays pending (100), one completes (100 ×2 = 200).
    run("order-create", {}, { listingId: l1.result.listing.id }, buyer);
    const o2 = run("order-create", {}, { listingId: l1.result.listing.id, quantity: 2 }, buyer);
    run("order-update-status", {}, { id: o2.result.order.id, status: "accepted" }, provider);
    run("order-update-status", {}, { id: o2.result.order.id, status: "completed" }, provider);

    const sum = run("market-summary", {}, {});
    assert.equal(sum.ok, true);
    assert.equal(sum.result.listingCount, 2);
    assert.equal(sum.result.orderCount, 2);
    assert.equal(sum.result.grossByStatus.pending, 100);
    assert.equal(sum.result.grossByStatus.completed, 200);
    assert.equal(sum.result.grossTotal, 300);
    assert.equal(sum.result.listingsByCategory["Design Review"], 1);
    assert.equal(sum.result.listingsByCategory.Mentoring, 1);
  });

  it("empty market summarizes to zeros (no fabricated rows)", () => {
    const sum = run("market-summary", {}, {});
    assert.equal(sum.result.listingCount, 0);
    assert.equal(sum.result.orderCount, 0);
    assert.equal(sum.result.grossTotal, 0);
  });
});
