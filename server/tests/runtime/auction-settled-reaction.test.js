// tests/runtime/auction-settled-reaction.test.js
//
// Pins the seventh reactor in lib/runtime/reactions.js: auction.settled ->
// durable notifications for both the seller and the winning bidder.
// Checked before writing anything: lib/auctions.js's settleAuction had
// only a real-time-only auction:settled emit, same gap class as
// marketplace.purchased/achievement.unlocked — and notably worse here,
// since real auction settlement is HEARTBEAT-driven (sweepEndedAuctions),
// not a live user action, so "offline at the exact moment" is the common
// case, not an edge case.
//
// Uses the same real-migrated-DB harness tests/auctions-realdb.test.js
// already established (migration 220 + 271, minimal users/reward_ledger/
// dtus tables) so this proves the reaction fires off an ACTUAL
// createAuction -> placeBid -> settleAuction chain — real fee math, real
// wallet credit, real DTU ownership transfer — not a synthetic publish().
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createAuction, placeBid, settleAuction } from "../../lib/auctions.js";
import { up as upAuctions } from "../../migrations/220_auction_house.js";
import { up as upPriceHistory } from "../../migrations/271_auction_price_history.js";
import { initReactions, _resetReactions } from "../../lib/runtime/reactions.js";
import { _reset as _resetBus } from "../../lib/runtime/event-bus.js";
import { getNotifications } from "../../emergent/social-layer.js";

function freshDb() {
  const db = new Database(":memory:");
  upAuctions(db);
  upPriceHistory(db);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, concordia_credits REAL NOT NULL DEFAULT 0);
    CREATE TABLE reward_ledger (id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, amount_cc REAL, ts INTEGER, ref_id TEXT);
    CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT);
  `);
  return db;
}
function fund(db, userId, amount) {
  db.prepare(`INSERT INTO users (id, concordia_credits) VALUES (?, ?)
              ON CONFLICT(id) DO UPDATE SET concordia_credits = concordia_credits + excluded.concordia_credits`)
    .run(userId, amount);
}

let db;
beforeEach(() => {
  db = freshDb();
  _resetBus();
  _resetReactions();
  delete globalThis.STATE;
});
afterEach(() => {
  _resetReactions();
  delete globalThis.STATE;
});

describe("auction.settled -> durable notifications, off a REAL createAuction/placeBid/settleAuction chain", () => {
  it("both the seller and the winning bidder get a real, distinct notification", () => {
    globalThis.STATE = {};
    initReactions();
    fund(db, "bidder", 1000);
    fund(db, "seller", 0);
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    placeBid(db, c.auctionId, "bidder", 200);

    const s = settleAuction(db, c.auctionId, { reason: "manual" });
    assert.equal(s.ok, true);
    assert.equal(s.sellerPayout, 190, "sanity: real 5% fee math, unrelated to this reactor");

    const sellerNotifs = getNotifications(globalThis.STATE, "seller").notifications;
    assert.equal(sellerNotifs.length, 1);
    assert.equal(sellerNotifs[0].type, "auction_sold");
    assert.match(sellerNotifs[0].content, /\$190\.00/);

    const bidderNotifs = getNotifications(globalThis.STATE, "bidder").notifications;
    assert.equal(bidderNotifs.length, 1);
    assert.equal(bidderNotifs[0].type, "auction_won");
    assert.match(bidderNotifs[0].content, /200 CC/);
  });

  it("a no-bid expiry never notifies anyone — it's a real, distinct branch that never publishes auction.settled", () => {
    globalThis.STATE = {};
    initReactions();
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    const s = settleAuction(db, c.auctionId, { reason: "manual" });
    assert.equal(s.expired, true, "sanity: this really is the no-bid branch");
    assert.equal(getNotifications(globalThis.STATE, "seller").total, 0);
  });

  it("no STATE yet -> the real settlement still succeeds; reactor honestly no-ops", () => {
    initReactions();
    fund(db, "bidder", 1000);
    fund(db, "seller", 0);
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    placeBid(db, c.auctionId, "bidder", 200);
    const s = settleAuction(db, c.auctionId, { reason: "manual" });
    assert.equal(s.ok, true, "the real money/ownership movement must never depend on the reaction graph");
  });
});
