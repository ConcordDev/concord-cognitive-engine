// B15 seam bridge — the discovery union (register B15; Lead pricing in
// world-creator.md, 2026-11-06). Drives the REAL sub_worlds domain
// handlers + the REAL world-creator domain handlers against one
// shared STATE and a REAL better-sqlite3 worlds table (migration
// 042's shape), and asserts the compilation's A3 instrument: a
// published world-creator draft appears in Sub-Worlds' Discover /
// My Worlds AS THE SAME OBJECT (name/description as authored), a
// playtest-minted world joins it as the same object, private drafts
// stay invisible to every other account, and Enter resolves through
// the worlds table — never a fabricated destination.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerSubWorldsActions from "../domains/sub-worlds.js";
import registerWorldCreatorActions from "../domains/world-creator.js";
import { loadWorld } from "../lib/world-loader.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE worlds (
      id                   TEXT PRIMARY KEY,
      name                 TEXT NOT NULL,
      universe_type        TEXT NOT NULL,
      description          TEXT,
      substrate_dtu_ids    TEXT DEFAULT '[]',
      physics_modulators   TEXT DEFAULT '{}',
      rule_modulators      TEXT DEFAULT '{}',
      created_by           TEXT,
      created_at           INTEGER NOT NULL DEFAULT (unixepoch()),
      population           INTEGER NOT NULL DEFAULT 0,
      total_visits         INTEGER NOT NULL DEFAULT 0,
      npc_count            INTEGER NOT NULL DEFAULT 0,
      user_creation_count  INTEGER NOT NULL DEFAULT 0,
      status               TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE world_substrate_dtus (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL, dtu_id TEXT NOT NULL,
      substrate_role TEXT NOT NULL DEFAULT 'element', added_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  return db;
}

const SW = new Map();
const WC = new Map();
function regSW(domain, name, handler) { assert.equal(domain, "sub_worlds"); SW.set(name, handler); }
function regWC(domain, name, handler) { assert.equal(domain, "world-creator"); WC.set(name, handler); }
registerSubWorldsActions(regSW);
registerWorldCreatorActions(regWC);

