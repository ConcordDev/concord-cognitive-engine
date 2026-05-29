/**
 * E5 — restaurant Diner-Dash batching combo. Serving orders in quick succession
 * builds a tip multiplier (the satisfying rush loop); a late (0-tip) serve and a
 * lapsed window reset it.
 *
 * Run: node --test tests/restaurant-combo.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { openRestaurant, placeOrder, serveOrder, _resetComboState } from "../lib/restaurant.js";
import { up as upRestaurant } from "../migrations/248_restaurant.js";

function freshDb() { const db = new Database(":memory:"); upRestaurant(db); return db; }
function order(db, rid) { return placeOrder(db, rid, { customerNpcId: `c_${Math.random()}`, dishId: "stew" }).orderId; }

describe("E5 — restaurant batching combo", () => {
  beforeEach(() => _resetComboState());

  it("consecutive fast serves build the combo + tip multiplier", () => {
    const db = freshDb();
    const r = openRestaurant(db, "u1", { worldId: "tunya" });
    const s1 = serveOrder(db, "u1", order(db, r.restaurantId));
    const s2 = serveOrder(db, "u1", order(db, r.restaurantId));
    const s3 = serveOrder(db, "u1", order(db, r.restaurantId));
    assert.equal(s1.combo, 1);
    assert.equal(s2.combo, 2);
    assert.equal(s3.combo, 3);
    assert.ok(s3.comboMult > s2.comboMult && s2.comboMult > s1.comboMult, "multiplier climbs");
    assert.ok(s3.tip > s1.tip, "a higher combo earns a bigger tip on the same dish");
  });

  it("the combo caps at COMBO_MAX", () => {
    const db = freshDb();
    const r = openRestaurant(db, "u1", { worldId: "tunya" });
    let last;
    for (let i = 0; i < 10; i++) last = serveOrder(db, "u1", order(db, r.restaurantId));
    assert.equal(last.combo, 5); // COMBO_MAX default
  });

  it("a lapsed window (reset) drops the combo back to 1", () => {
    const db = freshDb();
    const r = openRestaurant(db, "u1", { worldId: "tunya" });
    serveOrder(db, "u1", order(db, r.restaurantId));
    serveOrder(db, "u1", order(db, r.restaurantId)); // combo 2
    _resetComboState(); // simulate the window lapsing
    const s = serveOrder(db, "u1", order(db, r.restaurantId));
    assert.equal(s.combo, 1);
  });

  it("a 0-tip late serve does not build the combo", () => {
    const db = freshDb();
    const r = openRestaurant(db, "u1", { worldId: "tunya" });
    const oid = placeOrder(db, r.restaurantId, { customerNpcId: "late", ttlSeconds: 600 }).orderId;
    // make it 'slow' (past the fast + ok windows) but not expired → tipFrac 0:
    // waited ~595 > ttl(600)-60, and expires_at still in the future.
    db.prepare(`UPDATE restaurant_orders SET ordered_at = unixepoch() - 595, expires_at = unixepoch() + 5 WHERE id = ?`).run(oid);
    const s = serveOrder(db, "u1", oid);
    assert.equal(s.ok, true);
    assert.equal(s.tipFrac, 0);
    assert.equal(s.combo, 1); // late serve doesn't advance the rush
  });
});
