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

describe("game-design level layers — reorder / delete / duplicate / opacity", () => {
  it("reorders, sets opacity, duplicates and deletes layers", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 6, rows: 6 }).result.level;
    const [bg, fg] = lvl.layers;
    // reorder
    call("level-layer-reorder", ctxA, { levelId: lvl.id, order: [fg.id, bg.id] });
    assert.equal(call("level-get", ctxA, { id: lvl.id }).result.level.layers[0].id, fg.id);
    // opacity clamp
    call("level-layer-update", ctxA, { levelId: lvl.id, layerId: bg.id, opacity: 0.4 });
    assert.equal(call("level-get", ctxA, { id: lvl.id }).result.level.layers[1].opacity, 0.4);
    // duplicate copies tiles
    call("level-paint", ctxA, { levelId: lvl.id, layerId: bg.id, index: 3, tile: "stone" });
    const dup = call("level-layer-duplicate", ctxA, { levelId: lvl.id, layerId: bg.id }).result.layer;
    assert.equal(dup.tiles[3], "stone");
    assert.equal(call("level-get", ctxA, { id: lvl.id }).result.level.layers.length, 3);
    // delete
    call("level-layer-delete", ctxA, { levelId: lvl.id, layerId: dup.id });
    assert.equal(call("level-get", ctxA, { id: lvl.id }).result.level.layers.length, 2);
  });

  it("refuses a bad reorder and refuses to delete the last layer", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 4, rows: 4 }).result.level;
    assert.equal(call("level-layer-reorder", ctxA, { levelId: lvl.id, order: ["bad"] }).ok, false);
    call("level-layer-delete", ctxA, { levelId: lvl.id, layerId: lvl.layers[0].id });
    const got = call("level-get", ctxA, { id: lvl.id }).result.level;
    assert.equal(got.layers.length, 1);
    assert.equal(call("level-layer-delete", ctxA, { levelId: lvl.id, layerId: got.layers[0].id }).ok, false);
  });
});

describe("game-design object layers", () => {
  it("places, updates and deletes objects on an object layer", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 8, rows: 8 }).result.level;
    const layer = call("level-layer-add", ctxA, { levelId: lvl.id, kind: "object", name: "Entities" }).result.layer;
    assert.equal(layer.kind, "object");
    const obj = call("level-object-add", ctxA, { levelId: lvl.id, layerId: layer.id, name: "Spawn", x: 32, y: 64 }).result.object;
    assert.equal(obj.x, 32);
    call("level-object-update", ctxA, { levelId: lvl.id, id: obj.id, x: 100 });
    const got = call("level-get", ctxA, { id: lvl.id }).result.level;
    assert.equal(got.layers[2].objects[0].x, 100);
    call("level-object-delete", ctxA, { levelId: lvl.id, id: obj.id });
    assert.equal(call("level-get", ctxA, { id: lvl.id }).result.level.layers[2].objects.length, 0);
  });

  it("rejects painting an object layer with tile macros", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 4, rows: 4 }).result.level;
    const layer = call("level-layer-add", ctxA, { levelId: lvl.id, kind: "object" }).result.layer;
    assert.equal(call("level-paint", ctxA, { levelId: lvl.id, layerId: layer.id, index: 0, tile: "grass" }).ok, false);
  });
});

describe("game-design IntGrid + auto-layer", () => {
  it("paints integer values and auto-generates a tile layer from rules", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 4, rows: 4 }).result.level;
    const intLayer = call("level-layer-add", ctxA, { levelId: lvl.id, kind: "intgrid" }).result.layer;
    const tileLayer = lvl.layers[0].id;
    call("level-paint", ctxA, { levelId: lvl.id, layerId: intLayer.id, index: 0, tile: 1 });
    call("level-paint", ctxA, { levelId: lvl.id, layerId: intLayer.id, index: 5, tile: 1 });
    call("autotile-rule-add", ctxA, { gameId: gid, intValue: 1, tile: "wall" });
    const auto = call("level-autotile", ctxA, { levelId: lvl.id, sourceLayerId: intLayer.id, targetLayerId: tileLayer });
    assert.equal(auto.result.painted, 2);
    const got = call("level-get", ctxA, { id: lvl.id }).result.level;
    assert.equal(got.layers[0].tiles[0], "wall");
    assert.equal(got.layers[0].tiles[1], null);
  });

  it("rejects autotile when the source is not an IntGrid layer", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 4, rows: 4 }).result.level;
    const r = call("level-autotile", ctxA, { levelId: lvl.id, sourceLayerId: lvl.layers[0].id, targetLayerId: lvl.layers[1].id });
    assert.equal(r.ok, false);
  });
});

