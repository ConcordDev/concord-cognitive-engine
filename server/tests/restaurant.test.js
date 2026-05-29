// Phase CB4 — restaurant management tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  openRestaurant, closeRestaurant, placeOrder, serveOrder,
  sweepExpiredOrders, listPendingOrders, getRestaurantSummary,
  BASE_PRICE_CC,
} from "../lib/restaurant.js";
import { up as upRestaurant } from "../migrations/248_restaurant.js";

function freshDb() { const db = new Database(":memory:"); upRestaurant(db); return db; }

describe("Phase CB4 — restaurant management", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("openRestaurant creates row + closeRestaurant flips closed_at", () => {
    const r = openRestaurant(db, "u1", { worldId: "tunya" });
    assert.equal(r.ok, true);
    const c = closeRestaurant(db, r.restaurantId, "u1");
    assert.equal(c.ok, true);
    const sum = getRestaurantSummary(db, r.restaurantId);
    assert.ok(sum.closed_at);
  });

  it("non-owner cannot close", () => {
    const r = openRestaurant(db, "u1", { worldId: "tunya" });
    const c = closeRestaurant(db, r.restaurantId, "u2");
    assert.equal(c.ok, false);
    assert.equal(c.error, "not_owner");
  });

  it("placeOrder + serveOrder credits payment + tip (fast)", () => {
    const r = openRestaurant(db, "u1", { worldId: "tunya" });
    const o = placeOrder(db, r.restaurantId, { customerNpcId: "npc-customer", dishId: "stew" });
    const s = serveOrder(db, "u1", o.orderId);
    assert.equal(s.ok, true);
    assert.equal(s.payment, BASE_PRICE_CC);
    // Served fast (within 30s) → 20% tip (T3.4-adopted TIP_FRACTION_FAST).
    assert.equal(s.tipFrac, 0.20);
    const sum = getRestaurantSummary(db, r.restaurantId);
    assert.equal(sum.orders_served, 1);
    assert.ok(sum.total_revenue > 0);
  });

  it("serveOrder after expiry → expired + orders_missed++", () => {
    const r = openRestaurant(db, "u1", { worldId: "tunya" });
    const o = placeOrder(db, r.restaurantId, { customerNpcId: "n1", ttlSeconds: 1 });
    db.prepare(`UPDATE restaurant_orders SET expires_at = 1 WHERE id = ?`).run(o.orderId);
    const s = serveOrder(db, "u1", o.orderId);
    assert.equal(s.ok, false);
    assert.equal(s.error, "expired");
    const sum = getRestaurantSummary(db, r.restaurantId);
    assert.equal(sum.orders_missed, 1);
  });

  it("non-owner cannot serve", () => {
    const r = openRestaurant(db, "u1", { worldId: "tunya" });
    const o = placeOrder(db, r.restaurantId, { customerNpcId: "n1" });
    const s = serveOrder(db, "u2", o.orderId);
    assert.equal(s.ok, false);
    assert.equal(s.error, "not_owner");
  });

  it("sweepExpiredOrders marks pending past expires_at as expired", () => {
    const r = openRestaurant(db, "u1", { worldId: "tunya" });
    placeOrder(db, r.restaurantId, { customerNpcId: "n1", ttlSeconds: 1 });
    placeOrder(db, r.restaurantId, { customerNpcId: "n2", ttlSeconds: 1 });
    db.prepare(`UPDATE restaurant_orders SET expires_at = 1`).run();
    const sw = sweepExpiredOrders(db);
    assert.equal(sw.expired, 2);
    const sum = getRestaurantSummary(db, r.restaurantId);
    assert.equal(sum.orders_missed, 2);
  });

  it("can't place order on closed restaurant", () => {
    const r = openRestaurant(db, "u1", { worldId: "tunya" });
    closeRestaurant(db, r.restaurantId, "u1");
    const o = placeOrder(db, r.restaurantId, { customerNpcId: "n1" });
    assert.equal(o.ok, false);
    assert.equal(o.error, "restaurant_closed");
  });

  it("listPendingOrders excludes served + expired", () => {
    const r = openRestaurant(db, "u1", { worldId: "tunya" });
    const a = placeOrder(db, r.restaurantId, { customerNpcId: "n1" });
    placeOrder(db, r.restaurantId, { customerNpcId: "n2" });
    placeOrder(db, r.restaurantId, { customerNpcId: "n3" });
    serveOrder(db, "u1", a.orderId);
    const pending = listPendingOrders(db, r.restaurantId);
    assert.equal(pending.length, 2);
  });
});
