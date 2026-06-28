// Phase V1 — auction sell-side, against a REAL in-memory sqlite DB.
//
// The sibling auctions.test.js drives the lib through a hand-rolled fake DB
// (good for branch coverage, but it can't catch a schema/SQL drift). This file
// boots the actual migration 220 (auctions + auction_bids) + 271
// (auction_price_history) tables plus a minimal users + reward_ledger, so every
// assertion below is a genuine DB round-trip: the SQL really ran, the wallet
// column really moved, the price-history row was really written.
//
// It asserts COMPUTED values (5% platform fee math, snipe-window extension,
// refund of the outbid leader, price-history stats) — not just { ok:true }.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  createAuction,
  placeBid,
  cancelAuction,
  settleAuction,
  listActiveAuctions,
  getAuction,
  sweepEndedAuctions,
  getPriceHistory,
  getMarketDepth,
} from "../lib/auctions.js";
import { up as upAuctions } from "../migrations/220_auction_house.js";
import { up as upPriceHistory } from "../migrations/271_auction_price_history.js";

function freshDb() {
  const db = new Database(":memory:");
  upAuctions(db);
  upPriceHistory(db);
  // Concord Coin balances live in users.concordia_credits; the wallet
  // primitives log to reward_ledger. dtus is needed for the DTU ownership
  // transfer on settlement.
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      concordia_credits REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE reward_ledger (
      id TEXT PRIMARY KEY, user_id TEXT, kind TEXT,
      amount_cc REAL, ts INTEGER, ref_id TEXT
    );
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, creator_id TEXT
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

describe("auctions — real sqlite round-trip", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("createAuction persists a real row queryable by getAuction/listActive", () => {
    const c = createAuction(db, "seller", { itemKind: "dtu", itemId: "dtu_1", startCc: 100, title: "Rare scroll" });
    assert.equal(c.ok, true);
    const row = db.prepare(`SELECT * FROM auctions WHERE id = ?`).get(c.auctionId);
    assert.equal(row.seller_user_id, "seller");
    assert.equal(row.start_cc, 100);
    assert.equal(row.title, "Rare scroll");
    assert.equal(row.status, "active");
    const active = listActiveAuctions(db);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, c.auctionId);
    assert.equal(active[0].startCc, 100);
  });

  it("durationS is clamped to [60, 86400] and reflected in ends_at", () => {
    const before = Math.floor(Date.now() / 1000);
    const c = createAuction(db, "s", { itemId: "i", durationS: 5 }); // below floor
    const row = db.prepare(`SELECT starts_at, ends_at FROM auctions WHERE id = ?`).get(c.auctionId);
    assert.equal(row.ends_at - row.starts_at, 60, "clamped up to 60s floor");
    assert.ok(row.ends_at >= before + 60);
  });

  it("placeBid debits bidder, records a real bid row, advances current_bid_cc", () => {
    fund(db, "bidder", 1000);
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    const r = placeBid(db, c.auctionId, "bidder", 150);
    assert.equal(r.ok, true);
    assert.equal(balance(db, "bidder"), 850, "1000 − 150 held");
    const a = db.prepare(`SELECT current_bid_cc, bid_count, leading_bidder_user_id FROM auctions WHERE id = ?`).get(c.auctionId);
    assert.equal(a.current_bid_cc, 150);
    assert.equal(a.bid_count, 1);
    assert.equal(a.leading_bidder_user_id, "bidder");
    const bids = db.prepare(`SELECT * FROM auction_bids WHERE auction_id = ?`).all(c.auctionId);
    assert.equal(bids.length, 1);
    assert.equal(bids[0].amount_cc, 150);
  });

  it("outbidding refunds the prior leader and marks the bid refunded", () => {
    fund(db, "b1", 500);
    fund(db, "b2", 500);
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    placeBid(db, c.auctionId, "b1", 120);
    assert.equal(balance(db, "b1"), 380);
    placeBid(db, c.auctionId, "b2", 200);
    assert.equal(balance(db, "b1"), 500, "outbid leader fully refunded");
    assert.equal(balance(db, "b2"), 300);
    const refunded = db.prepare(`SELECT refunded_at FROM auction_bids WHERE bidder_user_id = 'b1' AND auction_id = ?`).get(c.auctionId);
    assert.ok(refunded.refunded_at, "prior leader's bid row stamped refunded_at");
  });

  it("insufficient funds rejects without mutating auction state", () => {
    fund(db, "poor", 50);
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    const r = placeBid(db, c.auctionId, "poor", 100);
    assert.equal(r.ok, false);
    assert.equal(r.error, "insufficient_funds");
    const a = db.prepare(`SELECT current_bid_cc, bid_count FROM auctions WHERE id = ?`).get(c.auctionId);
    assert.equal(a.current_bid_cc, 0);
    assert.equal(a.bid_count, 0);
    assert.equal(balance(db, "poor"), 50, "no debit");
  });

  it("bid inside the snipe window extends ends_at by SNIPE_EXTEND_S", () => {
    fund(db, "bidder", 1000);
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 10 });
    // Force the auction to end 30s out (inside the 60s snipe window).
    const endSoon = Math.floor(Date.now() / 1000) + 30;
    db.prepare(`UPDATE auctions SET ends_at = ? WHERE id = ?`).run(endSoon, c.auctionId);
    const r = placeBid(db, c.auctionId, "bidder", 20);
    assert.equal(r.ok, true);
    const a = db.prepare(`SELECT ends_at FROM auctions WHERE id = ?`).get(c.auctionId);
    assert.equal(a.ends_at, endSoon + 60, "snipe extends by 60s");
  });

  it("settle pays seller bid − 5% fee, transfers DTU, writes price-history", () => {
    fund(db, "bidder", 1000);
    fund(db, "seller", 0);
    seedDtu(db, "dtu_1", "seller");
    const c = createAuction(db, "seller", { itemKind: "dtu", itemId: "dtu_1", startCc: 100, worldId: "tunya" });
    placeBid(db, c.auctionId, "bidder", 200);
    const s = settleAuction(db, c.auctionId, { reason: "manual" });
    assert.equal(s.ok, true);
    assert.equal(s.platformFee, 10);      // 5% of 200
    assert.equal(s.sellerPayout, 190);
    assert.equal(balance(db, "seller"), 190);
    // DTU ownership really transferred.
    assert.equal(db.prepare(`SELECT creator_id FROM dtus WHERE id = 'dtu_1'`).get().creator_id, "bidder");
    // Auction marked sold.
    assert.equal(db.prepare(`SELECT status FROM auctions WHERE id = ?`).get(c.auctionId).status, "sold");
    // Price-history row written.
    const ph = db.prepare(`SELECT * FROM auction_price_history WHERE item_id = 'dtu_1'`).all();
    assert.equal(ph.length, 1);
    assert.equal(ph[0].sale_cc, 200);
    assert.equal(ph[0].world_id, "tunya");
  });

  it("buyout instant-settles via placeBid and ends the auction", () => {
    fund(db, "buyer", 1000);
    fund(db, "seller", 0);
    seedDtu(db, "dtu_1", "seller");
    const c = createAuction(db, "seller", { itemKind: "dtu", itemId: "dtu_1", startCc: 100, buyoutCc: 500 });
    const r = placeBid(db, c.auctionId, "buyer", 500);
    assert.equal(r.ok, true);
    assert.equal(r.settled, true);
    assert.equal(db.prepare(`SELECT status FROM auctions WHERE id = ?`).get(c.auctionId).status, "sold");
    assert.equal(balance(db, "seller"), 475, "500 − 5% fee");
  });

  it("sweepEndedAuctions settles past-deadline auctions", () => {
    fund(db, "bidder", 1000);
    fund(db, "seller", 0);
    seedDtu(db, "dtu_1", "seller");
    const c = createAuction(db, "seller", { itemKind: "dtu", itemId: "dtu_1", startCc: 100 });
    placeBid(db, c.auctionId, "bidder", 200);
    db.prepare(`UPDATE auctions SET ends_at = unixepoch() - 5 WHERE id = ?`).run(c.auctionId);
    const sw = sweepEndedAuctions(db);
    assert.equal(sw.settled, 1);
    assert.equal(db.prepare(`SELECT status FROM auctions WHERE id = ?`).get(c.auctionId).status, "sold");
  });

  it("cancel by seller of a no-bid auction frees it; with bids it is rejected", () => {
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    const ok = cancelAuction(db, c.auctionId, "seller");
    assert.equal(ok.ok, true);
    assert.equal(db.prepare(`SELECT status FROM auctions WHERE id = ?`).get(c.auctionId).status, "cancelled");

    fund(db, "bidder", 500);
    const c2 = createAuction(db, "seller", { itemId: "dtu_2", startCc: 100 });
    placeBid(db, c2.auctionId, "bidder", 120);
    const bad = cancelAuction(db, c2.auctionId, "seller");
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "has_bids");
  });

  it("getPriceHistory returns stats computed over real sales", () => {
    // Three sales of the same item at 100, 200, 150.
    for (const [amt] of [[100], [200], [150]]) {
      db.prepare(`INSERT INTO auction_price_history (item_id, sale_cc) VALUES ('widget', ?)`).run(amt);
    }
    const h = getPriceHistory(db, "widget");
    assert.equal(h.stats.count, 3);
    assert.equal(h.stats.min, 100);
    assert.equal(h.stats.max, 200);
    assert.equal(h.stats.avg, 150);
    assert.equal(h.points.length, 3);
  });

  it("getMarketDepth reports asks from auctions and the spread", () => {
    createAuction(db, "s1", { itemId: "ore", startCc: 50 });
    createAuction(db, "s2", { itemId: "ore", startCc: 70 });
    const d = getMarketDepth(db, "ore");
    assert.ok(d.asks.length >= 1);
    assert.equal(d.bestAsk, 50, "lowest ask is best");
  });
});