describe("game-design level resize / duplicate / export", () => {
  it("resizes a level preserving tiles inside the new bounds", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 6, rows: 6 }).result.level;
    call("level-paint", ctxA, { levelId: lvl.id, layerId: lvl.layers[0].id, index: 0, tile: "grass" });
    call("level-resize", ctxA, { levelId: lvl.id, cols: 10, rows: 10 });
    const got = call("level-get", ctxA, { id: lvl.id }).result.level;
    assert.equal(got.cols, 10);
    assert.equal(got.layers[0].tiles.length, 100);
    assert.equal(got.layers[0].tiles[0], "grass");
  });

  it("duplicates a level and exports JSON", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 5, rows: 5, orientation: "isometric" }).result.level;
    const copy = call("level-duplicate", ctxA, { id: lvl.id }).result.level;
    assert.notEqual(copy.id, lvl.id);
    assert.equal(copy.orientation, "isometric");
    const exp = call("level-export", ctxA, { id: lvl.id });
    assert.equal(exp.result.map.width, 5);
    assert.ok(exp.result.json.includes("isometric"));
  });
});

describe("game-design custom tiles", () => {
  it("creates custom tiles usable in paint", () => {
    const gid = newGame();
    const tile = call("tile-create", ctxA, { gameId: gid, name: "Crystal", color: "#22d3ee" }).result.tile;
    const list = call("tile-list", ctxA, { gameId: gid }).result;
    assert.ok(list.all.some((t) => t.id === tile.id));
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 4, rows: 4 }).result.level;
    call("level-paint", ctxA, { levelId: lvl.id, layerId: lvl.layers[0].id, index: 0, tile: tile.id });
    assert.equal(call("level-get", ctxA, { id: lvl.id }).result.level.layers[0].tiles[0], tile.id);
    call("tile-delete", ctxA, { id: tile.id });
    assert.equal(call("tile-list", ctxA, { gameId: gid }).result.custom.length, 0);
  });
});

describe("game-design entity fields + enums", () => {
  it("sets typed custom fields on an entity", () => {
    const gid = newGame();
    const e = call("entity-add", ctxA, { gameId: gid, name: "Mob", kind: "enemy" }).result.entity;
    call("entity-field-set", ctxA, { entityId: e.id, key: "aggroRange", type: "int", value: "8" });
    call("entity-field-set", ctxA, { entityId: e.id, key: "flying", type: "bool", value: true });
    let ent = call("game-get", ctxA, { id: gid }).result.entities[0];
    assert.equal(ent.fields.length, 2);
    assert.equal(ent.fields.find((f) => f.key === "aggroRange").value, 8);
    call("entity-field-delete", ctxA, { entityId: e.id, key: "flying" });
    ent = call("game-get", ctxA, { id: gid }).result.entities[0];
    assert.equal(ent.fields.length, 1);
  });

  it("creates and lists enums", () => {
    const gid = newGame();
    call("enum-create", ctxA, { gameId: gid, name: "ItemType", values: ["money", "ammo", "gun", "money"] });
    const enums = call("enum-list", ctxA, { gameId: gid }).result.enums;
    assert.equal(enums.length, 1);
    assert.equal(enums[0].values.length, 3); // deduped
  });
});

describe("game-design core loops", () => {
  it("models a loop and analyses net resource delta", () => {
    const gid = newGame();
    const loop = call("loop-create", ctxA, { gameId: gid, name: "Combat loop", kind: "core" }).result.loop;
    call("loop-step-add", ctxA, { loopId: loop.id, label: "Kill enemy", delta: 10, resource: "gold" });
    call("loop-step-add", ctxA, { loopId: loop.id, label: "Buy upgrade", delta: -12, resource: "gold" });
    const a = call("loop-analysis", ctxA, { gameId: gid });
    assert.equal(a.result.totalLoops, 1);
    assert.equal(a.result.loops[0].netDelta, -2);
    call("loop-step-delete", ctxA, { loopId: loop.id, stepId: call("loop-list", ctxA, { gameId: gid }).result.loops[0].steps[1].id });
    assert.equal(call("loop-list", ctxA, { gameId: gid }).result.loops[0].steps.length, 1);
    call("loop-delete", ctxA, { id: loop.id });
    assert.equal(call("loop-list", ctxA, { gameId: gid }).result.count, 0);
  });
});