function callSW(name, ctx, params = {}) {
  const fn = SW.get(name);
  if (!fn) throw new Error(`sub_worlds.${name} not registered`);
  return fn(ctx, { id: null, domain: "sub_worlds", type: "domain_action", data: params, meta: {} }, params);
}
function callWC(name, ctx, params = {}) {
  const fn = WC.get(name);
  if (!fn) throw new Error(`world-creator.${name} not registered`);
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

// Author a draft with a spawn point (publish requires one for
// non-private), then publish it at the given visibility.
function authorDraft(ctx, { name = "Aurora Vale", description = "A vale of authored light.", visibility = "public" } = {}) {
  const tpl = callWC("draft-create", ctx, { name, description, template: "forest_realm" });
  assert.equal(tpl.ok, true, `draft-create failed: ${tpl.error}`);
  const draft = tpl.result.draft;
  assert.ok(draft.spawnPoints.length > 0, "template draft carries a spawn point");
  const pub = callWC("draft-publish", ctx, { id: draft.id, visibility });
  assert.equal(pub.ok, true, `draft-publish failed: ${pub.error}`);
  return draft;
}

describe("B15 seam bridge — the discovery union", () => {
  it("A3: a published draft appears in Sub-Worlds Discover as the same object", () => {
    const draft = authorDraft(ctxA());
    const r = callSW("discover", ctxB(), {});
    assert.equal(r.ok, true);
    const row = r.result.worlds.find((w) => w.world_id === draft.id);
    assert.ok(row, "published draft is discoverable from another account");
    assert.equal(row.name, "Aurora Vale");
    assert.equal(row.description, "A vale of authored light.");
    assert.equal(row.spawned_by_user_id, "user_a");
    assert.equal(row.source, "world_creator");
    assert.equal(row.enterId, null);
    assert.equal(row.enterable, false);
    assert.match(row.enterNote, /playtest/i);
    assert.equal(row.can_edit, false);
    assert.equal(row.is_owner, false);
  });

  it("privacy at the read: private and unlisted drafts never surface in another account's Discover", () => {
    authorDraft(ctxA(), { name: "Secret Vale", visibility: "private" });
    authorDraft(ctxA(), { name: "Quiet Vale", visibility: "unlisted" });
    const r = callSW("discover", ctxB(), {});
    const names = r.result.worlds.map((w) => w.name);
    assert.ok(!names.includes("Secret Vale"), "private draft invisible");
    assert.ok(!names.includes("Quiet Vale"), "unlisted draft not in the public gallery");
  });

  it("My Worlds: the owner sees their own drafts at any visibility, with their store worlds", () => {
    authorDraft(ctxA(), { name: "Secret Vale", visibility: "private" });
    callSW("spawn", ctxA(), { name: "Gravity Lab", kind: "physics_simulator" });
    const mine = callSW("list", ctxA(), {});
    const names = mine.result.worlds.map((w) => w.name);
    assert.ok(names.includes("Secret Vale"));
    assert.ok(names.includes("Gravity Lab"));
    const other = callSW("list", ctxB(), {});
    assert.ok(!other.result.worlds.map((w) => w.name).includes("Secret Vale"));
  });

  it("dedupe: a spawned world renders once in Discover although its mirror row exists", () => {
    const spawned = callSW("spawn", ctxA(), { name: "Gravity Lab", kind: "physics_simulator" });
    const wid = spawned.result.world.world_id;
    assert.ok(loadWorld(db, wid), "spawn mirrored into the worlds table");
    const r = callSW("discover", ctxB(), {});
    const rows = r.result.worlds.filter((w) => w.world_id === wid);
    assert.equal(rows.length, 1, "one object, rendered once");
    assert.equal(rows[0].source, "sub_worlds");
  });

  it("dedupe: a minted draft renders once, keyed by its publishedWorldId", () => {
    const draft = authorDraft(ctxA());
    // Playtest mint: the worlds-table row + the draft's back-reference.
    db.prepare(`INSERT INTO worlds (id, name, universe_type, description, created_by, status)
                VALUES ('world_mint_1', 'Aurora Vale', 'concordia-hub', 'A vale of authored light.', 'user_a', 'active')`).run();
    const pub = callWC("draft-publish", ctxA(), { id: draft.id, visibility: "public", publishedWorldId: "world_mint_1" });
    assert.equal(pub.ok, true);
    const r = callSW("discover", ctxB(), {});
    const rows = r.result.worlds.filter((w) => w.world_id === draft.id || w.world_id === "world_mint_1");
    assert.equal(rows.length, 1, "the draft and its mint are one object");
    assert.equal(rows[0].world_id, draft.id);
    assert.equal(rows[0].enterId, "world_mint_1");
    assert.equal(rows[0].enterable, true);
  });

  it("an unlinked table world (a bare mint) surfaces as its own object", () => {
    db.prepare(`INSERT INTO worlds (id, name, universe_type, description, created_by, status)
                VALUES ('world_bare_1', 'Bare Mint', 'concordia-hub', 'Minted outside any lens store.', 'user_a', 'active')`).run();
    const r = callSW("discover", ctxB(), {});
    const row = r.result.worlds.find((w) => w.world_id === "world_bare_1");
    assert.ok(row);
    assert.equal(row.source, "worlds_table");
    assert.equal(row.enterId, "world_bare_1");
    assert.equal(row.enterable, true);
  });

  it("Enter: visit on a table world resolves through the table and counts on its row", () => {
    db.prepare(`INSERT INTO worlds (id, name, universe_type, description, created_by, status)
                VALUES ('world_bare_1', 'Bare Mint', 'concordia-hub', 'Minted outside any lens store.', 'user_a', 'active')`).run();
    const v = callSW("visit", ctxB(), { worldId: "world_bare_1" });
    assert.equal(v.ok, true, `visit failed: ${v.error}`);
    assert.equal(v.result.travel.destination_world_id, "world_bare_1");
    assert.equal(v.result.visits, 1);
    assert.ok(loadWorld(db, v.result.travel.destination_world_id), "the destination resolves through loadWorld");
    const r = callSW("discover", ctxB(), {});
    assert.equal(r.result.worlds.find((w) => w.world_id === "world_bare_1").visits, 1);
  });

  it("Enter: an unminted draft refuses in words — never a fabricated destination", () => {
    const draft = authorDraft(ctxA());
    const v = callSW("visit", ctxB(), { worldId: draft.id });
    assert.equal(v.ok, false);
    assert.match(v.error, /playtest/i);
  });

  it("Enter: a private draft's mint is not enterable from another account", () => {
    const draft = authorDraft(ctxA(), { visibility: "private" });
    db.prepare(`INSERT INTO worlds (id, name, universe_type, description, created_by, status)
                VALUES ('world_priv_1', 'Aurora Vale', 'concordia-hub', 'A vale of authored light.', 'user_a', 'active')`).run();
    const pub = callWC("draft-publish", ctxA(), { id: draft.id, visibility: "private", publishedWorldId: "world_priv_1" });
    assert.equal(pub.ok, true);
    assert.equal(callSW("visit", ctxB(), { worldId: draft.id }).ok, false);
    assert.equal(callSW("visit", ctxB(), { worldId: "world_priv_1" }).ok, false);
    assert.equal(callSW("visit", ctxA(), { worldId: draft.id }).ok, true, "the creator still enters their own mint");
  });

  it("favorites: a bridged row favorites, counts, and renders in my_favorites", () => {
    const draft = authorDraft(ctxA());
    const f = callSW("favorite", ctxB(), { worldId: draft.id, favorite: true });
    assert.equal(f.ok, true);
    assert.equal(f.result.favorites, 1);
    const favs = callSW("my_favorites", ctxB(), {});
    const row = favs.result.worlds.find((w) => w.world_id === draft.id);
    assert.ok(row, "the favorited draft renders in my_favorites");
    assert.equal(row.name, "Aurora Vale");
    assert.equal(row.favorites, 1);
    const disc = callSW("discover", ctxB(), {});
    assert.equal(disc.result.worlds.find((w) => w.world_id === draft.id).favorites, 1);
  });

  it("the union does not wake the store-scoped verbs for bridged rows", () => {
    const draft = authorDraft(ctxA());
    assert.equal(callSW("analytics", ctxA(), { worldId: draft.id }).ok, false);
    assert.equal(callSW("update_settings", ctxA(), { worldId: draft.id, name: "Renamed" }).ok, false);
  });
});
