// Macro surface for the auction house (server/domains/auctions.js).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a REAL in-memory sqlite DB, and asserts the macro both delegates to
// the lib AND mutates / reads the database for real (computed values, not just
// { ok:true }). Mirrors the register(domain, name, handler) collection pattern
// the server uses so we exercise the exact handlers without booting server.js.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import registerAuctionMacros from "../domains/auctions.js";
import { up as upAuctions } from "../migrations/220_auction_house.js";
import { up as upPriceHistory } from "../migrations/271_auction_price_history.js";
import { up as upBuyOrders } from "../migrations/227_auction_buy_orders.js";

function collectMacros() {
  const map = new Map();
  registerAuctionMacros((domain, name, handler) => {
    map.set(name, handler);
  });
  return map;
}

function freshDb() {
  const db = new Database(":memory:");
  upAuctions(db);
  upPriceHistory(db);
  upBuyOrders(db);
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
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES (?, ?)
    ON CONFLICT(id) DO UPDATE SET concordia_credits = concordia_credits + excluded.concordia_credits`).run(userId, amount);
}
function ctxFor(db, userId) {
  return { db, actor: { userId } };
}

describe("auctions domain macros", () => {
  let db, macros;
  beforeEach(() => {
    db = freshDb();
    macros = collectMacros();
    // Seed ownership for the items the tests exercise.
    db.prepare(`INSERT INTO dtus (id, creator_id) VALUES (?, ?)`).run("dtu_1", "seller");
    db.prepare(`INSERT INTO dtus (id, creator_id) VALUES (?, ?)`).run("gem", "s");
    db.prepare(`INSERT INTO player_inventory (id, user_id, item_id, quantity) VALUES (?, ?, ?, ?)`).run(crypto.randomUUID(), "seller", "ore", 100);
  });

  it("registers the full read + write surface", () => {
    for (const name of [
      "active", "get", "buy_orders", "price_history", "market_depth",
      "create", "bid", "cancel", "place_buy_order", "fill_buy_order", "cancel_buy_order",
    ]) {
      assert.equal(typeof macros.get(name), "function", `missing macro: ${name}`);
    }
  });

  it("create → active → bid → get round-trips through the DB", async () => {
    fund(db, "bidder", 1000);
    const created = await macros.get("create")(ctxFor(db, "seller"), {
      itemKind: "dtu", itemId: "dtu_1", startCc: 100, title: "Relic",
    });
    assert.equal(created.ok, true);
    const auctionId = created.auctionId;

    const active = await macros.get("active")(ctxFor(db, "seller"), {});
    assert.equal(active.ok, true);
    assert.equal(active.auctions.length, 1);
    assert.equal(active.auctions[0].id, auctionId);

    const bid = await macros.get("bid")(ctxFor(db, "bidder"), { auctionId, amountCc: 250 });
    assert.equal(bid.ok, true);
    assert.equal(db.prepare(`SELECT concordia_credits AS b FROM users WHERE id='bidder'`).get().b, 750);

    const got = await macros.get("get")(ctxFor(db, "seller"), { auctionId });
    assert.equal(got.ok, true);
    assert.equal(got.auction.current_bid_cc, 250);
    assert.equal(got.auction.recentBids.length, 1);
  });

  it("bid validates inputs without throwing", async () => {
    const noId = await macros.get("bid")(ctxFor(db, "u"), { amountCc: 10 });
    assert.equal(noId.ok, false);
    assert.equal(noId.reason, "no_auction_id");
    const noUser = await macros.get("bid")({ db }, { auctionId: "x", amountCc: 10 });
    assert.equal(noUser.ok, false);
    assert.equal(noUser.reason, "auth_required");
  });

  it("place_buy_order escrows, buy_orders lists it, cancel_buy_order refunds", async () => {
    fund(db, "buyer", 1000);
    const placed = await macros.get("place_buy_order")(ctxFor(db, "buyer"), {
      worldId: "tunya", itemDescriptor: "rare_herb", unitPriceCc: 5, quantity: 100,
    });
    assert.equal(placed.ok, true);
    assert.equal(placed.escrowCc, 500);
    assert.equal(db.prepare(`SELECT concordia_credits AS b FROM users WHERE id='buyer'`).get().b, 500);

    const list = await macros.get("buy_orders")(ctxFor(db, "buyer"), { worldId: "tunya", itemDescriptor: "rare_herb" });
    assert.equal(list.ok, true);
    assert.equal(list.buyOrders.length, 1);
    assert.equal(list.buyOrders[0].unit_price_cc, 5);

    const cancelled = await macros.get("cancel_buy_order")(ctxFor(db, "buyer"), { buyOrderId: placed.buyOrderId });
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.refundCc, 500);
    assert.equal(db.prepare(`SELECT concordia_credits AS b FROM users WHERE id='buyer'`).get().b, 1000);
  });

  it("fill_buy_order pays the seller", async () => {
    fund(db, "buyer", 1000); fund(db, "seller", 0);
    const placed = await macros.get("place_buy_order")(ctxFor(db, "buyer"), {
      itemKind: "inventory", itemDescriptor: "ore", unitPriceCc: 4, quantity: 50,
    });
    const filled = await macros.get("fill_buy_order")(ctxFor(db, "seller"), { buyOrderId: placed.buyOrderId, quantity: 20 });
    assert.equal(filled.ok, true);
    assert.equal(filled.payment, 80);
    assert.equal(db.prepare(`SELECT concordia_credits AS b FROM users WHERE id='seller'`).get().b, 80);
  });

  it("read macros return ok:false (not a throw) when ctx has no db", async () => {
    const r = await macros.get("active")({}, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("price_history + market_depth compute over real rows", async () => {
    db.prepare(`INSERT INTO auction_price_history (item_id, sale_cc) VALUES ('gem', 100), ('gem', 300)`).run();
    const ph = await macros.get("price_history")(ctxFor(db, "u"), { itemId: "gem" });
    assert.equal(ph.ok, true);
    assert.equal(ph.stats.count, 2);
    assert.equal(ph.stats.avg, 200);

    await macros.get("create")(ctxFor(db, "s"), { itemId: "gem", startCc: 250 });
    const md = await macros.get("market_depth")(ctxFor(db, "u"), { itemId: "gem" });
    assert.equal(md.ok, true);
    assert.equal(md.bestAsk, 250);
  });
});
