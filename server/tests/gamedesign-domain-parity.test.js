// Contract tests for the game-design Tiled + LDtk + Nuclino 2026-parity
// workbench (game projects, GDD sections, mechanics, entities, and a
// grid tilemap level editor).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGameDesignActions from "../domains/gamedesign.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`game-design.${name}`);
  assert.ok(fn, `game-design.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerGameDesignActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newGame(ctx = ctxA) {
  const r = call("game-create", ctx, { title: "Star Drifter", genre: "platformer" });
  assert.equal(r.ok, true);
  return r.result.game.id;
}

describe("game-design.game-*", () => {
  it("creates, lists, updates and deletes games with cascade", () => {
    const gid = newGame();
    call("gdd-add", ctxA, { gameId: gid, title: "Pitch", content: "A cosmic platformer." });
    assert.equal(call("game-list", ctxA, {}).result.count, 1);
    assert.equal(call("game-get", ctxA, { id: gid }).result.gdd.length, 1);
    call("game-update", ctxA, { id: gid, platform: "switch" });
    assert.equal(call("game-get", ctxA, { id: gid }).result.game.platform, "switch");
    call("game-delete", ctxA, { id: gid });
    assert.equal(call("game-list", ctxA, {}).result.count, 0);
  });

  it("isolates games per user", () => {
    newGame(ctxA);
    assert.equal(call("game-list", ctxB, {}).result.count, 0);
  });
});

describe("game-design GDD / mechanics / entities", () => {
  it("manages GDD sections", () => {
    const gid = newGame();
    const sec = call("gdd-add", ctxA, { gameId: gid, title: "Story" }).result.section;
    call("gdd-update", ctxA, { id: sec.id, content: "Once upon a galaxy." });
    assert.equal(call("game-get", ctxA, { id: gid }).result.gdd[0].content, "Once upon a galaxy.");
    call("gdd-delete", ctxA, { id: sec.id });
    assert.equal(call("game-get", ctxA, { id: gid }).result.gdd.length, 0);
  });

  it("adds mechanics with categories", () => {
    const gid = newGame();
    call("mechanic-add", ctxA, { gameId: gid, name: "Double jump", category: "core" });
    call("mechanic-add", ctxA, { gameId: gid, name: "Skill tree", category: "progression" });
    assert.equal(call("game-get", ctxA, { id: gid }).result.mechanics.length, 2);
  });

  it("adds entities with stats", () => {
    const gid = newGame();
    const e = call("entity-add", ctxA, { gameId: gid, name: "Slime", kind: "enemy", health: 20, damage: 5 }).result.entity;
    assert.equal(e.health, 20);
    call("entity-update", ctxA, { id: e.id, health: 30 });
    assert.equal(call("game-get", ctxA, { id: gid }).result.entities[0].health, 30);
    call("entity-delete", ctxA, { id: e.id });
    assert.equal(call("game-get", ctxA, { id: gid }).result.entities.length, 0);
  });
});

describe("game-design tile palette & levels", () => {
  it("returns the built-in tile palette", () => {
    const r = call("tile-palette", ctxA, {});
    assert.ok(r.result.tiles.length >= 12);
    assert.ok(r.result.tiles.some((t) => t.id === "grass"));
  });

  it("creates a level with two layers sized to the grid", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, name: "1-1", cols: 10, rows: 8 }).result.level;
    assert.equal(lvl.layers.length, 2);
    assert.equal(lvl.layers[0].tiles.length, 80);
    assert.equal(lvl.layers[0].tiles[0], null);
  });

  it("paints, batch-paints and fills a layer", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 6, rows: 6 }).result.level;
    const layerId = lvl.layers[1].id;
    call("level-paint", ctxA, { levelId: lvl.id, layerId, index: 7, tile: "wall" });
    let got = call("level-get", ctxA, { id: lvl.id }).result.level;
    assert.equal(got.layers[1].tiles[7], "wall");
    call("level-paint-batch", ctxA, { levelId: lvl.id, layerId, cells: [{ index: 0, tile: "grass" }, { index: 1, tile: "grass" }] });
    got = call("level-get", ctxA, { id: lvl.id }).result.level;
    assert.equal(got.layers[1].tiles[1], "grass");
    call("level-fill-layer", ctxA, { levelId: lvl.id, layerId, tile: null });
    got = call("level-get", ctxA, { id: lvl.id }).result.level;
    assert.equal(got.layers[1].tiles.every((t) => t === null), true);
  });

  it("rejects an out-of-range paint index and an unknown tile resolves to null", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 4, rows: 4 }).result.level;
    const layerId = lvl.layers[0].id;
    assert.equal(call("level-paint", ctxA, { levelId: lvl.id, layerId, index: 999, tile: "grass" }).ok, false);
    call("level-paint", ctxA, { levelId: lvl.id, layerId, index: 0, tile: "not-a-tile" });
    assert.equal(call("level-get", ctxA, { id: lvl.id }).result.level.layers[0].tiles[0], null);
  });

  it("adds an extra layer and toggles visibility", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 5, rows: 5 }).result.level;
    const layer = call("level-layer-add", ctxA, { levelId: lvl.id, name: "Objects" }).result.layer;
    call("level-layer-update", ctxA, { levelId: lvl.id, layerId: layer.id, visible: false });
    const got = call("level-get", ctxA, { id: lvl.id }).result.level;
    assert.equal(got.layers.length, 3);
    assert.equal(got.layers[2].visible, false);
  });
});

describe("game-design.game-dashboard", () => {
  it("rolls up the project", () => {
    const gid = newGame();
    call("mechanic-add", ctxA, { gameId: gid, name: "Dash", category: "core" });
    call("level-create", ctxA, { gameId: gid });
    const d = call("game-dashboard", ctxA, { gameId: gid });
    assert.equal(d.result.mechanics, 1);
    assert.equal(d.result.levels, 1);
    assert.equal(d.result.mechanicsByCategory.core, 1);
  });
});