describe("game-design narrative graph", () => {
  it("builds nodes, links them and analyses reachability", () => {
    const gid = newGame();
    const a = call("narrative-node-create", ctxA, { gameId: gid, title: "Open", kind: "start" }).result.node;
    const b = call("narrative-node-create", ctxA, { gameId: gid, title: "Fork", kind: "scene" }).result.node;
    const c = call("narrative-node-create", ctxA, { gameId: gid, title: "Good end", kind: "ending" }).result.node;
    call("narrative-link-add", ctxA, { fromId: a.id, toId: b.id, label: "enter" });
    call("narrative-link-add", ctxA, { fromId: b.id, toId: c.id, label: "win" });
    const g = call("narrative-graph", ctxA, { gameId: gid });
    assert.equal(g.result.totalNodes, 3);
    assert.equal(g.result.maxDepth, 2);
    assert.equal(g.result.unreachable.length, 0);
    assert.equal(call("narrative-link-add", ctxA, { fromId: a.id, toId: a.id }).ok, false);
    call("narrative-node-delete", ctxA, { id: b.id });
    // deleting b orphans c — links cascade-removed
    assert.equal(call("narrative-node-list", ctxA, { gameId: gid }).result.links.length, 0);
  });
});

describe("game-design balance report + project export + gdd reorder", () => {
  it("reports entity balance and flags an entity far above the curve", () => {
    const gid = newGame();
    for (let i = 0; i < 4; i++) {
      call("entity-add", ctxA, { gameId: gid, name: `Rat ${i}`, kind: "enemy", health: 10, damage: 2 });
    }
    call("entity-add", ctxA, { gameId: gid, name: "Titan", kind: "enemy", health: 500, damage: 90 });
    const r = call("balance-report", ctxA, { gameId: gid });
    assert.equal(r.result.entities, 5);
    assert.ok(r.result.outliers.includes("Titan"));
    assert.equal(r.result.byKind.enemy.count, 5);
  });

  it("reorders GDD sections and exports the whole project", () => {
    const gid = newGame();
    const s1 = call("gdd-add", ctxA, { gameId: gid, title: "One" }).result.section;
    const s2 = call("gdd-add", ctxA, { gameId: gid, title: "Two" }).result.section;
    call("gdd-reorder", ctxA, { gameId: gid, order: [s2.id, s1.id] });
    assert.equal(call("game-get", ctxA, { id: gid }).result.gdd[0].title, "Two");
    const exp = call("game-export", ctxA, { gameId: gid });
    assert.equal(exp.result.project.gdd.length, 2);
    assert.ok(exp.result.json.length > 0);
  });
});

// ── Backlog 1 + 3 — playable runtime + collision/physics config ───────
describe("game-design runtime-compile + collision config", () => {
  it("reads and writes a level's collision/physics config", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 6, rows: 6 }).result.level;
    let cfg = call("level-collision-get", ctxA, { levelId: lvl.id }).result.collision;
    assert.equal(cfg.gravity, 980);
    assert.equal(cfg.solidTiles.length, 0);
    cfg = call("level-collision-set", ctxA, {
      levelId: lvl.id, gravity: 1200, solidTiles: ["wall", "stone", "wall"], hazardTiles: ["lava"],
      solidInts: [1, 2], hazardInts: [3],
    }).result.collision;
    assert.equal(cfg.gravity, 1200);
    assert.equal(cfg.solidTiles.length, 2); // deduped
    assert.deepEqual(cfg.hazardInts, [3]);
  });

  it("compiles a level into a runnable scene with collision grid + spawn", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 5, rows: 5 }).result.level;
    call("level-fill-layer", ctxA, { levelId: lvl.id, layerId: lvl.layers[0].id, tile: "wall" });
    call("level-collision-set", ctxA, { levelId: lvl.id, solidTiles: ["wall"], hazardTiles: ["lava"] });
    // place a player entity on an object layer for the spawn
    const ent = call("entity-add", ctxA, { gameId: gid, name: "Hero", kind: "player" }).result.entity;
    const objLayer = call("level-layer-add", ctxA, { levelId: lvl.id, kind: "object" }).result.layer;
    call("level-object-add", ctxA, { levelId: lvl.id, layerId: objLayer.id, name: "Start", x: 48, y: 24, entityId: ent.id });
    const r = call("runtime-compile", ctxA, { levelId: lvl.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.scene.collision.solidCount, 25);
    assert.equal(r.result.scene.spawn.x, 48);
    assert.equal(r.result.scene.actors.length, 1);
    assert.equal(r.result.scene.actors[0].kind, "player");
  });

  it("rejects runtime-compile for a missing level", () => {
    assert.equal(call("runtime-compile", ctxA, { levelId: "nope" }).ok, false);
  });
});

