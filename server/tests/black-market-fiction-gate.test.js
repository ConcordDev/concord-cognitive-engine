// FIX-black-market-010 — founder ruling pins: intercepts are fictional
// NPC traffic ONLY. A real user's (or a system) Concord Link message is
// never surfaced as a listing and never revealed to a buyer; generated
// characters' messages ('npc' / 'emergent') surface and sell as before,
// and every surface row + reveal carries the fiction marker.
//
// Hermetic: in-memory better-sqlite3, schema mirrors migration 076
// (sender_kind) + 080 (black market) for the columns the lib touches.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  surfaceInterceptedMessage,
  browseListings,
  purchaseListing,
} from "../lib/black-market.js";

function bootDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, sparks INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE concord_link_messages (
      id TEXT PRIMARY KEY, payload TEXT, encryption_level TEXT, sender_kind TEXT,
      source_world TEXT, dest_world TEXT, status TEXT NOT NULL DEFAULT 'sent',
      sent_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE black_market_listings (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, fence_npc_id TEXT NOT NULL,
      price_sparks INTEGER NOT NULL DEFAULT 0, encryption_level TEXT NOT NULL DEFAULT 'basic',
      redacted_preview TEXT, status TEXT NOT NULL DEFAULT 'active', buyer_id TEXT,
      sold_at INTEGER, sale_price INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 86400 * 7)
    );
    CREATE TABLE black_market_reputation (
      user_id TEXT NOT NULL, fence_npc_id TEXT NOT NULL, buyer_rep INTEGER NOT NULL DEFAULT 0,
      purchases INTEGER NOT NULL DEFAULT 0, last_trade_at INTEGER,
      PRIMARY KEY (user_id, fence_npc_id)
    );
  `);
  return db;
}

function seed(db, id, kind, payload = "a secret worth sparks") {
  db.prepare(`
    INSERT INTO concord_link_messages (id, payload, encryption_level, sender_kind, source_world, dest_world, status)
    VALUES (?, ?, 'basic', ?, 'concordia', 'fantasy', 'intercepted')
  `).run(id, payload, kind);
}

describe("FIX-black-market-010 fictional-traffic gate", () => {
  it("a real user's intercepted message NEVER surfaces as a listing", () => {
    const db = bootDb();
    seed(db, "u1", "user", "my actual private note");
    const r = surfaceInterceptedMessage(db, "u1", { probability: 1.0 });
    assert.equal(r.ok, true);
    assert.equal(r.surfaced, false);
    assert.equal(r.listing, null);
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM black_market_listings`).get().c, 0);
    assert.deepEqual(browseListings(db), []);
  });

  it("a system message never surfaces either", () => {
    const db = bootDb();
    seed(db, "s1", "system");
    const r = surfaceInterceptedMessage(db, "s1", { probability: 1.0 });
    assert.equal(r.surfaced, false);
    assert.equal(db.prepare(`SELECT COUNT(*) AS c FROM black_market_listings`).get().c, 0);
  });

  it("npc and emergent traffic surfaces, and browse rows carry the fiction marker", () => {
    const db = bootDb();
    seed(db, "n1", "npc");
    seed(db, "e1", "emergent");
    assert.equal(surfaceInterceptedMessage(db, "n1", { probability: 1.0 }).surfaced, true);
    assert.equal(surfaceInterceptedMessage(db, "e1", { probability: 1.0 }).surfaced, true);
    const rows = browseListings(db);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.fictional === true));
  });

  it("buying a fictional intercept reveals it WITH the fiction marker", () => {
    const db = bootDb();
    seed(db, "n1", "npc", "the fence knows a shortcut");
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('buyer', 1000)`).run();
    const listing = surfaceInterceptedMessage(db, "n1", { probability: 1.0 }).listing;
    const r = purchaseListing(db, { listingId: listing.id, buyerId: "buyer" });
    assert.equal(r.ok, true);
    assert.equal(r.message.payload, "the fence knows a shortcut");
    assert.equal(r.message.fictional, true);
    assert.match(r.message.senderLabel, /fictional NPC/);
  });

  it("a listing that somehow points at a real user's message refuses the purchase — no debit, listing retired, payload never revealed", () => {
    const db = bootDb();
    seed(db, "u1", "user", "my actual private note");
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('buyer', 1000)`).run();
    // Hand-craft the legacy row the surfacing gate would never create.
    db.prepare(`
      INSERT INTO black_market_listings (id, message_id, fence_npc_id, price_sparks, encryption_level, redacted_preview, status)
      VALUES ('bml_legacy', 'u1', 'broker_sael', 60, 'basic', '[redacted]', 'active')
    `).run();
    const r = purchaseListing(db, { listingId: "bml_legacy", buyerId: "buyer" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_fictional_traffic");
    assert.equal(r.message, undefined);
    assert.equal(db.prepare(`SELECT sparks FROM users WHERE id='buyer'`).get().sparks, 1000);
    assert.equal(db.prepare(`SELECT status FROM black_market_listings WHERE id='bml_legacy'`).get().status, "expired");
  });
});
