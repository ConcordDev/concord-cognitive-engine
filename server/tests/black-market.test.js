/**
 * Black Market tests — surfacing, browsing, purchase flow, reputation.
 * Run: node --test tests/black-market.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import {
  surfaceInterceptedMessage,
  browseListings,
  purchaseListing,
  expireListings,
  getBuyerReputation,
} from "../lib/black-market.js";

function setupDB() {
  const db = new Database(":memory:");
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

function seedIntercepted(db, id = "msg1", encryption = "high", payload = "Vault Seventeen manifest: …") {
  db.prepare(`
    INSERT INTO concord_link_messages (id, payload, encryption_level, source_world, dest_world, status)
    VALUES (?, ?, ?, 'concordia', 'fantasy', 'intercepted')
  `).run(id, payload, encryption);
}

describe("Black market: surface", () => {
  it("creates a listing with a redacted preview", () => {
    const db = setupDB();
    seedIntercepted(db, "msg1", "high", "secret payload that should not appear in preview");
    const r = surfaceInterceptedMessage(db, "msg1", { probability: 1.0 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.surfaced, true);
    assert.ok(r.listing);
    assert.strictEqual(r.listing.encryption_level, "high");
    assert.strictEqual(r.listing.fence_npc_id, "broker_sael");
    assert.ok(r.listing.price_sparks > 0);
    assert.ok(!r.listing.redacted_preview.includes("secret payload"));
  });

  it("is idempotent on repeat surfacing of the same message", () => {
    const db = setupDB();
    seedIntercepted(db);
    const a = surfaceInterceptedMessage(db, "msg1", { probability: 1.0 });
    const b = surfaceInterceptedMessage(db, "msg1", { probability: 1.0 });
    assert.strictEqual(a.surfaced, true);
    assert.strictEqual(b.surfaced, false);
    const listings = browseListings(db);
    assert.strictEqual(listings.length, 1);
  });

  it("respects probability=0 (intercept lost forever)", () => {
    const db = setupDB();
    seedIntercepted(db);
    const r = surfaceInterceptedMessage(db, "msg1", { probability: 0 });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.surfaced, false);
  });

  it("rejects messages that aren't actually intercepted", () => {
    const db = setupDB();
    db.prepare(`INSERT INTO concord_link_messages (id, payload, encryption_level, status) VALUES ('m', 'x', 'basic', 'delivered')`).run();
    const r = surfaceInterceptedMessage(db, "m", { probability: 1.0 });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "message_not_found_or_not_intercepted");
  });
});

describe("Black market: purchase", () => {
  it("debits sparks, reveals message, bumps rep", () => {
    const db = setupDB();
    seedIntercepted(db, "msg1", "basic", "the actual payload");
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('u1', 1000)`).run();

    const surfaced = surfaceInterceptedMessage(db, "msg1", { probability: 1.0 });
    const listing  = surfaced.listing;

    const r = purchaseListing(db, { listingId: listing.id, buyerId: "u1" });
    assert.strictEqual(r.ok, true);
    assert.ok(r.sparksSpent > 0);
    assert.strictEqual(r.message.payload, "the actual payload");
    assert.strictEqual(r.listing.status, "sold");
    assert.strictEqual(r.buyerRep, 2);

    const u = db.prepare(`SELECT sparks FROM users WHERE id='u1'`).get();
    assert.strictEqual(u.sparks, 1000 - r.sparksSpent);
  });

  it("rejects insufficient-sparks purchases and dings reputation", () => {
    const db = setupDB();
    seedIntercepted(db, "msg1", "shadow"); // expensive tier
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('u1', 5)`).run();

    const surfaced = surfaceInterceptedMessage(db, "msg1", { probability: 1.0 });
    const r = purchaseListing(db, { listingId: surfaced.listing.id, buyerId: "u1" });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, "insufficient_sparks");

    const rep = getBuyerReputation(db, "u1");
    assert.strictEqual(rep.length, 1);
    assert.strictEqual(rep[0].buyer_rep, -1);
  });

  it("expires listings whose ttl has lapsed", () => {
    const db = setupDB();
    seedIntercepted(db);
    surfaceInterceptedMessage(db, "msg1", { probability: 1.0 });
    db.prepare(`UPDATE black_market_listings SET expires_at = unixepoch() - 10`).run();
    const r = expireListings(db);
    assert.strictEqual(r.expired, 1);
    const stillActive = browseListings(db);
    assert.strictEqual(stillActive.length, 0);
  });
});