// ── Backlog 2 — asset import pipeline ─────────────────────────────────
describe("game-design asset import pipeline", () => {
  it("imports, lists, updates and deletes assets", () => {
    const gid = newGame();
    const a = call("asset-import", ctxA, {
      gameId: gid, name: "Hero sheet", kind: "sprite",
      src: "https://example.com/hero.png", width: 256, height: 64, tags: ["hero", "hero"],
    }).result.asset;
    assert.equal(a.sourceType, "linked");
    assert.equal(a.tags.length, 1); // deduped
    const list = call("asset-list", ctxA, { gameId: gid }).result;
    assert.equal(list.count, 1);
    assert.equal(list.byKind.sprite, 1);
    call("asset-update", ctxA, { id: a.id, frameW: 32, frameH: 32 });
    assert.equal(call("asset-list", ctxA, { gameId: gid }).result.assets[0].frameW, 32);
    call("asset-delete", ctxA, { id: a.id });
    assert.equal(call("asset-list", ctxA, { gameId: gid }).result.count, 0);
  });

  it("accepts data URLs and rejects a non-URL src", () => {
    const gid = newGame();
    const ok = call("asset-import", ctxA, { gameId: gid, name: "Pixel", src: "data:image/png;base64,AAAA" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.asset.sourceType, "embedded");
    assert.equal(call("asset-import", ctxA, { gameId: gid, name: "Bad", src: "just text" }).ok, false);
  });
});

// ── Backlog 4 — animation timeline ────────────────────────────────────
describe("game-design animation timeline", () => {
  it("creates a clip, adds + reorders + deletes keyframes", () => {
    const gid = newGame();
    const anim = call("animation-create", ctxA, { gameId: gid, name: "Run", fps: 10 }).result.animation;
    assert.equal(anim.fps, 10);
    const f1 = call("animation-frame-add", ctxA, { animationId: anim.id, frameIndex: 0 }).result.frame;
    const f2 = call("animation-frame-add", ctxA, { animationId: anim.id, frameIndex: 1 }).result.frame;
    let list = call("animation-list", ctxA, { gameId: gid }).result.animations[0];
    assert.equal(list.frames.length, 2);
    call("animation-frame-reorder", ctxA, { animationId: anim.id, order: [f2.id, f1.id] });
    list = call("animation-list", ctxA, { gameId: gid }).result.animations[0];
    assert.equal(list.frames[0].id, f2.id);
    call("animation-frame-update", ctxA, { animationId: anim.id, frameId: f1.id, durationMs: 200 });
    list = call("animation-list", ctxA, { gameId: gid }).result.animations[0];
    assert.equal(list.frames.find((f) => f.id === f1.id).durationMs, 200);
    call("animation-frame-delete", ctxA, { animationId: anim.id, frameId: f1.id });
    assert.equal(call("animation-list", ctxA, { gameId: gid }).result.animations[0].frames.length, 1);
    call("animation-delete", ctxA, { id: anim.id });
    assert.equal(call("animation-list", ctxA, { gameId: gid }).result.count, 0);
  });
});

// ── Backlog 5 — visual scripting for entity behavior ──────────────────
describe("game-design visual scripting (behaviors)", () => {
  it("creates a behavior with trigger->action rules", () => {
    const gid = newGame();
    const ent = call("entity-add", ctxA, { gameId: gid, name: "Patrol", kind: "enemy" }).result.entity;
    const bhv = call("behavior-create", ctxA, { gameId: gid, name: "Patrol AI", entityId: ent.id }).result.behavior;
    const listed = call("behavior-list", ctxA, { gameId: gid }).result;
    assert.ok(listed.triggers.includes("on-tick"));
    assert.ok(listed.actions.includes("move"));
    const rule = call("behavior-rule-add", ctxA, {
      behaviorId: bhv.id, trigger: "on-tick", action: "move", params: { value: "left" },
    }).result.rule;
    assert.equal(rule.enabled, true);
    assert.equal(call("behavior-list", ctxA, { gameId: gid }).result.behaviors[0].rules.length, 1);
    call("behavior-rule-update", ctxA, { behaviorId: bhv.id, ruleId: rule.id, enabled: false });
    assert.equal(call("behavior-list", ctxA, { gameId: gid }).result.behaviors[0].rules[0].enabled, false);
    call("behavior-rule-delete", ctxA, { behaviorId: bhv.id, ruleId: rule.id });
    assert.equal(call("behavior-list", ctxA, { gameId: gid }).result.behaviors[0].rules.length, 0);
  });

  it("rejects an unknown trigger or action", () => {
    const gid = newGame();
    const bhv = call("behavior-create", ctxA, { gameId: gid, name: "B" }).result.behavior;
    assert.equal(call("behavior-rule-add", ctxA, { behaviorId: bhv.id, trigger: "bogus", action: "move" }).ok, false);
    assert.equal(call("behavior-rule-add", ctxA, { behaviorId: bhv.id, trigger: "on-tick", action: "bogus" }).ok, false);
  });
});

// ── Backlog 6 — playtest analytics ingestion (balance loop) ───────────
describe("game-design playtest analytics", () => {
  it("records runs and aggregates a difficulty verdict from real data", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 6, rows: 6 }).result.level;
    call("playtest-record", ctxA, { gameId: gid, levelId: lvl.id, outcome: "completed", durationMs: 4000, deaths: 1 });
    call("playtest-record", ctxA, { gameId: gid, levelId: lvl.id, outcome: "died", durationMs: 2000, deaths: 3 });
    assert.equal(call("playtest-list", ctxA, { gameId: gid }).result.count, 2);
    const rep = call("playtest-report", ctxA, { gameId: gid, levelId: lvl.id }).result;
    assert.equal(rep.runs, 2);
    assert.equal(rep.completed, 1);
    assert.equal(rep.completionRate, 50);
    assert.ok(typeof rep.difficultyVerdict === "string");
    call("playtest-clear", ctxA, { gameId: gid, levelId: lvl.id });
    assert.equal(call("playtest-list", ctxA, { gameId: gid }).result.count, 0);
  });

  it("returns a friendly message when no runs exist", () => {
    const gid = newGame();
    assert.equal(call("playtest-report", ctxA, { gameId: gid }).result.runs, 0);
  });
});

