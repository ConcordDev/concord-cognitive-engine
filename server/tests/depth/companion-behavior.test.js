// tests/depth/companion-behavior.test.js — REAL behavioral tests for the
// "companion" lens-action domain (MobileCompanion panel backend).
//
// LOCAL SHIM: the companion domain is a standalone registerLensAction module,
// so we register its handlers into a local Map and invoke them directly —
// no server boot needed. Each handler is (ctx, artifact, params); the shim
// passes a per-user ctx. Substantive assertions reference .result.<field>,
// use .find/.includes/deepEqual, and exercise validation rejections.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import register from "../../domains/companion.js";

const H = new Map();
register((d, a, fn) => H.set(a, fn));
const run = (a, data = {}, params = {}, ctx = { actor: { userId: "u1" } }) =>
  H.get(a)(ctx, { data }, params);

// Distinct user ctx per test so STATE doesn't bleed between cases.
let _u = 0;
const freshCtx = () => ({ actor: { userId: `cu_${++_u}_${Date.now().toString(36)}` } });

describe("companion — notification inbox round-trip + unread accounting", () => {
  it("notification-add → notifications-list reads it back unread", () => {
    const ctx = freshCtx();
    const add = run("notification-add", {}, { title: "Build done", category: "build", body: "Tower validated" }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.notification.title, "Build done");
    assert.equal(add.result.notification.category, "build");
    assert.equal(add.result.notification.read, false);
    assert.equal(add.result.unreadCount, 1);

    const list = run("notifications-list", {}, {}, ctx);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.unreadCount, 1);
    const found = list.result.notifications.find((n) => n.id === add.result.notification.id);
    assert.ok(found);
    assert.equal(found.read, false);
  });

  it("notification-mark-read on one id decrements the unread count", () => {
    const ctx = freshCtx();
    const a1 = run("notification-add", {}, { title: "Cite A", category: "citation" }, ctx);
    run("notification-add", {}, { title: "Cite B", category: "citation" }, ctx);
    const beforeList = run("notifications-list", {}, {}, ctx);
    assert.equal(beforeList.result.unreadCount, 2);

    const mark = run("notification-mark-read", {}, { id: a1.result.notification.id }, ctx);
    assert.equal(mark.result.read, true);
    assert.equal(mark.result.unreadCount, 1);

    const after = run("notifications-list", {}, {}, ctx);
    assert.equal(after.result.unreadCount, 1);
    const marked = after.result.notifications.find((n) => n.id === a1.result.notification.id);
    assert.equal(marked.read, true);
  });

  it("notification-mark-read all: true clears every unread", () => {
    const ctx = freshCtx();
    run("notification-add", {}, { title: "One" }, ctx);
    run("notification-add", {}, { title: "Two" }, ctx);
    const mark = run("notification-mark-read", {}, { all: true }, ctx);
    assert.equal(mark.result.markedAll, true);
    assert.equal(mark.result.unreadCount, 0);
    const list = run("notifications-list", {}, {}, ctx);
    assert.equal(list.result.unreadCount, 0);
  });

  it("notification-add with no title is rejected; mark-read of a missing id is rejected", () => {
    const ctx = freshCtx();
    const bad = run("notification-add", {}, { title: "   " }, ctx);
    assert.equal(bad.ok, false);
    assert.ok(bad.error.includes("title required"));

    const miss = run("notification-mark-read", {}, { id: "ntf_nope" }, ctx);
    assert.equal(miss.ok, false);
    assert.ok(miss.error.includes("notification not found"));
  });

  it("notification-add coerces an unknown category to general", () => {
    const ctx = freshCtx();
    const add = run("notification-add", {}, { title: "Weird", category: "BOGUS" }, ctx);
    assert.equal(add.result.notification.category, "general");
  });
});

describe("companion — push-prefs round-trip + validation", () => {
  it("push-prefs-get returns honest defaults; push-prefs-set patches a single toggle", () => {
    const ctx = freshCtx();
    const get = run("push-prefs-get", {}, {}, ctx);
    assert.equal(get.result.prefs.buildComplete, true);
    assert.equal(get.result.prefs.friendOnline, false);
    assert.ok(get.result.keys.includes("marketUpdate"));

    const set = run("push-prefs-set", {}, { prefs: { friendOnline: true } }, ctx);
    assert.equal(set.result.prefs.friendOnline, true);
    // Untouched keys preserved.
    assert.equal(set.result.prefs.buildComplete, true);

    const get2 = run("push-prefs-get", {}, {}, ctx);
    assert.equal(get2.result.prefs.friendOnline, true);
  });

  it("push-prefs-set accepts a flat patch (no prefs wrapper)", () => {
    const ctx = freshCtx();
    const set = run("push-prefs-set", {}, { marketUpdate: true }, ctx);
    assert.equal(set.result.prefs.marketUpdate, true);
  });

  it("push-prefs-set rejects a non-boolean value and rejects an empty/unknown patch", () => {
    const ctx = freshCtx();
    const badVal = run("push-prefs-set", {}, { prefs: { disasterAlert: "yes" } }, ctx);
    assert.equal(badVal.ok, false);
    assert.ok(badVal.error.includes("must be a boolean"));

    const noKeys = run("push-prefs-set", {}, { prefs: { somethingElse: true } }, ctx);
    assert.equal(noKeys.ok, false);
    assert.ok(noKeys.error.includes("no known preference keys"));
  });
});

