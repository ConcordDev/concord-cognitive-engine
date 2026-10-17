// INC-103 — auction house authorization regression tests.
//
// Pins: only the owner can list an item, only existing items can be listed,
// duplicate active listings are rejected, settlement re-checks ownership and
// refunds the bidder if ownership changed, buy-order fills require the seller
// to own and deliver the item, and the GET /api/auctions/buy-orders route is
// registered before the /:auctionId catch-all.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  createAuction,
  placeBid,
  settleAuction,
  placeBuyOrder,
  fillBuyOrder,
  listOpenBuyOrders,
} from "../lib/auctions.js";
import { up as upAuctions } from "../migrations/220_auction_house.js";
import { up as upBuyOrders } from "../migrations/227_auction_buy_orders.js";
import { up as upPriceHistory } from "../migrations/271_auction_price_history.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function freshDb() {
  const db = new Database(":memory:");
  upAuctions(db);
  upBuyOrders(db);
  upPriceHistory(db);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, concordia_credits REAL NOT NULL DEFAULT 0);
    CREATE TABLE reward_ledger (id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, amount_cc REAL, ts INTEGER, ref_id TEXT);
    CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT);
    CREATE TABLE player_inventory (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      item_type   TEXT NOT NULL DEFAULT 'material',
      item_id     TEXT NOT NULL,
      item_name   TEXT NOT NULL DEFAULT '',
      quantity    INTEGER NOT NULL DEFAULT 1,
      quality     INTEGER NOT NULL DEFAULT 50,
      acquired_at INTEGER NOT NULL DEFAULT (unixepoch())
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
  return db.prepare(`SELECT concordia_credits AS b FROM users WHERE id = ?`).get(userId)?.b ?? 0;
}

function seedDtu(db, id, owner) {
  db.prepare(`INSERT INTO dtus (id, creator_id) VALUES (?, ?)`).run(id, owner);
}

function seedInventory(db, userId, itemId, quantity) {
  db.prepare(`INSERT INTO player_inventory (id, user_id, item_id, quantity) VALUES (?, ?, ?, ?)`).run(crypto.randomUUID(), userId, itemId, quantity);
}