// ── Backlog 7 — collaborative real-time level editing ─────────────────
describe("game-design collaborative editing", () => {
  it("opens a session, pushes ops and polls them since a cursor", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 5, rows: 5 }).result.level;
    const open = call("collab-open", ctxA, { levelId: lvl.id }).result;
    assert.equal(open.cursor, 0);
    assert.equal(open.participants.length, 1);
    // a second real user joins
    const joined = call("collab-join", ctxB, { sessionId: open.sessionId }).result;
    assert.equal(joined.participants.length, 2);
    const push = call("collab-push-op", ctxB, { sessionId: open.sessionId, kind: "paint", payload: { note: "block" } });
    assert.equal(push.result.seq, 1);
    const poll = call("collab-poll", ctxA, { sessionId: open.sessionId, since: 0 }).result;
    assert.equal(poll.ops.length, 1);
    assert.equal(poll.ops[0].authorId, "user_b");
    // only the owner can close
    assert.equal(call("collab-close", ctxB, { sessionId: open.sessionId }).ok, false);
    assert.equal(call("collab-close", ctxA, { sessionId: open.sessionId }).ok, true);
  });

  it("blocks pushing ops without joining the session", () => {
    const gid = newGame();
    const lvl = call("level-create", ctxA, { gameId: gid, cols: 4, rows: 4 }).result.level;
    const open = call("collab-open", ctxA, { levelId: lvl.id }).result;
    assert.equal(call("collab-push-op", ctxB, { sessionId: open.sessionId, kind: "note" }).ok, false);
  });
});
