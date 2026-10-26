// INC-73 — a purchase reveals the payload but never an account id, and the
// route takes identity only from the authenticated session.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import express from "express";
import http from "node:http";
import { surfaceInterceptedMessage, purchaseListing } from "../lib/black-market.js";
import createBlackMarketRouter from "../routes/black-market.js";

const A = "user_aaaaaaaa-1111";
const B = "user_bbbbbbbb-2222";

function setupDB() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, sparks INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE concord_link_messages (
      id TEXT PRIMARY KEY, sender_id TEXT, sender_kind TEXT, receiver_id TEXT, receiver_kind TEXT,
      payload TEXT, message_type TEXT DEFAULT 'text', encryption_level TEXT,
      source_world TEXT, dest_world TEXT, status TEXT NOT NULL DEFAULT 'sent',
      sent_at INTEGER NOT NULL DEFAULT (unixepoch()));
    CREATE TABLE black_market_listings (
      id TEXT PRIMARY KEY, message_id TEXT NOT NULL, fence_npc_id TEXT NOT NULL,
      price_sparks INTEGER NOT NULL DEFAULT 0, encryption_level TEXT NOT NULL DEFAULT 'basic',
      redacted_preview TEXT, status TEXT NOT NULL DEFAULT 'active', buyer_id TEXT,
      sold_at INTEGER, sale_price INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 86400 * 7));
    CREATE TABLE black_market_reputation (
      user_id TEXT NOT NULL, fence_npc_id TEXT NOT NULL, buyer_rep INTEGER NOT NULL DEFAULT 0,
      purchases INTEGER NOT NULL DEFAULT 0, last_trade_at INTEGER, PRIMARY KEY (user_id, fence_npc_id));
  `);
  db.prepare(`INSERT INTO concord_link_messages (id, sender_id, sender_kind, receiver_id, receiver_kind, payload, encryption_level, source_world, dest_world, status)
              VALUES ('m1', ?, 'user', 'npc_x', 'npc', 'meet at the old mill', 'basic', 'concordia', 'fantasy', 'intercepted')`).run(A);
  db.prepare(`INSERT INTO users (id, sparks) VALUES (?, 10000), (?, 10000)`).run(A, B);
  const s = surfaceInterceptedMessage(db, "m1", { probability: 1.0 });
  return { db, listingId: s.listing.id };
}

describe("INC-73 black market purchase redaction", () => {
  it("B's purchase reveals the payload but neither A's nor B's id", () => {
    const { db, listingId } = setupDB();
    const r = purchaseListing(db, { listingId, buyerId: B });
    assert.equal(r.ok, true);
    assert.equal(r.message.payload, "meet at the old mill");
    assert.match(r.message.senderLabel, /traveller from concordia/);
    const json = JSON.stringify(r);
    assert.equal(json.includes(A), false);
    assert.equal(json.includes(B), false);
    assert.equal("buyer_id" in r.listing, false);
    assert.equal("sender_id" in r.message, false);
    assert.equal("receiver_id" in r.message, false);
    assert.equal(r.listing.status, "sold");
    const again = purchaseListing(db, { listingId, buyerId: B });
    assert.equal(again.ok, false);
    assert.equal(again.reason, "listing_not_active");
  });

  it("route ignores an x-user-id header (no session → 401)", async () => {
    const { db, listingId } = setupDB();
    const app = express();
    app.use(express.json());
    // Pass-through auth like an optional-auth deployment: the route itself must refuse.
    app.use("/api/black-market", createBlackMarketRouter({ requireAuth: (_req, _res, next) => next(), db }));
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    try {
      const { port } = server.address();
      const res = await fetch(`http://127.0.0.1:${port}/api/black-market/${listingId}/purchase`, {
        method: "POST", headers: { "x-user-id": B, "content-type": "application/json" }, body: "{}",
      });
      assert.equal(res.status, 401);
      const row = db.prepare("SELECT status FROM black_market_listings WHERE id=?").get(listingId);
      assert.equal(row.status, "active");
    } finally {
      server.close();
    }
  });
});
