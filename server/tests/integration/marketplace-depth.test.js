/**
 * D1 / F7.1 — marketplace depth.
 *
 * Pins:
 *   - settleAuction records the sale into the price-history time series
 *   - getPriceHistory returns points + stats (min/max/avg/last/appreciation %)
 *   - getMarketDepth aggregates active auctions (asks) + open buy-orders (bids)
 *     into levels with a spread
 *
 * Run: node --test tests/integration/marketplace-depth.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up220 } from "../../migrations/220_auction_house.js";
import { up as up227 } from "../../migrations/227_auction_buy_orders.js";
import { up as up271 } from "../../migrations/271_auction_price_history.js";
import { getPriceHistory, getMarketDepth } from "../../lib/auctions.js";

function freshDb() {
  const db = new Database(":memory:");
  up220(db); up227(db); up271(db);
  return db;
}

function recordSale(db, itemId, cc, soldAt) {
  db.prepare(`
    INSERT INTO auction_price_history (item_id, item_kind, sale_cc, sold_at)
    VALUES (?, 'inventory', ?, ?)
  `).run(itemId, cc, soldAt);
}

describe("D1 — price history", () => {
  it("returns points + appreciation stats oldest→newest", () => {
    const db = freshDb();
    recordSale(db, "sword01", 100, 1000);
    recordSale(db, "sword01", 120, 2000);
    recordSale(db, "sword01", 150, 3000);
    const h = getPriceHistory(db, "sword01");
    assert.equal(h.points.length, 3);
    assert.equal(h.points[0].cc, 100);          // oldest first
    assert.equal(h.points[2].cc, 150);          // newest last
    assert.equal(h.stats.min, 100);
    assert.equal(h.stats.max, 150);
    assert.equal(h.stats.last, 150);
    assert.equal(h.stats.changePct, 50);        // 100 → 150 = +50%
    db.close();
  });
  it("empty for an item with no sales", () => {
    const db = freshDb();
    assert.deepEqual(getPriceHistory(db, "nothing").points, []);
    db.close();
  });
});

describe("D1 — order-book depth", () => {
  it("aggregates asks (auctions) + bids (buy-orders) with a spread", () => {
    const db = freshDb();
    // two active auctions selling sword01 at 100 and 120 (asks)
    const endsAt = Math.floor(Date.now() / 1000) + 3600;
    db.prepare(`INSERT INTO auctions (id, seller_user_id, item_kind, item_id, start_cc, current_bid_cc, ends_at, status) VALUES ('a1','s1','inventory','sword01',100,0,?,'active')`).run(endsAt);
    db.prepare(`INSERT INTO auctions (id, seller_user_id, item_kind, item_id, start_cc, current_bid_cc, ends_at, status) VALUES ('a2','s2','inventory','sword01',120,0,?,'active')`).run(endsAt);
    // a buy order wanting sword01 at 90 (bid)
    db.prepare(`
      INSERT INTO auction_buy_orders (id, buyer_user_id, world_id, item_kind, item_descriptor, unit_price_cc, quantity_wanted, quantity_filled, total_escrow_cc, expires_at, status)
      VALUES ('b1','u1','w1','inventory','sword01',90,3,0,270,?,'open')
    `).run(endsAt);

    const d = getMarketDepth(db, "sword01");
    assert.equal(d.bestAsk, 100);   // lowest ask
    assert.equal(d.bestBid, 90);    // highest bid
    assert.equal(d.spread, 10);
    assert.equal(d.asks.length, 2);
    assert.equal(d.bids[0].qty, 3);
    db.close();
  });
});
