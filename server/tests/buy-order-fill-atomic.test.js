// G8 — buy-order fill must be atomic. The order-state advance, the fill row, and
// the seller credit were three separate statements; a throw after the UPDATE
// left the order "filled" but the seller unpaid (lost money). They now commit in
// one db.transaction() — a failure rolls everything back.
//
// Run: node --test tests/buy-order-fill-atomic.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { placeBuyOrder, fillBuyOrder } from "../lib/auctions.js";
import { up as upBuyOrders } from "../migrations/227_auction_buy_orders.js";

function freshDb() {
  const db = new Database(":memory:");
  upBuyOrders(db);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, concordia_credits REAL NOT NULL DEFAULT 0);
    CREATE TABLE reward_ledger (id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, amount_cc REAL, ts INTEGER, ref_id TEXT);
  `);
  return db;
}
const fund = (db, u, a) => db.prepare(
  `INSERT INTO users (id, concordia_credits) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET concordia_credits = concordia_credits + excluded.concordia_credits`
).run(u, a);
const orderRow = (db, id) => db.prepare(`SELECT quantity_filled, status FROM auction_buy_orders WHERE id=?`).get(id);
const fillCount = (db, id) => db.prepare(`SELECT COUNT(*) n FROM auction_buy_fills WHERE buy_order_id=?`).get(id).n;

describe("G8 — buy-order fill atomicity", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("a happy-path fill commits order-state + fill row + seller credit together", () => {
    fund(db, "buyer", 1000); fund(db, "seller", 0);
    const r = placeBuyOrder(db, "buyer", { worldId: "w", itemDescriptor: "iron", unitPriceCc: 5, quantity: 100 });
    const f = fillBuyOrder(db, r.buyOrderId, "seller", 40);
    assert.equal(f.ok, true);
    assert.equal(orderRow(db, r.buyOrderId).quantity_filled, 40);
    assert.equal(fillCount(db, r.buyOrderId), 1);
    assert.equal(db.prepare(`SELECT concordia_credits c FROM users WHERE id='seller'`).get().c, 200);
  });

  it("a credit that can't land rolls back: order NOT advanced, no orphan fill row", () => {
    // Buyer funded; seller has NO users/wallet row → the checked credit affects
    // 0 rows and must roll the whole fill back (no filled-but-unpaid).
    fund(db, "buyer", 1000);
    const r = placeBuyOrder(db, "buyer", { worldId: "w", itemDescriptor: "iron", unitPriceCc: 5, quantity: 100 });
    const before = orderRow(db, r.buyOrderId);

    const res = fillBuyOrder(db, r.buyOrderId, "seller_no_wallet", 40);
    assert.equal(res.ok, false, "fill must fail when the seller can't be credited");
    assert.equal(res.error, "seller_wallet_missing");

    const after = orderRow(db, r.buyOrderId);
    assert.equal(after.quantity_filled, before.quantity_filled, "order state rolled back");
    assert.equal(after.status, before.status, "status rolled back");
    assert.equal(fillCount(db, r.buyOrderId), 0, "no orphan fill row persisted");
  });
});
