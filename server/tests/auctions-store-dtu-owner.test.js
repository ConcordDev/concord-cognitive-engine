// Owners can auction DTUs made through dtu.create (STATE.dtus / dtu_store),
// not only legacy `dtus` table rows; strangers still can't, and settlement
// moves ownership of a store DTU to the winner.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createAuction, placeBid, settleAuction, dtuOwnerOf } from "../lib/auctions.js";
import { up as upAuctions } from "../migrations/220_auction_house.js";
import { up as upPriceHistory } from "../migrations/271_auction_price_history.js";

function freshDb() {
  const db = new Database(":memory:");
  upAuctions(db); upPriceHistory(db);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, concordia_credits REAL NOT NULL DEFAULT 0);
    CREATE TABLE reward_ledger (id TEXT PRIMARY KEY, user_id TEXT, kind TEXT, amount_cc REAL, ts INTEGER, ref_id TEXT);
    CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT, owner_user_id TEXT);
    CREATE TABLE dtu_store (id TEXT PRIMARY KEY, title TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), data TEXT NOT NULL DEFAULT '{}');
  `);
  db.prepare(`INSERT INTO users (id, username, concordia_credits) VALUES ('u_a','alice',0),('u_b','bob',100)`).run();
  return db;
}

describe("auctions: DTUs from dtu.create", () => {
  let db; let prev;
  beforeEach(() => { db = freshDb(); prev = globalThis._concordSTATE; globalThis._concordSTATE = { dtus: new Map() }; });
  afterEach(() => { globalThis._concordSTATE = prev; });

  it("owner can list a STATE.dtus DTU stamped with their username", () => {
    globalThis._concordSTATE.dtus.set("dtu_s1", { id: "dtu_s1", ownerId: "alice" });
    const r = createAuction(db, "u_a", { itemKind: "dtu", itemId: "dtu_s1", startCc: 1 });
    assert.equal(r.ok, true, JSON.stringify(r));
  });

  it("stranger cannot list someone else's STATE DTU", () => {
    globalThis._concordSTATE.dtus.set("dtu_s2", { id: "dtu_s2", ownerId: "u_a" });
    const r = createAuction(db, "u_b", { itemKind: "dtu", itemId: "dtu_s2", startCc: 1 });
    assert.equal(r.ok, false); assert.equal(r.error, "not_authorized");
  });

  it("owner can list a dtu_store-only DTU; missing items stay item_not_found", () => {
    db.prepare(`INSERT INTO dtu_store (id, data) VALUES ('dtu_p1', ?)`).run(JSON.stringify({ id: "dtu_p1", author: "u_a" }));
    assert.equal(dtuOwnerOf(db, "dtu_p1"), "u_a");
    assert.equal(createAuction(db, "u_a", { itemKind: "dtu", itemId: "dtu_p1", startCc: 1 }).ok, true);
    assert.equal(createAuction(db, "u_a", { itemKind: "dtu", itemId: "dtu_nope", startCc: 1 }).error, "item_not_found");
  });

  it("legacy dtus rows with only owner_user_id are honored", () => {
    db.prepare(`INSERT INTO dtus (id, owner_user_id) VALUES ('dtu_l1','u_a')`).run();
    assert.equal(createAuction(db, "u_a", { itemKind: "dtu", itemId: "dtu_l1", startCc: 1 }).ok, true);
    assert.equal(createAuction(db, "u_b", { itemKind: "dtu", itemId: "dtu_l1", startCc: 1 }).error, "not_authorized");
  });

  it("settlement moves a STATE DTU to the winner", () => {
    const d = { id: "dtu_s3", ownerId: "u_a", author: "u_a" };
    globalThis._concordSTATE.dtus.set("dtu_s3", d);
    const a = createAuction(db, "u_a", { itemKind: "dtu", itemId: "dtu_s3", startCc: 1, durationS: 600 });
    assert.equal(a.ok, true, JSON.stringify(a));
    const aid = a.auctionId || a.auction?.id;
    const b = placeBid(db, aid, "u_b", 5);
    assert.equal(b.ok, true, JSON.stringify(b));
    const s = settleAuction(db, aid);
    assert.equal(s.ok, true, JSON.stringify(s));
    assert.equal(d.ownerId, "u_b"); assert.equal(d.author, "u_b");
  });
});
