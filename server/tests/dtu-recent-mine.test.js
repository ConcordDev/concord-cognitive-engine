/**
 * Tier-2 contract test for the DTU-backed recent_mine factory.
 *
 * Run: node --test server/tests/dtu-recent-mine.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { buildDtuRecentMineMacro } from "../domains/_dtu-recent-mine.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler) => { map.set(`${domain}.${name}`, handler); };
  return { register, call: (key, ctx, input) => map.get(key)(ctx, input), keys: () => [...map.keys()] };
}

function setupDb() {
  const db = new Database(":memory:");
  // Minimal dtus table matching the real schema post-migration 087.
  db.exec(`
    CREATE TABLE dtus (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT,
      creator_id      TEXT,
      title           TEXT NOT NULL DEFAULT 'Untitled',
      body_json       TEXT NOT NULL DEFAULT '{}',
      tags_json       TEXT NOT NULL DEFAULT '[]',
      visibility      TEXT NOT NULL DEFAULT 'private',
      tier            TEXT NOT NULL DEFAULT 'regular',
      type            TEXT NOT NULL DEFAULT 'knowledge',
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
    CREATE INDEX idx_dtus_creator ON dtus(creator_id);
    CREATE INDEX idx_dtus_type    ON dtus(type);
  `);
  return db;
}

function seed(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO dtus (id, owner_user_id, creator_id, title, body_json, tags_json, visibility, tier, type, created_at, updated_at)
    VALUES (@id, @creator, @creator, @title, '{}', @tags, 'private', 'regular', @type, @ts, @ts)
  `);
  for (const r of rows) {
    stmt.run({
      id: r.id, creator: r.creator, title: r.title, type: r.type || "knowledge",
      tags: JSON.stringify(r.tags || []), ts: r.ts,
    });
  }
}

describe("buildDtuRecentMineMacro — unfiltered", () => {
  let db, r;
  beforeEach(() => {
    db = setupDb();
    r = makeRegistry();
    buildDtuRecentMineMacro(r.register, "art");
  });

  it("registers recent_mine and list_mine", () => {
    assert.deepEqual(r.keys().sort(), ["art.list_mine", "art.recent_mine"]);
  });

  it("returns own DTUs ordered DESC by updated_at", async () => {
    seed(db, [
      { id: "a", creator: "u1", title: "Alpha", ts: 200 },
      { id: "b", creator: "u1", title: "Beta",  ts: 300 },
      { id: "x", creator: "u2", title: "Other", ts: 999 },
    ]);
    const res = await r.call("art.recent_mine", { db, actor: { userId: "u1" } }, {});
    assert.equal(res.ok, true);
    assert.deepEqual(res.items.map(i => i.id), ["b", "a"]);
    assert.equal(res.total, 2);
  });

  it("rejects anonymous callers", async () => {
    const res = await r.call("art.recent_mine", { db }, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "no_user");
  });
});

describe("buildDtuRecentMineMacro — type filter", () => {
  it("filters by single type", async () => {
    const db = setupDb();
    const r = makeRegistry();
    buildDtuRecentMineMacro(r.register, "art", { type: "art_piece" });
    seed(db, [
      { id: "a", creator: "u1", title: "Sketch", type: "art_piece",  ts: 100 },
      { id: "b", creator: "u1", title: "Note",   type: "knowledge", ts: 200 },
    ]);
    const res = await r.call("art.recent_mine", { db, actor: { userId: "u1" } }, {});
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].id, "a");
    assert.equal(res.items[0].type, "art_piece");
  });

  it("filters by array of types", async () => {
    const db = setupDb();
    const r = makeRegistry();
    buildDtuRecentMineMacro(r.register, "creative", { type: ["art_piece", "creative_recipe"] });
    seed(db, [
      { id: "a", creator: "u1", title: "1", type: "art_piece",      ts: 100 },
      { id: "b", creator: "u1", title: "2", type: "creative_recipe", ts: 200 },
      { id: "c", creator: "u1", title: "3", type: "other",          ts: 300 },
    ]);
    const res = await r.call("creative.recent_mine", { db, actor: { userId: "u1" } }, {});
    assert.equal(res.items.length, 2);
  });
});

describe("buildDtuRecentMineMacro — tags filter", () => {
  it("filters by tag substring", async () => {
    const db = setupDb();
    const r = makeRegistry();
    buildDtuRecentMineMacro(r.register, "music", { tags: ["mix"] });
    seed(db, [
      { id: "a", creator: "u1", title: "Mix1", tags: ["mix", "house"],  ts: 100 },
      { id: "b", creator: "u1", title: "Demo", tags: ["demo"],          ts: 200 },
    ]);
    const res = await r.call("music.recent_mine", { db, actor: { userId: "u1" } }, {});
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].id, "a");
  });
});

describe("buildDtuRecentMineMacro — fallback to owner_user_id", () => {
  it("falls back when creator_id column is missing", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE dtus (
        id TEXT PRIMARY KEY, owner_user_id TEXT, title TEXT,
        type TEXT, tags_json TEXT, visibility TEXT,
        created_at INTEGER, updated_at INTEGER
      );
      INSERT INTO dtus VALUES ('a', 'u1', 'Alpha', 'art_piece', '[]', 'private', 100, 200);
    `);
    const r = makeRegistry();
    buildDtuRecentMineMacro(r.register, "art", { type: "art_piece" });
    const res = await r.call("art.recent_mine", { db, actor: { userId: "u1" } }, {});
    assert.equal(res.ok, true);
    assert.equal(res.items.length, 1);
  });
});
