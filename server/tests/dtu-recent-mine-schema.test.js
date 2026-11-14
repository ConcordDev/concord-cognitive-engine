// GB-1538 genus — the DTU recent_mine/list_mine factory must work
// against BOTH dtus shapes that exist in the wild:
//   (a) the runtime bootstrap shape (dtu-store): creator_id, content,
//       content_type, tier, created_at, embedding — no type column, no
//       updated_at, no visibility, no owner_user_id. The pristine
//       factory threw "no such column: type" here, surfacing as a 400
//       on load-fired list_mine/recent_mine across the bulk-registered
//       domains (hvac, srs, sim, personas, ...).
//   (b) the migrated shape (migration 001 + 087): owner_user_id plus
//       creator_id, type, visibility, tags_json, updated_at — the type
//       filter applies and items carry the stored type/visibility.
// The factory resolves columns via PRAGMA and adapts; the item shape
// {id, title, type, createdAt, updatedAt, visibility} is preserved.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { buildDtuRecentMineMacro } from "../domains/_dtu-recent-mine.js";

function capture(domain, opts) {
  const handlers = {};
  buildDtuRecentMineMacro((d, name, handler) => { handlers[`${d}.${name}`] = handler; }, domain, opts);
  return handlers;
}

function runtimeDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (
    id TEXT PRIMARY KEY, creator_id TEXT, title TEXT, content TEXT,
    content_type TEXT, tier TEXT, created_at TEXT, embedding TEXT
  )`);
  const ins = db.prepare(`INSERT INTO dtus (id, creator_id, title, content, content_type, tier, created_at, embedding)
                          VALUES (?, ?, ?, '{}', 'text', 'regular', ?, NULL)`);
  ins.run("d1", "user-a", "First", "2026-11-01T10:00:00Z");
  ins.run("d2", "user-a", "Second", "2026-11-03T10:00:00Z");
  ins.run("d3", "user-b", "Someone elses", "2026-11-04T10:00:00Z");
  return db;
}

function migratedDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (
    id TEXT PRIMARY KEY, owner_user_id TEXT, creator_id TEXT, title TEXT NOT NULL DEFAULT 'Untitled',
    body_json TEXT NOT NULL DEFAULT '{}', tags_json TEXT NOT NULL DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'private', tier TEXT NOT NULL DEFAULT 'regular',
    type TEXT NOT NULL DEFAULT 'knowledge', data TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const ins = db.prepare(`INSERT INTO dtus (id, owner_user_id, creator_id, title, type, visibility, created_at, updated_at)
                          VALUES (?, ?, ?, ?, ?, 'private', ?, ?)`);
  ins.run("m1", "user-a", "user-a", "Card one", "srs_card", "2026-11-01T10:00:00Z", "2026-11-02T10:00:00Z");
  ins.run("m2", "user-a", "user-a", "Note one", "note", "2026-11-03T10:00:00Z", "2026-11-05T10:00:00Z");
  ins.run("m3", "user-b", "user-b", "Foreign card", "srs_card", "2026-11-04T10:00:00Z", "2026-11-04T10:00:00Z");
  return db;
}

const ctxFor = (db, userId) => ({ db, actor: { userId } });

test("runtime shape: list_mine answers instead of throwing no-such-column", async () => {
  const db = runtimeDb();
  const h = capture("hvac", { type: ["hvac_load"] });
  const r = await h["hvac.list_mine"](ctxFor(db, "user-a"), {});
  assert.equal(r.ok, true);
  assert.equal(r.total, 2);
  assert.deepEqual(r.items.map(i => i.id), ["d2", "d1"]); // newest first
  assert.equal(r.items[0].type, "text"); // content_type presented as type
  assert.equal(r.items[0].updatedAt, "2026-11-03T10:00:00Z"); // created_at fallback
  assert.equal(r.items[0].visibility, null); // column absent -> null, not a throw
});

test("runtime shape: recent_mine is the same handler and honours limit", async () => {
  const db = runtimeDb();
  const h = capture("srs", { type: ["srs_card", "srs"] });
  const r = await h["srs.recent_mine"](ctxFor(db, "user-a"), { limit: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.items.length, 1);
  assert.equal(r.total, 2); // total ignores the limit
});

test("runtime shape: another user's rows never leak", async () => {
  const db = runtimeDb();
  const h = capture("personas", {});
  const r = await h["personas.list_mine"](ctxFor(db, "user-b"), {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(i => i.id), ["d3"]);
});

test("migrated shape: the type filter applies on the type column", async () => {
  const db = migratedDb();
  const h = capture("srs", { type: ["srs_card", "srs"] });
  const r = await h["srs.list_mine"](ctxFor(db, "user-a"), {});
  assert.equal(r.ok, true);
  assert.equal(r.total, 1);
  assert.equal(r.items[0].id, "m1");
  assert.equal(r.items[0].type, "srs_card");
  assert.equal(r.items[0].visibility, "private");
  assert.equal(r.items[0].updatedAt, "2026-11-02T10:00:00Z"); // real updated_at wins
});

test("migrated shape: unfiltered lists everything the caller owns, newest update first", async () => {
  const db = migratedDb();
  const h = capture("feed", {});
  const r = await h["feed.recent_mine"](ctxFor(db, "user-a"), {});
  assert.equal(r.ok, true);
  assert.deepEqual(r.items.map(i => i.id), ["m2", "m1"]);
});

test("guards stand: no db and no user refuse in the honest shapes", async () => {
  const h = capture("sim", {});
  assert.deepEqual(await h["sim.list_mine"]({ actor: { userId: "u" } }, {}), { ok: false, reason: "no_db" });
  const db = runtimeDb();
  assert.deepEqual(await h["sim.list_mine"]({ db }, {}), { ok: false, reason: "no_user" });
});
