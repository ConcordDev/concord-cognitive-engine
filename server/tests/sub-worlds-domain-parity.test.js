// Contract tests for server/domains/sub-worlds.js — the Roblox / Rec Room
// parity creator-platform layer: spawn, discovery gallery, settings,
// archive/delete, visit + visitor counts, favorites, analytics,
// co-editor permissions, and the in-place world editor.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSubWorldsActions from "../domains/sub-worlds.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`sub_worlds.${name}`);
  assert.ok(fn, `sub_worlds.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerSubWorldsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function spawn(ctx = ctxA, over = {}) {
  return call("spawn", ctx, { name: "Gravity Lab", kind: "physics_simulator", ...over }).result.world;
}

describe("sub_worlds.spawn + list", () => {
  it("spawns and scopes worlds per user", () => {
    assert.equal(call("spawn", ctxA, { name: "X" }).ok, false); // name too short
    const w = spawn();
    assert.equal(w.name, "Gravity Lab");
    assert.equal(w.status, "active");
    assert.equal(call("list", ctxA).result.worlds.length, 1);
    assert.equal(call("list", ctxB).result.worlds.length, 0);
  });
});

describe("sub_worlds.discover", () => {
  it("surfaces public worlds cross-user; hides private", () => {
    spawn(ctxA, { name: "Public Realm", privacy: "public" });
    spawn(ctxA, { name: "Secret Realm", privacy: "private" });
    const r = call("discover", ctxB, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.worlds.length, 1);
    assert.equal(r.result.worlds[0].name, "Public Realm");
  });
  it("filters by query and kind", () => {
    spawn(ctxA, { name: "Ocean Sim", kind: "physics_simulator" });
    spawn(ctxA, { name: "Math Zone", kind: "research_zone" });
    assert.equal(call("discover", ctxB, { query: "ocean" }).result.worlds.length, 1);
    assert.equal(call("discover", ctxB, { kind: "research_zone" }).result.worlds.length, 1);
  });
});

describe("sub_worlds.update_settings + set_status", () => {
  it("renames, changes privacy and capacity", () => {
    const w = spawn();
    const r = call("update_settings", ctxA, { worldId: w.world_id, name: "Renamed", privacy: "unlisted", capacity: 32 });
    assert.equal(r.ok, true);
    assert.equal(r.result.world.name, "Renamed");
    assert.equal(r.result.world.privacy, "unlisted");
    assert.equal(r.result.world.capacity, 32);
  });
  it("rejects edits from non-owners", () => {
    const w = spawn(ctxA);
    assert.equal(call("update_settings", ctxB, { worldId: w.world_id, name: "Hijack" }).ok, false);
  });
  it("toggles status", () => {
    const w = spawn();
    assert.equal(call("set_status", ctxA, { worldId: w.world_id, status: "paused" }).result.world.status, "paused");
    assert.equal(call("set_status", ctxA, { worldId: w.world_id, status: "bogus" }).ok, false);
  });
});

describe("sub_worlds.archive", () => {
  it("soft-archives and hard-deletes", () => {
    const w1 = spawn();
    assert.equal(call("archive", ctxA, { worldId: w1.world_id }).result.archived, true);
    assert.equal(call("list", ctxA, { status: "archived" }).result.worlds.length, 1);
    const w2 = spawn();
    assert.equal(call("archive", ctxA, { worldId: w2.world_id, hardDelete: true }).result.deleted, true);
  });
  it("only the owner can archive", () => {
    const w = spawn(ctxA);
    assert.equal(call("archive", ctxB, { worldId: w.world_id }).ok, false);
  });
});

describe("sub_worlds.visit + favorites + analytics", () => {
  it("records visits and unique visitors", () => {
    const w = spawn(ctxA);
    const r1 = call("visit", ctxB, { worldId: w.world_id });
    assert.equal(r1.ok, true);
    assert.equal(r1.result.travel.destination_world_id, w.world_id);
    assert.equal(r1.result.visits, 1);
    call("visit", ctxB, { worldId: w.world_id });
    const r2 = call("visit", ctxA, { worldId: w.world_id });
    assert.equal(r2.result.visits, 3);
    assert.equal(r2.result.unique_visitors, 2);
  });
  it("favorites and lists my favorites", () => {
    const w = spawn(ctxA);
    assert.equal(call("favorite", ctxB, { worldId: w.world_id }).result.favorited, true);
    assert.equal(call("my_favorites", ctxB).result.worlds.length, 1);
    assert.equal(call("favorite", ctxB, { worldId: w.world_id, favorite: false }).result.favorited, false);
    assert.equal(call("my_favorites", ctxB).result.worlds.length, 0);
  });
  it("analytics returns a 14-day visit timeline", () => {
    const w = spawn(ctxA);
    call("visit", ctxB, { worldId: w.world_id });
    const r = call("analytics", ctxA, { worldId: w.world_id });
    assert.equal(r.ok, true);
    assert.equal(r.result.total_visits, 1);
    assert.equal(r.result.timeline.length, 14);
    assert.equal(call("analytics", ctxB, { worldId: w.world_id }).ok, false); // not authorized
  });
});

describe("sub_worlds.invite_editor + remove_editor", () => {
  it("invites a co-editor who can then edit", () => {
    const w = spawn(ctxA);
    assert.equal(call("invite_editor", ctxA, { worldId: w.world_id, editorUserId: "user_b" }).ok, true);
    assert.equal(call("update_settings", ctxB, { worldId: w.world_id, name: "Co-edited" }).ok, true);
    assert.equal(call("remove_editor", ctxA, { worldId: w.world_id, editorUserId: "user_b" }).ok, true);
    assert.equal(call("update_settings", ctxB, { worldId: w.world_id, name: "Blocked" }).ok, false);
  });
  it("rejects non-owner invites", () => {
    const w = spawn(ctxA);
    assert.equal(call("invite_editor", ctxB, { worldId: w.world_id, editorUserId: "user_c" }).ok, false);
  });
});

describe("sub_worlds.editor_* in-place editor", () => {
  it("adds and removes blocks, tracks editor log", () => {
    const w = spawn(ctxA);
    const add = call("editor_add_block", ctxA, { worldId: w.world_id, type: "spawn_point", label: "Start", x: 1, y: 2 });
    assert.equal(add.ok, true);
    assert.equal(add.result.blocks.length, 1);
    const state = call("editor_state", ctxA, { worldId: w.world_id });
    assert.equal(state.result.blocks.length, 1);
    assert.equal(state.result.editor_log.length, 1);
    assert.equal(call("editor_add_block", ctxA, { worldId: w.world_id, type: "bogus" }).ok, false);
    const rm = call("editor_remove_block", ctxA, { worldId: w.world_id, blockId: add.result.block.id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.blocks.length, 0);
  });
  it("blocks editor access for non-editors", () => {
    const w = spawn(ctxA);
    assert.equal(call("editor_add_block", ctxB, { worldId: w.world_id, type: "prop" }).ok, false);
  });
});
