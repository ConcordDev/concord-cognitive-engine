/**
 * Black-market lens — Phase-2 money-conservation + price-math contract.
 *
 * The existing tests/black-market.test.js covers surface/browse/purchase/expiry
 * shape. This file pins the LOAD-BEARING economic invariants the black-market
 * lens depends on, because this is a real-currency (sparks) lens:
 *
 *   1. NO MONEY MINTED — a purchase only DEBITS the buyer's sparks; there is no
 *      seller credit (intercepts are NPC-fence loot), so total circulating
 *      sparks drops by EXACTLY sparksSpent. A failed (insufficient) buy moves
 *      zero sparks.
 *   2. effectivePrice rep-discount math — reputation in [-50,100] scales the
 *      listed price by ±25%, floored at 1 spark. Pinned at the rep extremes so
 *      a regression that lets price go to 0/negative/Infinity is caught.
 *   3. Fail-CLOSED on a degenerate listing price (the price comes from a NOT
 *      NULL INTEGER column, but assert the floor holds regardless).
 *
 * Hermetic: in-memory better-sqlite3, only the four tables the lib touches,
 * no server boot, no network. Mirrors migration 080's schema exactly.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  surfaceInterceptedMessage,
  browseListings,
  purchaseListing,
  getBuyerReputation,
} from "../lib/black-market.js";

function bootDb() {
  const db = new Database(":memory:");
  // Schema mirrors server/migrations/080_black_market.js + the columns the lib
  // reads on users / concord_link_messages.
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, sparks INTEGER NOT NULL DEFAULT 0);

    CREATE TABLE concord_link_messages (
      id TEXT PRIMARY KEY, payload TEXT, encryption_level TEXT,
      source_world TEXT, dest_world TEXT, status TEXT NOT NULL DEFAULT 'sent',
      sent_at INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE black_market_listings (
      id                 TEXT PRIMARY KEY,
      message_id         TEXT NOT NULL,
      fence_npc_id       TEXT NOT NULL,
      price_sparks       INTEGER NOT NULL DEFAULT 0,
      encryption_level   TEXT NOT NULL DEFAULT 'basic',
      redacted_preview   TEXT,
      status             TEXT NOT NULL DEFAULT 'active',
      buyer_id           TEXT,
      sold_at            INTEGER,
      sale_price         INTEGER,
      created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at         INTEGER NOT NULL DEFAULT (unixepoch() + 86400 * 7)
    );

    CREATE TABLE black_market_reputation (
      user_id        TEXT NOT NULL,
      fence_npc_id   TEXT NOT NULL,
      buyer_rep      INTEGER NOT NULL DEFAULT 0,
      purchases      INTEGER NOT NULL DEFAULT 0,
      last_trade_at  INTEGER,
      PRIMARY KEY (user_id, fence_npc_id)
    );
  `);
  return db;
}

function seedIntercept(db, id, encryption = "basic", payload = "the real payload") {
  db.prepare(`
    INSERT INTO concord_link_messages (id, payload, encryption_level, source_world, dest_world, status)
    VALUES (?, ?, ?, 'concordia', 'fantasy', 'intercepted')
  `).run(id, payload, encryption);
}

// Total sparks held by every user — the conserved quantity.
function totalSparks(db) {
  return db.prepare(`SELECT COALESCE(SUM(sparks), 0) AS t FROM users`).get().t;
}

describe("black-market lens — money conservation (no mint on purchase)", () => {
  it("a successful buy debits the buyer and credits NO ONE — circulation drops by exactly sparksSpent", () => {
    const db = bootDb();
    seedIntercept(db, "m1", "basic");
    // two users so we can prove the seller / fence is never credited
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('buyer', 1000)`).run();
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('someone_else', 777)`).run();

    const before = totalSparks(db);
    const listing = surfaceInterceptedMessage(db, "m1", { probability: 1.0 }).listing;

    const r = purchaseListing(db, { listingId: listing.id, buyerId: "buyer" });
    assert.equal(r.ok, true);
    assert.ok(r.sparksSpent > 0);

    const buyer = db.prepare(`SELECT sparks FROM users WHERE id='buyer'`).get();
    const other = db.prepare(`SELECT sparks FROM users WHERE id='someone_else'`).get();
    assert.equal(buyer.sparks, 1000 - r.sparksSpent, "buyer debited by exactly sparksSpent");
    assert.equal(other.sparks, 777, "no other account is credited (no minting / misrouted credit)");

    // Sparks leave circulation (sink), they are never minted: after < before.
    assert.equal(totalSparks(db), before - r.sparksSpent);
    assert.ok(totalSparks(db) < before);
    // listing row records the same price it charged (no divergence buyer-debit vs sale_price)
    assert.equal(r.listing.sale_price, r.sparksSpent);
  });

  it("a failed (insufficient) buy moves ZERO sparks and never mints", () => {
    const db = bootDb();
    seedIntercept(db, "m1", "shadow"); // 500 base, buyer can't afford
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('buyer', 10)`).run();
    const before = totalSparks(db);

    const listing = surfaceInterceptedMessage(db, "m1", { probability: 1.0 }).listing;
    const r = purchaseListing(db, { listingId: listing.id, buyerId: "buyer" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "insufficient_sparks");
    // buyer keeps every spark; circulation unchanged
    assert.equal(db.prepare(`SELECT sparks FROM users WHERE id='buyer'`).get().sparks, 10);
    assert.equal(totalSparks(db), before);
  });

  it("double-spend is blocked: a sold listing cannot be purchased again", () => {
    const db = bootDb();
    seedIntercept(db, "m1", "basic");
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('buyer', 1000)`).run();
    const listing = surfaceInterceptedMessage(db, "m1", { probability: 1.0 }).listing;

    const first = purchaseListing(db, { listingId: listing.id, buyerId: "buyer" });
    assert.equal(first.ok, true);
    const afterFirst = db.prepare(`SELECT sparks FROM users WHERE id='buyer'`).get().sparks;

    const second = purchaseListing(db, { listingId: listing.id, buyerId: "buyer" });
    assert.equal(second.ok, false);
    assert.equal(second.reason, "listing_not_active");
    // no further debit on the rejected re-purchase
    assert.equal(db.prepare(`SELECT sparks FROM users WHERE id='buyer'`).get().sparks, afterFirst);
  });
});

describe("black-market lens — effectivePrice reputation math", () => {
  // Drive effectivePrice indirectly through purchaseListing by pre-seeding rep.
  function priceWithRep(db, buyerId, fence, rep) {
    db.prepare(`
      INSERT INTO black_market_reputation (user_id, fence_npc_id, buyer_rep, purchases, last_trade_at)
      VALUES (?, ?, ?, 0, unixepoch())
      ON CONFLICT(user_id, fence_npc_id) DO UPDATE SET buyer_rep = excluded.buyer_rep
    `).run(buyerId, fence, rep);
  }

  it("price scales by factor 1 - (clamp(rep,-50,100)/100)*0.25: rep=100→0.75x, rep=0→1.0x, rep=-50→1.125x", () => {
    // base 'high' tier = 180 sparks. rep is clamped to [-50, 100], so the
    // realised price band is 0.75x (best trust) .. 1.125x (worst standing).
    const mk = (rep) => {
      const db = bootDb();
      seedIntercept(db, "m1", "high");
      db.prepare(`INSERT INTO users (id, sparks) VALUES ('buyer', 100000)`).run();
      const listing = surfaceInterceptedMessage(db, "m1", { probability: 1.0 }).listing;
      assert.equal(listing.price_sparks, 180);
      priceWithRep(db, "buyer", listing.fence_npc_id, rep);
      const r = purchaseListing(db, { listingId: listing.id, buyerId: "buyer" });
      assert.equal(r.ok, true);
      return r.sparksSpent;
    };
    const hi = mk(100);   // 180 * 0.750 = 135
    const mid = mk(0);    // 180 * 1.000 = 180
    const lo = mk(-50);   // 180 * 1.125 = 202.5 → round 203
    assert.equal(mid, 180);
    assert.equal(hi, 135);
    assert.equal(lo, 203);
    // monotonic: more reputation never costs more
    assert.ok(hi < mid && mid < lo);
  });

  it("price is floored at 1 spark and is always a finite positive integer (never 0/NaN/Infinity)", () => {
    const db = bootDb();
    // a degenerate cheap listing (price 1) at max rep would compute 0.75 → round 1
    seedIntercept(db, "m1", "none"); // base 25
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('buyer', 1000)`).run();
    const listing = surfaceInterceptedMessage(db, "m1", { probability: 1.0 }).listing;
    // hand-set the row's price to 1 to probe the floor
    db.prepare(`UPDATE black_market_listings SET price_sparks = 1 WHERE id = ?`).run(listing.id);
    db.prepare(`
      INSERT INTO black_market_reputation (user_id, fence_npc_id, buyer_rep, purchases, last_trade_at)
      VALUES ('buyer', ?, 100, 0, unixepoch())
    `).run(listing.fence_npc_id);

    const r = purchaseListing(db, { listingId: listing.id, buyerId: "buyer" });
    assert.equal(r.ok, true);
    assert.ok(Number.isInteger(r.sparksSpent));
    assert.ok(Number.isFinite(r.sparksSpent));
    assert.ok(r.sparksSpent >= 1, "price never drops below the 1-spark floor");
  });
});

describe("black-market lens — reputation gating round-trip", () => {
  it("a clean buy bumps buyer reputation (+2) and a failed buy dings it (-1)", () => {
    const db = bootDb();
    seedIntercept(db, "m1", "basic");
    seedIntercept(db, "m2", "shadow"); // unaffordable
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('buyer', 100)`).run();

    const l1 = surfaceInterceptedMessage(db, "m1", { probability: 1.0 }).listing;
    const ok = purchaseListing(db, { listingId: l1.id, buyerId: "buyer" });
    assert.equal(ok.ok, true);
    assert.equal(ok.buyerRep, 2);

    const l2 = surfaceInterceptedMessage(db, "m2", { probability: 1.0 }).listing;
    const fail = purchaseListing(db, { listingId: l2.id, buyerId: "buyer" });
    assert.equal(fail.ok, false);

    const rep = getBuyerReputation(db, "buyer");
    assert.equal(rep.length, 1);
    // +2 from the clean buy, -1 from the failed attempt = +1
    assert.equal(rep[0].buyer_rep, 1);
    assert.equal(rep[0].purchases, 1); // only the successful buy increments purchases
  });

  it("browseListings never leaks the server-held payload before purchase", () => {
    const db = bootDb();
    seedIntercept(db, "m1", "high", "TOP SECRET vault coordinates");
    surfaceInterceptedMessage(db, "m1", { probability: 1.0 });
    const rows = browseListings(db);
    assert.equal(rows.length, 1);
    // the row a browsing player sees carries only the redacted preview, no payload column
    assert.ok(!("payload" in rows[0]));
    assert.ok(!String(rows[0].redacted_preview || "").includes("TOP SECRET"));
  });
});