describe("companion — feed aggregates real sources, empty by default", () => {
  it("feed is empty for a user with no DB and no notifications", () => {
    const ctx = freshCtx(); // no ctx.db, no notifications
    const r = run("feed", {}, {}, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 0);
    assert.deepEqual(r.result.feed, []);
  });

  it("feed surfaces a notification the user really has (newest-first)", () => {
    const ctx = freshCtx();
    run("notification-add", {}, { title: "First entry", category: "build" }, ctx);
    const r = run("feed", {}, {}, ctx);
    assert.equal(r.result.count, 1);
    const entry = r.result.feed.find((f) => f.source === "notification");
    assert.ok(entry);
    assert.equal(entry.title, "First entry");
    assert.equal(entry.kind, "build");
  });

  it("feed merges authored DTUs from a real ctx.db, newest-first", () => {
    // Minimal in-memory dtus table standing in for the real schema.
    const db = makeFakeDtuDb([
      { id: "d_old", creator_id: "u_feed", title: "Old DTU", kind: "blueprint", created_at: "2026-06-01T00:00:00.000Z" },
      { id: "d_new", creator_id: "u_feed", title: "New DTU", kind: "spell_recipe", created_at: "2026-06-07T00:00:00.000Z" },
      { id: "d_other", creator_id: "someone_else", title: "Not mine", kind: "blueprint", created_at: "2026-06-08T00:00:00.000Z" },
    ]);
    const ctx = { actor: { userId: "u_feed" }, db };
    const r = run("feed", {}, {}, ctx);
    assert.equal(r.result.count, 2); // someone_else's DTU excluded
    const ids = r.result.feed.map((f) => f.id);
    assert.deepEqual(ids, ["d_new", "d_old"]); // newest first
    assert.ok(!ids.includes("d_other"));
    const newest = r.result.feed.find((f) => f.id === "d_new");
    assert.equal(newest.source, "dtu");
    assert.equal(newest.kind, "spell_recipe");
  });
});

describe("companion — overnight-summary counts real changes since a window", () => {
  it("zeros for a quiet user (no DB, no notifications)", () => {
    const ctx = freshCtx();
    const r = run("overnight-summary", {}, { since: "2026-06-01T00:00:00.000Z" }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.newDtuCount, 0);
    assert.equal(r.result.newNotificationCount, 0);
    assert.equal(r.result.totalChanges, 0);
    assert.deepEqual(r.result.byKind, {});
  });

  it("counts only DTUs authored after `since` and breaks them down by kind", () => {
    const db = makeFakeDtuDb([
      { id: "d_before", creator_id: "u_on", title: "Before", kind: "blueprint", created_at: "2026-06-01T00:00:00.000Z" },
      { id: "d_after1", creator_id: "u_on", title: "After1", kind: "blueprint", created_at: "2026-06-07T10:00:00.000Z" },
      { id: "d_after2", creator_id: "u_on", title: "After2", kind: "spell_recipe", created_at: "2026-06-07T11:00:00.000Z" },
    ]);
    const ctx = { actor: { userId: "u_on" }, db };
    const r = run("overnight-summary", {}, { since: "2026-06-05T00:00:00.000Z" }, ctx);
    assert.equal(r.result.newDtuCount, 2); // d_before excluded
    assert.equal(r.result.byKind.blueprint, 1);
    assert.equal(r.result.byKind.spell_recipe, 1);
    assert.equal(r.result.totalChanges, 2);
    // Newest-first ordering of the change list.
    assert.equal(r.result.changes[0].id, "d_after2");
  });

  it("an unparseable `since` value is rejected", () => {
    const ctx = freshCtx();
    const bad = run("overnight-summary", {}, { since: "not-a-date" }, ctx);
    assert.equal(bad.ok, false);
    assert.ok(bad.error.includes("invalid since"));
  });
});

// ── Minimal fake better-sqlite3-shaped db with just the `dtus` table ─────────
// Supports: sqlite_master existence check + the SELECT … WHERE creator_id = ?
// ORDER BY created_at DESC LIMIT ? query the domain issues.
function makeFakeDtuDb(rows) {
  return {
    prepare(sql) {
      if (sql.includes("sqlite_master")) {
        return { get: (name) => (name === "dtus" ? { name: "dtus" } : undefined) };
      }
      // The authoredDtus query. Determine owner column.
      const ownerCol = sql.includes("creator_id") ? "creator_id" : "owner_user_id";
      return {
        all: (userId, limit) => {
          const matched = rows
            .filter((r) => r[ownerCol] === userId)
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
            .slice(0, Number(limit) || rows.length);
          return matched.map((r) => ({
            id: r.id, title: r.title, kind: r.kind, createdAt: r.created_at,
          }));
        },
      };
    },
  };
}