describe("INC-103 — auction house authz", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("account B cannot list A's DTU", () => {
    seedDtu(db, "dtu_a", "alice");
    const r = createAuction(db, "bob", { itemKind: "dtu", itemId: "dtu_a", startCc: 5 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_authorized");
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM auctions`).get().c, 0, "no row created");
  });

  it("listing a nonexistent DTU is rejected", () => {
    const r = createAuction(db, "alice", { itemKind: "dtu", itemId: "missing", startCc: 5 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "item_not_found");
  });

  it("anonymous placeholder ids cannot create listings", () => {
    seedDtu(db, "dtu_a", "anon"); // even if a row existed, the caller id is still anon
    const r = createAuction(db, "anon", { itemKind: "dtu", itemId: "dtu_a", startCc: 5 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "auth_required");
  });

  it(" rejects a second active listing of the same item by the same seller", () => {
    seedDtu(db, "dtu_a", "alice");
    const first = createAuction(db, "alice", { itemKind: "dtu", itemId: "dtu_a", startCc: 5 });
    assert.equal(first.ok, true);
    const second = createAuction(db, "alice", { itemKind: "dtu", itemId: "dtu_a", startCc: 10 });
    assert.equal(second.ok, false);
    assert.equal(second.error, "already_listed");
  });

  it("owner can list, bid, and settle; DTU transfers to the winner", () => {
    fund(db, "bidder", 1000);
    fund(db, "alice", 0);
    seedDtu(db, "dtu_a", "alice");
    const c = createAuction(db, "alice", { itemKind: "dtu", itemId: "dtu_a", startCc: 5 });
    assert.equal(c.ok, true);
    assert.equal(placeBid(db, c.auctionId, "bidder", 20).ok, true);
    const s = settleAuction(db, c.auctionId, { reason: "manual" });
    assert.equal(s.ok, true);
    assert.equal(balance(db, "alice"), 19, "seller gets bid minus 5% fee");
    assert.equal(db.prepare(`SELECT creator_id FROM dtus WHERE id = ?`).get("dtu_a").creator_id, "bidder");
    assert.equal(db.prepare(`SELECT status FROM auctions WHERE id = ?`).get(c.auctionId).status, "sold");
  });

  it("settle aborts and refunds the winning hold if the seller no longer owns the item", () => {
    fund(db, "bidder", 1000);
    fund(db, "alice", 0);
    seedDtu(db, "dtu_a", "alice");
    const c = createAuction(db, "alice", { itemKind: "dtu", itemId: "dtu_a", startCc: 5 });
    assert.equal(placeBid(db, c.auctionId, "bidder", 20).ok, true);

    // Ownership changes out from under the listing before settlement.
    db.prepare(`UPDATE dtus SET creator_id = ? WHERE id = ?`).run("thief", "dtu_a");

    const beforeBidder = balance(db, "bidder");
    const s = settleAuction(db, c.auctionId, { reason: "manual" });
    assert.equal(s.ok, false);
    assert.equal(s.error, "ownership_changed");
    assert.equal(balance(db, "bidder"), beforeBidder + 20, "winning hold refunded");
    assert.equal(balance(db, "alice"), 0, "seller never paid");
    assert.equal(db.prepare(`SELECT creator_id FROM dtus WHERE id = ?`).get("dtu_a").creator_id, "thief", "thief keeps the DTU");
    assert.equal(db.prepare(`SELECT status FROM auctions WHERE id = ?`).get(c.auctionId).status, "cancelled");
  });

  it("inventory listing requires the seller to own the item", () => {
    const r = createAuction(db, "bob", { itemKind: "inventory", itemId: "sword", startCc: 5 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_authorized");
  });

  it("buy-order fill requires the seller to own and deliver the inventory", () => {
    fund(db, "buyer", 500);
    fund(db, "seller", 0);
    const placed = placeBuyOrder(db, "buyer", {
      worldId: "tunya",
      itemKind: "inventory",
      itemDescriptor: "herb",
      unitPriceCc: 5,
      quantity: 10,
    });
    assert.equal(placed.ok, true);

    // Seller has nothing — fill must be refused and the buyer's escrow untouched.
    const f = fillBuyOrder(db, placed.buyOrderId, "seller", 5);
    assert.equal(f.ok, false);
    assert.equal(f.error, "insufficient_inventory");
    assert.equal(balance(db, "buyer"), 500 - 50, "escrow untouched");
    assert.equal(balance(db, "seller"), 0, "seller not paid");

    // After stocking the seller, the same order fills and transfers the item.
    seedInventory(db, "seller", "herb", 10);
    const f2 = fillBuyOrder(db, placed.buyOrderId, "seller", 5);
    assert.equal(f2.ok, true);
    assert.equal(f2.payment, 25);
    assert.equal(balance(db, "seller"), 25);
    assert.equal(db.prepare(`SELECT quantity FROM player_inventory WHERE user_id = ? AND item_id = ?`).get("seller", "herb").quantity, 5);
    assert.equal(db.prepare(`SELECT quantity FROM player_inventory WHERE user_id = ? AND item_id = ?`).get("buyer", "herb").quantity, 5);
  });

  it("GET /api/auctions/buy-orders is declared before GET /api/auctions/:auctionId", () => {
    const src = readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const buyOrdersLine = src.indexOf('app.get("/api/auctions/buy-orders"');
    const auctionIdLine = src.indexOf('app.get("/api/auctions/:auctionId"');
    assert.ok(buyOrdersLine > -1, "buy-orders route exists");
    assert.ok(auctionIdLine > -1, ":auctionId route exists");
    assert.ok(buyOrdersLine < auctionIdLine, "buy-orders registered before the catch-all");
  });

  it("listOpenBuyOrders returns the public buy-order book", () => {
    fund(db, "buyer", 500);
    placeBuyOrder(db, "buyer", {
      worldId: "tunya",
      itemKind: "inventory",
      itemDescriptor: "herb",
      unitPriceCc: 7,
      quantity: 10,
    });
    const orders = listOpenBuyOrders(db, { worldId: "tunya", itemDescriptor: "herb" });
    assert.equal(orders.length, 1);
    assert.equal(orders[0].unit_price_cc, 7);
  });

  it("buy-order fill succeeds when seller inventory row has id=NULL", () => {
    fund(db, "buyer", 500);
    fund(db, "seller", 0);
    // Live rows have a nullable `id` column and PK on (user_id, item_id).
    db.prepare(`INSERT INTO player_inventory (user_id, item_id, quantity) VALUES (?, ?, ?)`).run("seller", "herb", 10);

    const placed = placeBuyOrder(db, "buyer", {
      worldId: "tunya",
      itemKind: "inventory",
      itemDescriptor: "herb",
      unitPriceCc: 5,
      quantity: 10,
    });
    assert.equal(placed.ok, true);

    const f = fillBuyOrder(db, placed.buyOrderId, "seller", 6);
    assert.equal(f.ok, true, JSON.stringify(f));
    assert.equal(f.payment, 30);
    assert.equal(db.prepare(`SELECT quantity FROM player_inventory WHERE user_id = ? AND item_id = ?`).get("seller", "herb").quantity, 4, "seller loses 6 units");
    // buyer had no row — INSERT path must create one
    assert.equal(db.prepare(`SELECT quantity FROM player_inventory WHERE user_id = ? AND item_id = ?`).get("buyer", "herb").quantity, 6, "buyer gains 6 units");
  });
});
