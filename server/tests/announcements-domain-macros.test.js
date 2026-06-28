// Contract + behavioral tests for server/domains/announcements.js.
//
// The domain macros (announcements.list / .get / .post) delegate to the
// real lib/announcements.js against a real in-memory better-sqlite3 DB.
// These tests assert ACTUAL VALUES (a posted announcement comes back out
// of list, admin-gate rejects non-admins, broadcast-dequeue marks
// last_broadcast_at), not just {ok:true}.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerAnnouncementMacros from "../domains/announcements.js";
import { dequeueBroadcastBatch } from "../lib/announcements.js";
import { up as upAnnouncements } from "../migrations/237_announcements.js";

// Minimal register harness mirroring runMacro's (domain,name,fn) registry.
const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`announcements.${name}`);
  if (!fn) throw new Error(`announcements.${name} not registered`);
  return fn(ctx, input);
}

registerAnnouncementMacros(register);

function freshDb() { const db = new Database(":memory:"); upAnnouncements(db); return db; }

const adminCtx = (db) => ({ db, actor: { userId: "op_1", role: "admin" } });
const memberCtx = (db) => ({ db, actor: { userId: "u_2", role: "member" } });

describe("announcements domain — registration", () => {
  it("registers list, get, and post", () => {
    assert.ok(ACTIONS.has("announcements.list"));
    assert.ok(ACTIONS.has("announcements.get"));
    assert.ok(ACTIONS.has("announcements.post"));
  });
});

describe("announcements.post (admin-gated)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("admin can publish and the row is real", async () => {
    const r = await call("post", adminCtx(db), {
      kind: "feature_drop", title: "Batch 4 lives", body: "ship it.",
    });
    assert.equal(r.ok, true);
    assert.ok(typeof r.id === "string" && r.id.startsWith("ann_"));
    const row = db.prepare("SELECT * FROM announcements WHERE id = ?").get(r.id);
    assert.equal(row.title, "Batch 4 lives");
    assert.equal(row.kind, "feature_drop");
    assert.equal(row.author_user_id, "op_1");
  });

  it("non-admin is rejected with admin_only and writes nothing", async () => {
    const r = await call("post", memberCtx(db), {
      kind: "news", title: "sneaky", body: "x",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "admin_only");
    const count = db.prepare("SELECT COUNT(*) c FROM announcements").get().c;
    assert.equal(count, 0);
  });

  it("anonymous (viewer) caller is rejected", async () => {
    const r = await call("post", { db, actor: { userId: "anon", role: "viewer" } }, {
      kind: "news", title: "x", body: "y",
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "admin_only");
  });

  it("admin publish still validates: invalid kind rejected", async () => {
    const r = await call("post", adminCtx(db), { kind: "spam", title: "x", body: "y" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_kind");
  });

  it("admin publish rejects missing title/body", async () => {
    assert.equal((await call("post", adminCtx(db), { kind: "news", body: "y" })).ok, false);
    assert.equal((await call("post", adminCtx(db), { kind: "news", title: "x" })).ok, false);
  });
});

describe("announcements.list (public read)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("post → list returns the exact announcement", async () => {
    await call("post", adminCtx(db), { kind: "roadmap", title: "Belonging", body: "soon" });
    const r = await call("list", memberCtx(db), {});
    assert.equal(r.ok, true);
    assert.equal(r.announcements.length, 1);
    assert.equal(r.announcements[0].title, "Belonging");
    assert.equal(r.announcements[0].kind, "roadmap");
  });

  it("filters by kind", async () => {
    await call("post", adminCtx(db), { kind: "feature_drop", title: "F", body: "x" });
    await call("post", adminCtx(db), { kind: "roadmap", title: "R", body: "x" });
    const r = await call("list", memberCtx(db), { kind: "roadmap" });
    assert.equal(r.ok, true);
    assert.equal(r.announcements.length, 1);
    assert.equal(r.announcements[0].kind, "roadmap");
  });

  it("ignores an unknown kind filter (returns all)", async () => {
    await call("post", adminCtx(db), { kind: "feature_drop", title: "F", body: "x" });
    const r = await call("list", memberCtx(db), { kind: "not_a_kind" });
    assert.equal(r.ok, true);
    assert.equal(r.announcements.length, 1);
  });

  it("excludes expired announcements", async () => {
    await call("post", adminCtx(db), { kind: "event", title: "Live", body: "x" });
    await call("post", adminCtx(db), { kind: "event", title: "Old", body: "x", expiresAt: 1 });
    const r = await call("list", memberCtx(db), {});
    assert.equal(r.announcements.length, 1);
    assert.equal(r.announcements[0].title, "Live");
  });

  it("returns empty list on a fresh db (honest empty)", async () => {
    const r = await call("list", memberCtx(db), {});
    assert.equal(r.ok, true);
    assert.deepEqual(r.announcements, []);
  });
});

describe("announcements.get (public read)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("returns the announcement by id", async () => {
    const p = await call("post", adminCtx(db), { kind: "news", title: "Hello", body: "x" });
    const r = await call("get", memberCtx(db), { id: p.id });
    assert.equal(r.ok, true);
    assert.equal(r.announcement.id, p.id);
    assert.equal(r.announcement.title, "Hello");
  });

  it("rejects missing id", async () => {
    const r = await call("get", memberCtx(db), {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_id");
  });

  it("unknown id returns unknown_announcement", async () => {
    const r = await call("get", memberCtx(db), { id: "ann_nope" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_announcement");
  });
});

describe("announcements broadcast dequeue marks last_broadcast_at", () => {
  it("a posted announcement is dequeued once then is idempotent", async () => {
    const db = freshDb();
    const p = await call("post", adminCtx(db), { kind: "roadmap", title: "B", body: "soon" });
    const before = db.prepare("SELECT last_broadcast_at FROM announcements WHERE id = ?").get(p.id);
    assert.equal(before.last_broadcast_at, null);

    const batch = dequeueBroadcastBatch(db);
    assert.equal(batch.length, 1);
    assert.equal(batch[0].id, p.id);

    const after = db.prepare("SELECT last_broadcast_at FROM announcements WHERE id = ?").get(p.id);
    assert.notEqual(after.last_broadcast_at, null);

    // Re-pull is empty — idempotent.
    assert.equal(dequeueBroadcastBatch(db).length, 0);
  });
});

describe("announcements macros degrade without a db", () => {
  it("list/get/post return no_db when ctx.db is missing", async () => {
    assert.equal((await call("list", { actor: { role: "admin" } }, {})).reason, "no_db");
    assert.equal((await call("get", { actor: { role: "admin" } }, { id: "x" })).reason, "no_db");
    assert.equal((await call("post", { actor: { role: "admin" } }, { kind: "news", title: "x", body: "y" })).reason, "no_db");
  });
});
