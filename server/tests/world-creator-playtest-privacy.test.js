// FIX-world-creator-013 — playtest stays private (founder ruling A,
// 2026-11-13). Before: pressing Playtest minted a live worlds-table
// row with no privacy at all — the Sub-Worlds bridge rendered every
// table row as privacy:"public", the public GET /api/worlds listed
// it, and deleting the draft left it behind as uncleanable public
// debris (no owner Settings/Delete reached a bridged row).
//
// The fix: playtest-check's payload carries a playtest marker naming
// its draft; POST /api/worlds stamps it into the row's
// rule_modulators; the public enumerations cut marked rows
// (GET /api/worlds in routes/worlds.js, Sub-Worlds Discover here);
// Sub-Worlds Enter refuses marked rows to non-owners; the owner's
// archive verb and world-creator's draft-delete both dispose of
// marked rows. This pin drives the REAL domain handlers against a
// REAL better-sqlite3 worlds table in the seam-bridge pattern.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerSubWorldsActions from "../domains/sub-worlds.js";
import registerWorldCreatorActions from "../domains/world-creator.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, universe_type TEXT NOT NULL,
      description TEXT, substrate_dtu_ids TEXT DEFAULT '[]',
      physics_modulators TEXT DEFAULT '{}', rule_modulators TEXT DEFAULT '{}',
      created_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      population INTEGER NOT NULL DEFAULT 0, total_visits INTEGER NOT NULL DEFAULT 0,
      npc_count INTEGER NOT NULL DEFAULT 0, user_creation_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active'
    );
  `);
  return db;
}

const SW = new Map();
const WC = new Map();
registerSubWorldsActions((d, n, fn) => SW.set(n, fn));
registerWorldCreatorActions((d, n, fn) => WC.set(n, fn));
function callSW(name, ctx, params = {}) {
  const fn = SW.get(name); if (!fn) throw new Error(`sub_worlds.${name} not registered`);
  return fn(ctx, { id: null, domain: "sub_worlds", type: "domain_action", data: params, meta: {} }, params);
}
function callWC(name, ctx, params = {}) {
  const fn = WC.get(name); if (!fn) throw new Error(`world-creator.${name} not registered`);
  return fn(ctx, { id: null, domain: "world-creator", type: "domain_action", data: params, meta: {} }, params);
}

let db;
const ctxA = () => ({ actor: { userId: "user_a" }, userId: "user_a", db });
const ctxB = () => ({ actor: { userId: "user_b" }, userId: "user_b", db });

beforeEach(() => {
  db = freshDb();
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

// A worlds-table row exactly as POST /api/worlds writes it after the
// fix stamps a playtest payload's marker into rule_modulators.
function mintRow({ id, name = "Aurora Vale", createdBy = "user_a", draftId = null }) {
  const mods = draftId ? { playtest: { draftId, private: true } } : {};
  db.prepare(`INSERT INTO worlds (id, name, universe_type, description, rule_modulators, created_by)
              VALUES (?, ?, 'concordia', '', ?, ?)`).run(id, name, JSON.stringify(mods), createdBy);
}
function rowExists(id) {
  return !!db.prepare(`SELECT id FROM worlds WHERE id = ?`).get(id);
}
function makeDraft(ctx) {
  const tpl = callWC("draft-create", ctx, { name: "Aurora Vale", template: "forest_realm" });
  assert.equal(tpl.ok, true, `draft-create failed: ${tpl.error}`);
  return tpl.result.draft;
}

describe("playtest privacy (FIX-world-creator-013)", () => {
  it("playtest-check's payload carries the playtest marker naming its draft", () => {
    const draft = makeDraft(ctxA());
    const check = callWC("playtest-check", ctxA(), { id: draft.id });
    assert.equal(check.ok, true);
    assert.equal(check.result.worldPayload.playtest?.draftId, draft.id);
  });

  it("an unclaimed playtest copy surfaces in NOBODY's Discover; a founded world still does", () => {
    mintRow({ id: "world-pt1", draftId: "draft-x" });
    mintRow({ id: "world-founded", name: "Founded Moon" });
    for (const ctx of [ctxA(), ctxB()]) {
      const r = callSW("discover", ctx, {});
      const ids = r.result.worlds.map((w) => w.world_id);
      assert.ok(!ids.includes("world-pt1"), "playtest copy must not enumerate in Discover");
      assert.ok(ids.includes("world-founded"), "control: a founded world still surfaces");
    }
  });

  it("Enter refuses a playtest copy to non-owners and allows its owner", () => {
    mintRow({ id: "world-pt2", draftId: "draft-x" });
    const denied = callSW("visit", ctxB(), { worldId: "world-pt2" });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "world is private");
    const own = callSW("visit", ctxA(), { worldId: "world-pt2" });
    assert.equal(own.ok, true, `owner enter failed: ${own.error}`);
  });

  it("the owner's My Worlds shows the playtest copy labelled private; other accounts don't see it", () => {
    mintRow({ id: "world-pt3", draftId: "draft-x" });
    const mine = callSW("list", ctxA(), {});
    const row = mine.result.worlds.find((w) => w.world_id === "world-pt3");
    assert.ok(row, "owner sees their own playtest copy");
    assert.equal(row.privacy, "private");
    const other = callSW("list", ctxB(), {});
    assert.ok(!other.result.worlds.some((w) => w.world_id === "world-pt3"));
  });

  it("the owner's archive verb disposes of a playtest copy; a non-owner's cannot", () => {
    mintRow({ id: "world-pt4", draftId: "draft-x" });
    const denied = callSW("archive", ctxB(), { worldId: "world-pt4", hardDelete: true });
    assert.equal(denied.ok, false);
    assert.ok(rowExists("world-pt4"), "non-owner delete must not land");
    const gone = callSW("archive", ctxA(), { worldId: "world-pt4", hardDelete: true });
    assert.equal(gone.ok, true);
    assert.ok(!rowExists("world-pt4"), "owner delete removes the row");
  });

  it("deleting the draft discards its linked mint AND its unlinked orphan copies — nothing else", () => {
    const draft = makeDraft(ctxA());
    mintRow({ id: "world-linked", draftId: draft.id });
    mintRow({ id: "world-orphan", draftId: draft.id });
    mintRow({ id: "world-founded2", name: "Founded Moon" });
    mintRow({ id: "world-spoof", draftId: draft.id, createdBy: "user_b" });
    const pub = callWC("draft-publish", ctxA(), { id: draft.id, visibility: "private", publishedWorldId: "world-linked" });
    assert.equal(pub.ok, true);
    const del = callWC("draft-delete", ctxA(), { id: draft.id });
    assert.equal(del.ok, true);
    assert.ok(!rowExists("world-linked"), "linked mint dies with the draft");
    assert.ok(!rowExists("world-orphan"), "orphan playtest copy dies with the draft");
    assert.ok(rowExists("world-founded2"), "an unmarked founded world never cascades");
    assert.ok(rowExists("world-spoof"), "another account's row never cascades, marker or not");
  });
});
