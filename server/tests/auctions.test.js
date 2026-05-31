// Phase V1 — auction house.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createAuction, placeBid, cancelAuction, settleAuction, listActiveAuctions, getAuction, sweepEndedAuctions } from "../lib/auctions.js";

function memDb() {
  const t = {
    auctions: new Map(),
    bids: [],
    wallets: new Map(),
    dtus: new Map(),
    ledger: [],
  };
  function _trim(s) { return String(s).replace(/\s+/g, " ").trim(); }
  return {
    transaction(fn) { return () => fn(); },
    prepare(sql) {
      const n = _trim(sql);
      return {
        run: (...args) => {
          if (n.startsWith("INSERT INTO auctions")) {
            const [id, sellerId, worldId, itemKind, itemId, title, startCc, buyoutCc, durationS] = args;
            t.auctions.set(id, {
              id, seller_user_id: sellerId, world_id: worldId,
              item_kind: itemKind, item_id: itemId, title,
              start_cc: startCc, current_bid_cc: 0, buyout_cc: buyoutCc,
              bid_count: 0, leading_bidder_user_id: null,
              starts_at: Math.floor(Date.now() / 1000),
              ends_at: Math.floor(Date.now() / 1000) + durationS,
              status: "active", settled_at: null,
            });
            return { changes: 1 };
          }
          if (n.startsWith("INSERT INTO auction_bids")) {
            const [id, auctionId, bidderId, amountCc] = args;
            t.bids.push({ id, auction_id: auctionId, bidder_user_id: bidderId, amount_cc: amountCc, placed_at: Math.floor(Date.now() / 1000), refunded_at: null });
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE auctions SET current_bid_cc = ?")) {
            const [amount, bidderId, endsAt, id] = args;
            const a = t.auctions.get(id);
            if (a) {
              a.current_bid_cc = amount;
              a.leading_bidder_user_id = bidderId;
              a.bid_count += 1;
              a.ends_at = endsAt;
              return { changes: 1 };
            }
            return { changes: 0 };
          }
          if (n.startsWith("UPDATE auctions SET status = 'cancelled'")) {
            const a = t.auctions.get(args[0]);
            if (a) { a.status = "cancelled"; a.settled_at = Math.floor(Date.now() / 1000); }
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE auctions SET status = 'expired'")) {
            const a = t.auctions.get(args[0]);
            if (a) { a.status = "expired"; a.settled_at = Math.floor(Date.now() / 1000); }
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE auctions SET status = 'sold'")) {
            const a = t.auctions.get(args[0]);
            if (a) { a.status = "sold"; a.settled_at = Math.floor(Date.now() / 1000); }
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE auction_bids SET refunded_at")) {
            const [auctionId, bidderId] = args;
            for (const b of t.bids) {
              if (b.auction_id === auctionId && b.bidder_user_id === bidderId && !b.refunded_at) {
                b.refunded_at = Math.floor(Date.now() / 1000);
              }
            }
            return { changes: 1 };
          }
          if (n.startsWith("SELECT balance FROM user_wallets")) {
            // get
            return null;
          }
          if (n.startsWith("UPDATE user_wallets SET balance = balance - ?")) {
            const [amount, userId] = args;
            t.wallets.set(userId, (t.wallets.get(userId) || 0) - amount);
            return { changes: 1 };
          }
          if (n.startsWith("INSERT INTO user_wallets")) {
            const [userId, amount] = args;
            t.wallets.set(userId, (t.wallets.get(userId) || 0) + amount);
            return { changes: 1 };
          }
          if (n.startsWith("INSERT INTO economy_ledger")) {
            t.ledger.push({ userId: args[1], kind: args[2], amount: args[3], ref: args[5] });
            return { changes: 1 };
          }
          if (n.startsWith("UPDATE dtus SET creator_id")) {
            const [newOwner, dtuId] = args;
            const d = t.dtus.get(dtuId);
            if (d) { d.creator_id = newOwner; return { changes: 1 }; }
            return { changes: 0 };
          }
          return { changes: 0 };
        },
        get: (...args) => {
          if (n.startsWith("SELECT balance FROM user_wallets WHERE user_id = ?")) {
            const balance = t.wallets.get(args[0]);
            return balance !== undefined ? { balance } : null;
          }
          if (n.startsWith("SELECT * FROM auctions WHERE id = ?")) {
            return t.auctions.get(args[0]) || null;
          }
          return null;
        },
        all: (...args) => {
          if (n.includes("FROM auctions") && n.includes("status = 'active'") && n.includes("ends_at > unixepoch()")) {
            const now = Math.floor(Date.now() / 1000);
            return [...t.auctions.values()]
              .filter(a => a.status === "active" && a.ends_at > now)
              .map(a => ({ id: a.id, sellerUserId: a.seller_user_id, worldId: a.world_id, itemKind: a.item_kind, itemId: a.item_id, title: a.title, startCc: a.start_cc, currentBidCc: a.current_bid_cc, buyoutCc: a.buyout_cc, bidCount: a.bid_count, leadingBidderUserId: a.leading_bidder_user_id, startsAt: a.starts_at, endsAt: a.ends_at }));
          }
          if (n.startsWith("SELECT id FROM auctions WHERE status = 'active' AND ends_at <= unixepoch()")) {
            const now = Math.floor(Date.now() / 1000);
            return [...t.auctions.values()]
              .filter(a => a.status === "active" && a.ends_at <= now)
              .map(a => ({ id: a.id }));
          }
          if (n.includes("FROM auction_bids WHERE auction_id = ?")) {
            const [auctionId] = args;
            return t.bids.filter(b => b.auction_id === auctionId).map(b => ({ id: b.id, bidderUserId: b.bidder_user_id, amountCc: b.amount_cc, placedAt: b.placed_at }));
          }
          return [];
        },
      };
    },
    _t: t,
    _seedWallet(userId, balance) { t.wallets.set(userId, balance); },
    _seedDtu(id, ownerId) { t.dtus.set(id, { id, creator_id: ownerId }); },
  };
}

