/**
 * Tier-2 contract test for the Phase 2 recent_mine macro factory.
 *
 * Pins the standard shape every codemod-generated recent_mine macro
 * must return:
 *   { ok: true, items: [{ id, title, createdAt, updatedAt, ...extra }], total: number }
 *
 * Run: node --test server/tests/recent-mine-helper.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { buildRecentMineMacro, buildListMineMacro, MAX_LIMIT } from "../domains/_recent-mine-helper.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler) => { map.set(`${domain}.${name}`, handler); };
  return { register, call: (key, ctx, input) => map.get(key)(ctx, input), keys: () => [...map.keys()] };
}

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE foo_artifacts (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      title       TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'active'
    );
  `);
  return db;
}

function seed(db, rows) {
  const stmt = db.prepare(`INSERT INTO foo_artifacts (id, user_id, title, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const r of rows) stmt.run(r.id, r.user_id, r.title, r.created_at, r.updated_at, r.status || "active");
}

describe("buildRecentMineMacro", () => {
  let db, r;
  beforeEach(() => {
    db = setupDb();
    r = makeRegistry();
    buildRecentMineMacro(r.register, "foo", { table: "foo_artifacts" });
  });

  it("registers foo.recent_mine", () => {
    assert.deepEqual(r.keys(), ["foo.recent_mine"]);
  });

  it("requires db", async () => {
    const res = await r.call("foo.recent_mine", { actor: { userId: "u1" } }, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "no_db");
  });

  it("requires authenticated caller", async () => {
    const res = await r.call("foo.recent_mine", { db }, {});
    assert.equal(res.ok, false);
    assert.equal(res.reason, "no_user");
  });

  it("returns standard shape with empty list for fresh user", async () => {
    const res = await r.call("foo.recent_mine", { db, actor: { userId: "u1" } }, {});
    assert.equal(res.ok, true);
    assert.deepEqual(res.items, []);
    assert.equal(res.total, 0);
  });

  it("returns own items only, ordered by updated_at DESC", async () => {
    seed(db, [
      { id: "a", user_id: "u1", title: "Alpha",  created_at: 100, updated_at: 200 },
      { id: "b", user_id: "u1", title: "Beta",   created_at: 100, updated_at: 300 },
      { id: "c", user_id: "u1", title: "Cappa",  created_at: 100, updated_at: 100 },
      { id: "x", user_id: "u2", title: "Other",  created_at: 100, updated_at: 999 },
    ]);
    const res = await r.call("foo.recent_mine", { db, actor: { userId: "u1" } }, {});
    assert.equal(res.items.length, 3);
    assert.deepEqual(res.items.map(i => i.id), ["b", "a", "c"]);
    assert.equal(res.total, 3);
  });

  it("includes id, title, createdAt, updatedAt fields", async () => {
    seed(db, [{ id: "a", user_id: "u1", title: "Alpha", created_at: 100, updated_at: 200 }]);
    const res = await r.call("foo.recent_mine", { db, actor: { userId: "u1" } }, {});
    const item = res.items[0];
    assert.equal(item.id, "a");
    assert.equal(item.title, "Alpha");
    assert.equal(item.createdAt, 100);
    assert.equal(item.updatedAt, 200);
  });

  it("clamps limit at MAX_LIMIT", async () => {
    for (let i = 0; i < MAX_LIMIT + 50; i++) {
      seed(db, [{ id: `r${i}`, user_id: "u1", title: `${i}`, created_at: i, updated_at: i }]);
    }
    const res = await r.call("foo.recent_mine", { db, actor: { userId: "u1" } }, { limit: 9999 });
    assert.equal(res.items.length, MAX_LIMIT);
  });

  it("defaults limit to 20", async () => {
    for (let i = 0; i < 30; i++) {
      seed(db, [{ id: `r${i}`, user_id: "u1", title: `${i}`, created_at: i, updated_at: i }]);
    }
    const res = await r.call("foo.recent_mine", { db, actor: { userId: "u1" } }, {});
    assert.equal(res.items.length, 20);
  });
});

describe("buildRecentMineMacro — extraColumns + where", () => {
  it("spreads extra columns into the row shape", async () => {
    const db = setupDb();
    const r = makeRegistry();
    buildRecentMineMacro(r.register, "foo", {
      table: "foo_artifacts",
      extraColumns: ["status"],
    });
    seed(db, [{ id: "a", user_id: "u1", title: "Alpha", created_at: 1, updated_at: 1, status: "draft" }]);
    const res = await r.call("foo.recent_mine", { db, actor: { userId: "u1" } }, {});
    assert.equal(res.items[0].status, "draft");
  });

  it("honours a where filter", async () => {
    const db = setupDb();
    const r = makeRegistry();
    buildRecentMineMacro(r.register, "foo", {
      table: "foo_artifacts",
      where: "status = 'active'",
    });
    seed(db, [
      { id: "a", user_id: "u1", title: "A", created_at: 1, updated_at: 1, status: "active" },
      { id: "b", user_id: "u1", title: "B", created_at: 1, updated_at: 1, status: "archived" },
    ]);
    const res = await r.call("foo.recent_mine", { db, actor: { userId: "u1" } }, {});
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].id, "a");
    assert.equal(res.total, 1);
  });
});

describe("buildListMineMacro", () => {
  it("registers both recent_mine + list_mine", () => {
    const r = makeRegistry();
    buildListMineMacro(r.register, "foo", { table: "foo_artifacts" });
    assert.deepEqual(r.keys().sort(), ["foo.list_mine", "foo.recent_mine"]);
  });
});
