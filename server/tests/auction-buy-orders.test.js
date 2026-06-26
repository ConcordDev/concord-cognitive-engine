// Phase AC — EVE-style buy orders tests.
//
// Real in-memory sqlite. Boots the buy-order tables (migration 227)
// plus a minimal user_wallets + economy_ledger so the wallet primitives
// in auctions.js work end-to-end.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  placeBuyOrder,
  fillBuyOrder,
  cancelBuyOrder,
  listOpenBuyOrders,
  sweepExpiredBuyOrders,
} from "../lib/auctions.js";
import { up as upBuyOrders } from "../migrations/227_auction_buy_orders.js";

function freshDb() {
  const db = new Database(":memory:");
  upBuyOrders(db);
  // Concord Coin balances live in users.concordia_credits (migration 045) and the
  // wallet primitives in auctions.js log to reward_ledger (migration 296).
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      concordia_credits REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE reward_ledger (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      kind TEXT,
      amount_cc REAL,
      ts INTEGER,
      ref_id TEXT
    );
  `);
  return db;
}

function fund(db, userId, amount) {
  db.prepare(`
    INSERT INTO users (id, concordia_credits) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET concordia_credits = concordia_credits + excluded.concordia_credits
  `).run(userId, amount);
}

function balance(db, userId) {
  return db.prepare(`SELECT concordia_credits AS balance FROM users WHERE id = ?`).get(userId)?.balance || 0;
}

describe("Phase AC — buy orders", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("placeBuyOrder escrows total = unit × qty up-front", () => {
    fund(db, "buyer", 1000);
    const r = placeBuyOrder(db, "buyer", {
      worldId: "tunya",
      itemDescriptor: "rare_herb",
      unitPriceCc: 5,
      quantity: 100,
    });
    assert.equal(r.ok, true);
    assert.equal(r.escrowCc, 500);
    assert.equal(balance(db, "buyer"), 500, "remaining wallet = 1000 − 500");
  });

  it("placeBuyOrder rejects insufficient balance", () => {
    fund(db, "buyer", 50);
    const r = placeBuyOrder(db, "buyer", {
      worldId: "tunya",
      itemDescriptor: "rare_herb",
      unitPriceCc: 5,
      quantity: 100,
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_funds");
    assert.equal(balance(db, "buyer"), 50, "no debit on rejected order");
  });

  it("fillBuyOrder partial flips status to 'partial', credits seller", () => {
    fund(db, "buyer", 1000);
    fund(db, "seller", 0); // seller needs a users row for the credit UPDATE to land
    const r = placeBuyOrder(db, "buyer", {
      worldId: "tunya", itemDescriptor: "rare_herb",
      unitPriceCc: 5, quantity: 100,
    });
    const f = fillBuyOrder(db, r.buyOrderId, "seller", 40);
    assert.equal(f.ok, true);
    assert.equal(f.fillQty, 40);
    assert.equal(f.payment, 200);
    assert.equal(f.newStatus, "partial");
    assert.equal(balance(db, "seller"), 200);
  });

  it("fillBuyOrder full flips status to 'filled'", () => {
    fund(db, "buyer", 500);
    fund(db, "seller", 0);
    const r = placeBuyOrder(db, "buyer", {
      worldId: "tunya", itemDescriptor: "rare_herb",
      unitPriceCc: 5, quantity: 100,
    });
    const f = fillBuyOrder(db, r.buyOrderId, "seller", 100);
    assert.equal(f.newStatus, "filled");
    assert.equal(f.remaining, 0);
  });

  it("fillBuyOrder clamps to remaining quantity", () => {
    fund(db, "buyer", 500);
    fund(db, "seller", 0);
    const r = placeBuyOrder(db, "buyer", {
      worldId: "tunya", itemDescriptor: "rare_herb",
      unitPriceCc: 5, quantity: 100,
    });
    const f = fillBuyOrder(db, r.buyOrderId, "seller", 200);
    assert.equal(f.fillQty, 100);
    assert.equal(f.payment, 500);
    assert.equal(f.newStatus, "filled");
  });

  it("cancelBuyOrder refunds the unfilled portion only", () => {
    fund(db, "buyer", 1000);
    fund(db, "seller", 0);
    const r = placeBuyOrder(db, "buyer", {
      worldId: "tunya", itemDescriptor: "rare_herb",
      unitPriceCc: 5, quantity: 100,
    });
    fillBuyOrder(db, r.buyOrderId, "seller", 30); // 30 filled → 70 unfilled
    assert.equal(balance(db, "buyer"), 500); // escrowed 500, unchanged by fill
    const c = cancelBuyOrder(db, r.buyOrderId, "buyer");
    assert.equal(c.ok, true);
    assert.equal(c.refundCc, 350, "70 unfilled × 5 = 350 refund");
    assert.equal(balance(db, "buyer"), 850, "500 → 850 after refund");
  });

  it("self-fill is rejected", () => {
    fund(db, "alice", 500);
    const r = placeBuyOrder(db, "alice", {
      worldId: "tunya", itemDescriptor: "rare_herb",
      unitPriceCc: 5, quantity: 100,
    });
    const f = fillBuyOrder(db, r.buyOrderId, "alice", 10);
    assert.equal(f.ok, false);
    assert.equal(f.error, "self_fill");
  });

  it("listOpenBuyOrders filters by world + item, sorts price-desc", () => {
    fund(db, "b1", 1000); fund(db, "b2", 1000); fund(db, "b3", 1000);
    placeBuyOrder(db, "b1", { worldId: "tunya", itemDescriptor: "herb", unitPriceCc: 3, quantity: 10 });
    placeBuyOrder(db, "b2", { worldId: "tunya", itemDescriptor: "herb", unitPriceCc: 7, quantity: 10 });
    placeBuyOrder(db, "b3", { worldId: "cyber", itemDescriptor: "herb", unitPriceCc: 99, quantity: 10 });
    const open = listOpenBuyOrders(db, { worldId: "tunya", itemDescriptor: "herb" });
    assert.equal(open.length, 2);
    assert.equal(open[0].unit_price_cc, 7, "highest price first");
  });

  it("sweepExpiredBuyOrders marks expired + refunds unfilled", () => {
    fund(db, "buyer", 500);
    const r = placeBuyOrder(db, "buyer", {
      worldId: "tunya", itemDescriptor: "rare_herb",
      unitPriceCc: 5, quantity: 100, ttlSeconds: 1,
    });
    // Backdate.
    db.prepare(`UPDATE auction_buy_orders SET expires_at = 1 WHERE id = ?`).run(r.buyOrderId);
    const s = sweepExpiredBuyOrders(db);
    assert.equal(s.ok, true);
    assert.equal(s.expired, 1);
    assert.equal(s.refunded, 500);
    assert.equal(balance(db, "buyer"), 500);
    const after = db.prepare(`SELECT status FROM auction_buy_orders WHERE id = ?`).get(r.buyOrderId);
    assert.equal(after.status, "expired");
  });

  it("fill on expired order is rejected", () => {
    fund(db, "buyer", 500);
    const r = placeBuyOrder(db, "buyer", {
      worldId: "tunya", itemDescriptor: "rare_herb",
      unitPriceCc: 5, quantity: 100,
    });
    db.prepare(`UPDATE auction_buy_orders SET expires_at = 1 WHERE id = ?`).run(r.buyOrderId);
    const f = fillBuyOrder(db, r.buyOrderId, "seller", 10);
    assert.equal(f.ok, false);
    assert.equal(f.error, "order_expired");
  });

  it("re-cancel returns already_cancelled", () => {
    fund(db, "buyer", 500);
    const r = placeBuyOrder(db, "buyer", {
      worldId: "tunya", itemDescriptor: "rare_herb",
      unitPriceCc: 5, quantity: 100,
    });
    cancelBuyOrder(db, r.buyOrderId, "buyer");
    const c2 = cancelBuyOrder(db, r.buyOrderId, "buyer");
    assert.equal(c2.ok, false);
    assert.equal(c2.error, "already_cancelled");
  });

  it("cancel by non-owner is rejected", () => {
    fund(db, "buyer", 500);
    const r = placeBuyOrder(db, "buyer", {
      worldId: "tunya", itemDescriptor: "rare_herb",
      unitPriceCc: 5, quantity: 100,
    });
    const c = cancelBuyOrder(db, r.buyOrderId, "other");
    assert.equal(c.ok, false);
    assert.equal(c.error, "not_owner");
  });
});