describe("Phase V1 — auctions", () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it("createAuction requires itemId", () => {
    const r = createAuction(db, "u1", {});
    assert.equal(r.ok, false);
  });

  it("placeBid below start rejected", () => {
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    db._seedWallet("bidder", 1000);
    const r = placeBid(db, c.auctionId, "bidder", 50);
    assert.equal(r.ok, false);
    assert.equal(r.error, "below_start");
  });

  it("placeBid must exceed current bid", () => {
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    db._seedWallet("bidder1", 1000);
    db._seedWallet("bidder2", 1000);
    placeBid(db, c.auctionId, "bidder1", 100);
    const r = placeBid(db, c.auctionId, "bidder2", 100);
    assert.equal(r.ok, false);
    assert.equal(r.error, "must_exceed_current");
  });

  it("placeBid refunds prior leader", () => {
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    db._seedWallet("bidder1", 500);
    db._seedWallet("bidder2", 500);
    placeBid(db, c.auctionId, "bidder1", 100);
    assert.equal(db._t.wallets.get("bidder1"), 400);
    placeBid(db, c.auctionId, "bidder2", 150);
    assert.equal(db._t.wallets.get("bidder1"), 500);  // refunded
    assert.equal(db._t.wallets.get("bidder2"), 350);
  });

  it("seller cannot bid on own", () => {
    const c = createAuction(db, "u1", { itemId: "dtu_1", startCc: 100 });
    db._seedWallet("u1", 500);
    const r = placeBid(db, c.auctionId, "u1", 100);
    assert.equal(r.ok, false);
    assert.equal(r.error, "cannot_bid_on_own");
  });

  it("buyout triggers instant settle", () => {
    db._seedDtu("dtu_1", "seller");
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100, buyoutCc: 500 });
    db._seedWallet("buyer", 1000);
    const r = placeBid(db, c.auctionId, "buyer", 500);
    assert.equal(r.ok, true);
    assert.equal(r.settled, true);
    // DTU ownership transferred.
    assert.equal(db._t.dtus.get("dtu_1").creator_id, "buyer");
    // Auction marked sold.
    assert.equal(db._t.auctions.get(c.auctionId).status, "sold");
  });

  it("seller payout = bid - 5% platform fee", () => {
    db._seedDtu("dtu_1", "seller");
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    db._seedWallet("bidder", 500);
    placeBid(db, c.auctionId, "bidder", 200);
    // Force settle.
    const r = settleAuction(db, c.auctionId, { reason: "manual" });
    assert.equal(r.ok, true);
    assert.equal(r.platformFee, 10);  // 5% of 200
    assert.equal(r.sellerPayout, 190);
    assert.equal(db._t.wallets.get("seller"), 190);
  });

  it("cancel with bids rejected", () => {
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    db._seedWallet("bidder", 500);
    placeBid(db, c.auctionId, "bidder", 100);
    const r = cancelAuction(db, c.auctionId, "seller");
    assert.equal(r.ok, false);
    assert.equal(r.error, "has_bids");
  });

  it("cancel by non-seller rejected", () => {
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    const r = cancelAuction(db, c.auctionId, "rando");
    assert.equal(r.ok, false);
    assert.equal(r.error, "not_authorized");
  });

  it("settle with no bids → expired", () => {
    const c = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    const r = settleAuction(db, c.auctionId);
    assert.equal(r.ok, true);
    assert.equal(r.expired, true);
  });

  it("listActiveAuctions filters expired", () => {
    const c1 = createAuction(db, "seller", { itemId: "dtu_1", startCc: 100 });
    const c2 = createAuction(db, "seller", { itemId: "dtu_2", startCc: 100 });
    // Force one expired.
    db._t.auctions.get(c1.auctionId).ends_at = Math.floor(Date.now() / 1000) - 1;
    const active = listActiveAuctions(db);
    assert.equal(active.length, 1);
    assert.equal(active[0].id, c2.auctionId);
  });
});
