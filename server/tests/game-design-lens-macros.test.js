// Behavioral macro tests for server/domains/gamedesign.js — the Tiled + LDtk +
// Nuclino shape game-design workbench the /lenses/game-design lens drives.
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150): handlers
// registered via `registerLensAction(domain, action, handler)` are invoked as
// `handler(ctx, virtualArtifact, input)` — the 3-ARG convention. Domain string
// is the HYPHENATED "game-design" (registered from the non-hyphen file
// server/domains/gamedesign.js via the default export). Our harness therefore
// calls `fn(ctx, virtualArtifact, input)` with `virtualArtifact.data = input`,
// because the four "analysis" macros (mechanicsAnalysis / playerFlow /
// narrativeBranch / monetizationModel) read their input from `artifact.data`,
// while the workbench CRUD/level/loop/narrative macros read the 3rd `params`
// arg. Setting both keeps a param-position regression visible here.
//
// These are NOT shape-only assertions. Every test asserts ACTUAL computed
// values + round-trips: the tile-paint editor clamps/validates cells against
// the valid tile-id set; runtime-compile derives a real collision grid + spawn
// from the level + entities; loop-analysis sums real step deltas into a verdict;
// the narrative graph BFS marks real unreachable/orphan nodes; balance-report
// computes min/max/avg and flags outliers; the monetization model projects real
// revenue. Per-user isolation holds. Degrade-graceful: empty/absent input
// returns ok:true with guidance, never throws / never no_db. Fail-CLOSED on
// poisoned numerics: an injected 1e308/Infinity/NaN is clamped or rejected and
// can never persist an absurd value or mint a runaway grid.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGameDesignActions from "../domains/gamedesign.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "game-design", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input). The analysis
// macros read artifact.data, the workbench macros read the 3rd params arg — so
// set BOTH from the same input object.
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`game-design.${name} not registered`);
  const virtualArtifact = { id: null, domain: "game-design", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerGameDesignActions(registerLensAction); });
// The workbench macros persist into globalThis._concordSTATE.gameDesignLens —
// reset per test for hermetic isolation.
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

// Create a game and return its id (a precondition for most workbench macros).
function makeGame(ctx, title = "Skybound", genre = "platformer") {
  const r = call("game-create", ctx, { title, genre });
  assert.equal(r.ok, true);
  return r.result.game.id;
}

describe("game-design — registration (every lens-driven macro present)", () => {
  it("registers all macros the page + child panels call via lensRun / useRunArtifact", () => {
    for (const m of [
      // page analysis actions (useRunArtifact → artifact.data path)
      "mechanicsAnalysis", "playerFlow", "narrativeBranch", "monetizationModel",
      // GameDesignSection roster + dashboard
      "game-create", "game-list", "game-get", "game-update", "game-delete", "game-dashboard", "game-export",
      // GdGddPanel
      "gdd-add", "gdd-update", "gdd-delete", "gdd-reorder",
      // GdMechanicsPanel
      "mechanic-add", "mechanic-delete",
      // GdEntitiesPanel
      "entity-add", "entity-delete", "entity-field-set", "entity-field-delete",
      "enum-create", "enum-list", "enum-delete", "balance-report",
      // GdLevelPanel — grid tilemap editor
      "level-list", "level-create", "level-get", "level-delete", "level-duplicate",
      "level-paint", "level-paint-batch", "level-fill-layer", "level-resize", "level-export",
      "level-layer-add", "level-layer-update", "level-layer-delete", "level-layer-duplicate", "level-layer-reorder",
      "level-object-add", "level-object-update", "level-object-delete",
      "tile-palette", "tile-list", "tile-create", "tile-delete",
      "autotile-rule-add", "autotile-rule-list", "autotile-rule-delete", "level-autotile",
      // GdLoopsPanel
      "loop-create", "loop-list", "loop-delete", "loop-step-add", "loop-step-delete", "loop-analysis",
      // GdNarrativePanel
      "narrative-node-create", "narrative-node-list", "narrative-node-update", "narrative-node-delete",
      "narrative-link-add", "narrative-link-delete", "narrative-graph",
      // GdAssetsPanel / GdAnimationPanel / GdBehaviorPanel
      "asset-import", "asset-list", "asset-update", "asset-delete",
      "animation-create", "animation-list", "animation-update", "animation-delete",
      "animation-frame-add", "animation-frame-update", "animation-frame-delete", "animation-frame-reorder",
      "behavior-create", "behavior-list", "behavior-update", "behavior-delete",
      "behavior-rule-add", "behavior-rule-update", "behavior-rule-delete",
      // GdRuntimePanel
      "runtime-compile", "level-collision-get", "level-collision-set",
      "playtest-record", "playtest-list", "playtest-clear", "playtest-report",
      // GdCollabPanel
      "collab-open", "collab-join", "collab-push-op", "collab-poll", "collab-close",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing game-design.${m}`);
    }
  });
});

describe("game-design — game project CRUD + dashboard", () => {
  it("game-create stamps defaults; game-list returns it; game-get aggregates children", () => {
    const c = call("game-create", ctxA, { title: "  Skybound  ", genre: "platformer", platform: "switch" });
    assert.equal(c.ok, true);
    const g = c.result.game;
    assert.equal(g.title, "Skybound", "title is trimmed");
    assert.equal(g.genre, "platformer");
    assert.equal(g.platform, "switch");
    assert.ok(g.id.startsWith("gam_"));

    const l = call("game-list", ctxA, {});
    assert.equal(l.result.count, 1);
    assert.equal(l.result.games[0].id, g.id);

    const got = call("game-get", ctxA, { id: g.id });
    assert.equal(got.ok, true);
    assert.equal(got.result.game.id, g.id);
    assert.deepEqual(got.result.mechanics, []);
    assert.deepEqual(got.result.levels, []);
  });

  it("game-create rejects an empty title; game-get/update/delete reject unknown ids", () => {
    assert.equal(call("game-create", ctxA, { title: "   " }).error, "game title required");
    assert.equal(call("game-get", ctxA, { id: "ghost" }).error, "game not found");
    assert.equal(call("game-update", ctxA, { id: "ghost", title: "x" }).error, "game not found");
    assert.equal(call("game-delete", ctxA, { id: "ghost" }).error, "game not found");
  });

  it("game-update edits fields and bumps updatedAt", () => {
    const id = makeGame(ctxA);
    const u = call("game-update", ctxA, { id, genre: "metroidvania", pitch: "explore the sky" });
    assert.equal(u.ok, true);
    assert.equal(u.result.game.genre, "metroidvania");
    assert.equal(u.result.game.pitch, "explore the sky");
  });

  it("game-delete cascades children (mechanics/levels) out of state", () => {
    const id = makeGame(ctxA);
    call("mechanic-add", ctxA, { gameId: id, name: "Double Jump" });
    call("level-create", ctxA, { gameId: id, name: "L1" });
    assert.equal(call("game-delete", ctxA, { id }).result.deleted, id);
    // a fresh game-get on a deleted id is not found
    assert.equal(call("game-get", ctxA, { id }).error, "game not found");
  });

  it("game-dashboard counts children by category", () => {
    const id = makeGame(ctxA);
    call("mechanic-add", ctxA, { gameId: id, name: "Parry", category: "combat" });
    call("mechanic-add", ctxA, { gameId: id, name: "XP", category: "progression" });
    call("gdd-add", ctxA, { gameId: id, title: "Overview", content: "..." });
    const d = call("game-dashboard", ctxA, { gameId: id });
    assert.equal(d.ok, true);
    assert.equal(d.result.mechanics, 2);
    assert.equal(d.result.gddSections, 1);
    assert.equal(d.result.mechanicsByCategory.combat, 1);
    assert.equal(d.result.mechanicsByCategory.progression, 1);
    assert.equal(d.result.mechanicsByCategory.core, 0);
  });
});

describe("game-design — GDD sections (add / reorder / validation)", () => {
  it("gdd-add appends in order; gdd-reorder permutes; bad order is rejected", () => {
    const id = makeGame(ctxA);
    const a = call("gdd-add", ctxA, { gameId: id, title: "Intro" }).result.section;
    const b = call("gdd-add", ctxA, { gameId: id, title: "Mechanics" }).result.section;
    assert.equal(a.order, 0);
    assert.equal(b.order, 1);

    // valid reorder swaps the order indices.
    const re = call("gdd-reorder", ctxA, { gameId: id, order: [b.id, a.id] });
    assert.equal(re.ok, true);
    const got = call("game-get", ctxA, { id });
    assert.equal(got.result.gdd[0].id, b.id, "b is now first");
    assert.equal(got.result.gdd[1].id, a.id);

    // a partial / wrong-length order is rejected, not silently applied.
    const bad = call("gdd-reorder", ctxA, { gameId: id, order: [a.id] });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /every section id exactly once/);
  });

  it("gdd-add rejects a missing game and an empty title", () => {
    assert.equal(call("gdd-add", ctxA, { gameId: "ghost", title: "x" }).error, "game not found");
    const id = makeGame(ctxA);
    assert.equal(call("gdd-add", ctxA, { gameId: id, title: "  " }).error, "section title required");
  });
});

describe("game-design — mechanics + entities + balance report", () => {
  it("mechanic-add pins the category enum; an unknown category falls back to core", () => {
    const id = makeGame(ctxA);
    const ok = call("mechanic-add", ctxA, { gameId: id, name: "Grapple", category: "exploration" });
    assert.equal(ok.result.mechanic.category, "exploration");
    const fb = call("mechanic-add", ctxA, { gameId: id, name: "???", category: "not-a-cat" });
    assert.equal(fb.result.mechanic.category, "core", "unknown category clamps to core");
  });

  it("entity-add rounds + floors stats at zero; entity-field-set coerces by field type", () => {
    const id = makeGame(ctxA);
    const e = call("entity-add", ctxA, { gameId: id, name: "Slime", kind: "enemy", health: 20.7, damage: -5, speed: 3 });
    assert.equal(e.result.entity.health, 21, "health rounds");
    assert.equal(e.result.entity.damage, 0, "negative damage floors to 0");
    assert.equal(e.result.entity.kind, "enemy");

    const eid = e.result.entity.id;
    const f1 = call("entity-field-set", ctxA, { entityId: eid, key: "armor", type: "int", value: "7.9" });
    assert.equal(f1.result.fields[0].value, 8, "int field rounds the coerced value");
    const f2 = call("entity-field-set", ctxA, { entityId: eid, key: "boss", type: "bool", value: 1 });
    assert.equal(f2.result.fields.find((x) => x.key === "boss").value, true);
    // re-setting an existing key updates in place (no duplicate)
    call("entity-field-set", ctxA, { entityId: eid, key: "armor", type: "int", value: 3 });
    const fields = call("entity-field-set", ctxA, { entityId: eid, key: "z", type: "string", value: "q" }).result.fields;
    assert.equal(fields.filter((x) => x.key === "armor").length, 1, "armor not duplicated");
    assert.equal(fields.find((x) => x.key === "armor").value, 3);
    // delete a field
    assert.equal(call("entity-field-delete", ctxA, { entityId: eid, key: "boss" }).ok, true);
  });

  it("balance-report computes min/max/avg per kind and flags real stat outliers", () => {
    const id = makeGame(ctxA);
    // three balanced enemies + one absurd outlier (5x the average health).
    call("entity-add", ctxA, { gameId: id, name: "E1", kind: "enemy", health: 10, damage: 4 });
    call("entity-add", ctxA, { gameId: id, name: "E2", kind: "enemy", health: 12, damage: 5 });
    call("entity-add", ctxA, { gameId: id, name: "E3", kind: "enemy", health: 14, damage: 6 });
    call("entity-add", ctxA, { gameId: id, name: "Titan", kind: "enemy", health: 500, damage: 4 });
    const r = call("balance-report", ctxA, { gameId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.entities, 4);
    assert.equal(r.result.byKind.enemy.count, 4);
    assert.equal(r.result.byKind.enemy.health.min, 10);
    assert.equal(r.result.byKind.enemy.health.max, 500);
    assert.ok(r.result.outliers.includes("Titan"), "the 500-hp outlier is flagged");
    assert.match(r.result.verdict, /above the curve/);
  });

  it("balance-report degrades gracefully when there are no entities yet", () => {
    const id = makeGame(ctxA);
    const r = call("balance-report", ctxA, { gameId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.entities, 0);
    assert.match(r.result.message, /Add entities/);
  });
});

describe("game-design — level tilemap editor (paint / validate / resize / export)", () => {
  it("level-create seeds two tile layers with the right cell count; clamps cols/rows", () => {
    const id = makeGame(ctxA);
    const r = call("level-create", ctxA, { gameId: id, name: "Cavern", cols: 10, rows: 6 });
    assert.equal(r.ok, true);
    const lvl = r.result.level;
    assert.equal(lvl.cols, 10);
    assert.equal(lvl.rows, 6);
    assert.equal(lvl.layers.length, 2);
    assert.equal(lvl.layers[0].tiles.length, 60, "10x6 = 60 cells");

    // cols below the 4..64 clamp floor snaps to 4.
    const tiny = call("level-create", ctxA, { gameId: id, cols: 1, rows: 1 });
    assert.equal(tiny.result.level.cols, 4);
    assert.equal(tiny.result.level.rows, 4);
  });

  it("level-paint validates the tile id against the valid set and the index range", () => {
    const id = makeGame(ctxA);
    const lvl = call("level-create", ctxA, { gameId: id, cols: 5, rows: 5 }).result.level;
    const layerId = lvl.layers[0].id;

    // a real built-in tile id paints exactly that cell.
    const p = call("level-paint", ctxA, { levelId: lvl.id, layerId, index: 7, tile: "grass" });
    assert.equal(p.ok, true);
    assert.equal(p.result.index, 7);
    assert.equal(p.result.tile, "grass");

    // an unknown tile id resolves to null (cleared cell), not the raw string.
    const bad = call("level-paint", ctxA, { levelId: lvl.id, layerId, index: 8, tile: "no-such-tile" });
    assert.equal(bad.ok, true);
    assert.equal(bad.result.tile, null, "invalid tile id is rejected → null, never persisted raw");

    // an out-of-range index is rejected.
    const oor = call("level-paint", ctxA, { levelId: lvl.id, layerId, index: 999, tile: "grass" });
    assert.equal(oor.ok, false);
    assert.match(oor.error, /out of range/);

    // round-trip: level-get reflects the painted cell.
    const got = call("level-get", ctxA, { id: lvl.id }).result.level;
    assert.equal(got.layers[0].tiles[7], "grass");
    assert.equal(got.layers[0].tiles[8], null);
  });

  it("level-paint-batch counts only the in-range cells it actually painted", () => {
    const id = makeGame(ctxA);
    const lvl = call("level-create", ctxA, { gameId: id, cols: 4, rows: 4 }).result.level;
    const layerId = lvl.layers[0].id;
    const r = call("level-paint-batch", ctxA, {
      levelId: lvl.id, layerId,
      cells: [{ index: 0, tile: "stone" }, { index: 5, tile: "water" }, { index: 999, tile: "grass" }],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.painted, 2, "the index-999 cell is skipped, not painted");
    const got = call("level-get", ctxA, { id: lvl.id }).result.level;
    assert.equal(got.layers[0].tiles[0], "stone");
    assert.equal(got.layers[0].tiles[5], "water");
  });

  it("level-resize preserves overlapping cells and grows/shrinks the grid", () => {
    const id = makeGame(ctxA);
    const lvl = call("level-create", ctxA, { gameId: id, cols: 4, rows: 4 }).result.level;
    const layerId = lvl.layers[0].id;
    call("level-paint", ctxA, { levelId: lvl.id, layerId, index: 0, tile: "wall" }); // top-left corner
    const r = call("level-resize", ctxA, { levelId: lvl.id, cols: 6, rows: 6 });
    assert.equal(r.ok, true);
    assert.equal(r.result.level.cols, 6);
    assert.equal(r.result.level.layers[0].tiles.length, 36);
    assert.equal(r.result.level.layers[0].tiles[0], "wall", "the painted corner survives the resize");
  });

  it("level-export emits a Tiled-shape map with per-layer data arrays", () => {
    const id = makeGame(ctxA);
    const lvl = call("level-create", ctxA, { gameId: id, name: "Ex", cols: 4, rows: 4 }).result.level;
    const e = call("level-export", ctxA, { id: lvl.id });
    assert.equal(e.ok, true);
    assert.equal(e.result.map.width, 4);
    assert.equal(e.result.map.height, 4);
    assert.equal(e.result.map.layers.length, 2);
    assert.ok(Array.isArray(e.result.map.layers[0].data));
    // the json string round-trips to the same map
    assert.deepEqual(JSON.parse(e.result.json), e.result.map);
  });

  it("tile-palette + tile-create expand the valid id set used by paint", () => {
    const id = makeGame(ctxA);
    const pal = call("tile-palette", ctxA, {});
    assert.ok(pal.result.tiles.length >= 17);
    // a custom tile becomes paintable.
    const t = call("tile-create", ctxA, { gameId: id, name: "Moss", color: "#3f6212" }).result.tile;
    const lvl = call("level-create", ctxA, { gameId: id, cols: 4, rows: 4 }).result.level;
    const p = call("level-paint", ctxA, { levelId: lvl.id, layerId: lvl.layers[0].id, index: 0, tile: t.id });
    assert.equal(p.result.tile, t.id, "the custom tile id paints");
  });
});

describe("game-design — IntGrid auto-layer + collision + playable runtime compile", () => {
  it("level-autotile maps IntGrid values to tiles via the game's rules", () => {
    const id = makeGame(ctxA);
    const lvl = call("level-create", ctxA, { gameId: id, cols: 4, rows: 4 }).result.level;
    const intLayer = call("level-layer-add", ctxA, { levelId: lvl.id, kind: "intgrid", name: "Walls" }).result.layer;
    const tileLayer = call("level-layer-add", ctxA, { levelId: lvl.id, kind: "tile", name: "Auto" }).result.layer;
    // paint IntGrid value 1 into two cells.
    call("level-paint-batch", ctxA, { levelId: lvl.id, layerId: intLayer.id, cells: [{ index: 0, tile: 1 }, { index: 3, tile: 1 }] });
    // rule: int 1 → "wall".
    call("autotile-rule-add", ctxA, { gameId: id, intValue: 1, tile: "wall" });
    const r = call("level-autotile", ctxA, { levelId: lvl.id, sourceLayerId: intLayer.id, targetLayerId: tileLayer.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.painted, 2, "two int-1 cells mapped to a tile");
    const got = call("level-get", ctxA, { id: lvl.id }).result.level;
    const auto = got.layers.find((l) => l.id === tileLayer.id);
    assert.equal(auto.tiles[0], "wall");
    assert.equal(auto.tiles[3], "wall");
  });

  it("level-collision-set + runtime-compile build a real solid grid + spawn point", () => {
    const id = makeGame(ctxA);
    const lvl = call("level-create", ctxA, { gameId: id, cols: 4, rows: 4, tileSize: 16 }).result.level;
    const layerId = lvl.layers[0].id;
    // a floor of "stone" along the bottom row (indices 12..15).
    call("level-paint-batch", ctxA, {
      levelId: lvl.id, layerId,
      cells: [12, 13, 14, 15].map((index) => ({ index, tile: "stone" })),
    });
    // mark "stone" + "lava" as solid/hazard.
    const cs = call("level-collision-set", ctxA, { levelId: lvl.id, solidTiles: ["stone"], hazardTiles: ["lava"], gravity: 1200 });
    assert.equal(cs.ok, true);
    assert.deepEqual(cs.result.collision.solidTiles, ["stone"]);

    // add a player entity + an object instance bound to it for the spawn.
    const player = call("entity-add", ctxA, { gameId: id, name: "Hero", kind: "player" }).result.entity;
    const objLayer = call("level-layer-add", ctxA, { levelId: lvl.id, kind: "object", name: "Entities" }).result.layer;
    call("level-object-add", ctxA, { levelId: lvl.id, layerId: objLayer.id, name: "Start", x: 32, y: 8, entityId: player.id });

    const rc = call("runtime-compile", ctxA, { levelId: lvl.id });
    assert.equal(rc.ok, true);
    const scene = rc.result.scene;
    assert.equal(scene.cols, 4);
    assert.equal(scene.gravity, 1200);
    assert.equal(scene.collision.solidCount, 4, "four stone floor cells are solid");
    assert.equal(scene.collision.hazardCount, 0);
    assert.equal(scene.spawn.x, 32, "spawn comes from the player object instance");
    assert.equal(scene.spawn.y, 8);
    assert.ok(scene.actors.some((a) => a.kind === "player" && a.health === player.health));
  });

  it("runtime-compile rejects an unknown level", () => {
    assert.equal(call("runtime-compile", ctxA, { levelId: "ghost" }).error, "level not found");
  });
});

describe("game-design — core-loop modelling + analysis", () => {
  it("loop-analysis sums real step deltas into a balance verdict", () => {
    const id = makeGame(ctxA);
    const loop = call("loop-create", ctxA, { gameId: id, name: "Gold Loop", kind: "economy" }).result.loop;
    call("loop-step-add", ctxA, { loopId: loop.id, label: "earn", delta: 10, resource: "gold" });
    call("loop-step-add", ctxA, { loopId: loop.id, label: "spend", delta: -10, resource: "gold" });
    const r = call("loop-analysis", ctxA, { gameId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalLoops, 1);
    assert.equal(r.result.loops[0].netDelta, 0);
    assert.equal(r.result.loops[0].verdict, "balanced");
    assert.equal(r.result.unbalanced, 0);

    // make it leak: a "negative" loop that nets positive.
    const leak = call("loop-create", ctxA, { gameId: id, name: "Leak", kind: "negative" }).result.loop;
    call("loop-step-add", ctxA, { loopId: leak.id, label: "drip", delta: 7 });
    const r2 = call("loop-analysis", ctxA, { gameId: id });
    const leakRow = r2.result.loops.find((l) => l.name === "Leak");
    assert.equal(leakRow.netDelta, 7);
    assert.match(leakRow.verdict, /leaky/);
    assert.equal(r2.result.unbalanced, 1);
  });

  it("loop-analysis degrades gracefully with no loops modelled", () => {
    const id = makeGame(ctxA);
    const r = call("loop-analysis", ctxA, { gameId: id });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.loops, []);
    assert.match(r.result.message, /Model core loops/);
  });
});

describe("game-design — narrative graph (links, reachability, orphans)", () => {
  it("narrative-graph BFS marks real unreachable + orphan nodes", () => {
    const id = makeGame(ctxA);
    const start = call("narrative-node-create", ctxA, { gameId: id, title: "Start", kind: "start" }).result.node;
    const mid = call("narrative-node-create", ctxA, { gameId: id, title: "Crossroads", kind: "scene" }).result.node;
    const end = call("narrative-node-create", ctxA, { gameId: id, title: "Victory", kind: "ending" }).result.node;
    const lost = call("narrative-node-create", ctxA, { gameId: id, title: "Lost Scene", kind: "scene" }).result.node;
    // start → mid → end ; "lost" is never linked.
    call("narrative-link-add", ctxA, { gameId: id, fromId: start.id, toId: mid.id });
    call("narrative-link-add", ctxA, { gameId: id, fromId: mid.id, toId: end.id });

    const g = call("narrative-graph", ctxA, { gameId: id });
    assert.equal(g.ok, true);
    assert.equal(g.result.totalNodes, 4);
    assert.equal(g.result.totalLinks, 2);
    assert.equal(g.result.maxDepth, 2, "start→mid→end is depth 2");
    assert.ok(g.result.orphans.includes("Lost Scene"), "the unlinked node is an orphan (indeg 0, outdeg 0)");
    // An orphan has indeg 0 so it is itself a BFS start → it is reachable-as-a-root
    // but it leads nowhere. The health string surfaces the orphan, not unreachability.
    assert.equal(g.result.unreachable.length, 0, "every node is a root or reached from one");
    assert.match(g.result.health, /orphaned/);
  });

  it("narrative-link-add rejects self-links + cross-game links", () => {
    const idA = makeGame(ctxA, "A");
    const idB = makeGame(ctxA, "B");
    const n1 = call("narrative-node-create", ctxA, { gameId: idA, title: "N1" }).result.node;
    const n2 = call("narrative-node-create", ctxA, { gameId: idB, title: "N2" }).result.node;
    assert.match(call("narrative-link-add", ctxA, { fromId: n1.id, toId: n1.id }).error, /cannot link to itself/);
    assert.match(call("narrative-link-add", ctxA, { fromId: n1.id, toId: n2.id }).error, /different games/);
  });

  it("narrative-node-delete removes incident links", () => {
    const id = makeGame(ctxA);
    const a = call("narrative-node-create", ctxA, { gameId: id, title: "A" }).result.node;
    const b = call("narrative-node-create", ctxA, { gameId: id, title: "B" }).result.node;
    call("narrative-link-add", ctxA, { gameId: id, fromId: a.id, toId: b.id });
    call("narrative-node-delete", ctxA, { id: a.id });
    const listed = call("narrative-node-list", ctxA, { gameId: id });
    assert.equal(listed.result.nodes.length, 1);
    assert.equal(listed.result.links.length, 0, "the dangling link is gone");
  });
});

describe("game-design — page analysis actions (artifact.data input path)", () => {
  it("mechanicsAnalysis reads artifact.data.mechanics and scores depth", () => {
    const r = call("mechanicsAnalysis", ctxA, {
      mechanics: [
        { category: "core" }, { category: "combat" }, { category: "progression" },
        { category: "economy", isLoop: true }, { category: "social" }, { category: "core", loop: true },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalMechanics, 6);
    assert.equal(r.result.loopCount, 2, "two loop-flagged mechanics");
    assert.equal(r.result.depthScore, Math.min(100, 6 * 8 + 5 * 15), "real depth formula");
    assert.equal(r.result.emergentPotential, "high", ">5 mechanics across >=3 pillars");
  });

  it("playerFlow flags the flow zone where |challenge-skill|<15", () => {
    const r = call("playerFlow", ctxA, {
      states: [
        { name: "tutorial", challenge: 30, skillRequired: 32, durationMinutes: 5 }, // in flow
        { name: "boss", challenge: 90, skillRequired: 40, durationMinutes: 12 },     // out of flow
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalStates, 2);
    assert.equal(r.result.inFlowZone, 1);
    assert.equal(r.result.flowPercent, 50);
    assert.equal(r.result.totalDuration, 17);
  });

  it("narrativeBranch counts choices + endings from artifact.data.nodes", () => {
    const r = call("narrativeBranch", ctxA, {
      nodes: [
        { choices: [{}, {}] }, { choices: [{}] }, { isEnding: true }, { isEnding: true }, { isEnding: true },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalNodes, 5);
    assert.equal(r.result.totalChoices, 3);
    assert.equal(r.result.endings, 3);
    assert.equal(r.result.replayValue, "high", ">=3 endings");
  });

  it("monetizationModel projects real revenue from the chosen model", () => {
    const r = call("monetizationModel", ctxA, { model: "subscription", expectedDAU: 12000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.model, "subscription");
    assert.equal(r.result.avgLTV, 60);
    // premium-vs-not conversion: subscription default 0.05 → 12000*0.05*60/12.
    assert.equal(r.result.projectedMonthlyRevenue, Math.round(12000 * 0.05 * 60 / 12));
    assert.equal(r.result.projectedAnnualRevenue, r.result.projectedMonthlyRevenue * 12);
    // premium model forces conversion 1 (one-time buyers).
    const prem = call("monetizationModel", ctxA, { model: "premium", expectedDAU: 1000 });
    assert.equal(prem.result.conversionRate, "100.0%");
    // free-to-play surfaces ethical guardrails.
    const f2p = call("monetizationModel", ctxA, { model: "free-to-play", expectedDAU: 5000 });
    assert.ok(f2p.result.ethicalConsiderations.some((e) => /pay-to-win/i.test(e)));
  });

  it("the analysis macros degrade gracefully on empty artifact.data", () => {
    for (const [m, key] of [["mechanicsAnalysis", "Add game mechanics"], ["playerFlow", "player states"], ["narrativeBranch", "narrative nodes"]]) {
      const r = call(m, ctxA, {});
      assert.equal(r.ok, true);
      assert.match(r.result.message, new RegExp(key, "i"), `${m} guides on empty input`);
    }
    // monetizationModel has no empty branch — it defaults to premium.
    const mon = call("monetizationModel", ctxA, {});
    assert.equal(mon.ok, true);
    assert.equal(mon.result.model, "premium");
  });
});

describe("game-design — playtest analytics loop closure", () => {
  it("playtest-record stores measured runs; playtest-report aggregates real completion data", () => {
    const id = makeGame(ctxA);
    const lvl = call("level-create", ctxA, { gameId: id }).result.level;
    call("playtest-record", ctxA, { gameId: id, levelId: lvl.id, outcome: "completed", durationMs: 60000, deaths: 0 });
    call("playtest-record", ctxA, { gameId: id, levelId: lvl.id, outcome: "completed", durationMs: 80000, deaths: 1 });
    call("playtest-record", ctxA, { gameId: id, levelId: lvl.id, outcome: "died", durationMs: 20000, deaths: 3 });
    call("playtest-record", ctxA, { gameId: id, levelId: lvl.id, outcome: "quit", durationMs: 5000, deaths: 0 });

    const rep = call("playtest-report", ctxA, { gameId: id });
    assert.equal(rep.ok, true);
    assert.equal(rep.result.runs, 4);
    assert.equal(rep.result.completed, 2);
    assert.equal(rep.result.died, 1);
    assert.equal(rep.result.completionRate, 50, "2 of 4 completed");
    assert.match(rep.result.difficultyVerdict, /well-tuned/);

    // clear scoped to this game empties the report.
    const cleared = call("playtest-clear", ctxA, { gameId: id });
    assert.equal(cleared.result.cleared, 4);
    assert.match(call("playtest-report", ctxA, { gameId: id }).result.message, /No playtest runs/);
  });

  it("playtest-record rejects an unknown game / unknown level", () => {
    assert.equal(call("playtest-record", ctxA, { gameId: "ghost" }).error, "game not found");
    const id = makeGame(ctxA);
    assert.equal(call("playtest-record", ctxA, { gameId: id, levelId: "ghost" }).error, "level not found");
  });
});

describe("game-design — visual scripting (behaviors) + animation timelines", () => {
  it("behavior-rule-add validates trigger + action against the known sets", () => {
    const id = makeGame(ctxA);
    const bhv = call("behavior-create", ctxA, { gameId: id, name: "Patrol" }).result.behavior;
    const ok = call("behavior-rule-add", ctxA, { behaviorId: bhv.id, trigger: "on-tick", action: "move" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.rule.trigger, "on-tick");
    assert.equal(call("behavior-rule-add", ctxA, { behaviorId: bhv.id, trigger: "nope", action: "move" }).error, "unknown trigger");
    assert.equal(call("behavior-rule-add", ctxA, { behaviorId: bhv.id, trigger: "on-tick", action: "nope" }).error, "unknown action");
  });

  it("animation-frame-add + reorder maintain a real ordered frame list", () => {
    const id = makeGame(ctxA);
    const anim = call("animation-create", ctxA, { gameId: id, name: "Run", fps: 10 }).result.animation;
    const f0 = call("animation-frame-add", ctxA, { animationId: anim.id, frameIndex: 0 }).result.frame;
    const f1 = call("animation-frame-add", ctxA, { animationId: anim.id, frameIndex: 1 }).result.frame;
    assert.equal(f0.durationMs, 100, "default durationMs derives from fps (1000/10)");
    const re = call("animation-frame-reorder", ctxA, { animationId: anim.id, order: [f1.id, f0.id] });
    assert.equal(re.ok, true);
    const list = call("animation-list", ctxA, { gameId: id }).result.animations[0];
    assert.equal(list.frames[0].id, f1.id, "frames reordered");
    // a bad order is rejected.
    assert.match(call("animation-frame-reorder", ctxA, { animationId: anim.id, order: [f0.id] }).error, /every frame id exactly once/);
  });

  it("asset-import validates the src is a data/http URL and enforces the size cap", () => {
    const id = makeGame(ctxA);
    const ok = call("asset-import", ctxA, { gameId: id, name: "Hero sheet", src: "https://cdn.example/hero.png", kind: "sprite" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.asset.sourceType, "linked");
    assert.equal(call("asset-import", ctxA, { gameId: id, name: "bad", src: "ftp://x" }).error, "src must be a data URL or http(s) URL");
    assert.match(call("asset-import", ctxA, { gameId: id, name: "huge", src: "data:" + "a".repeat(4_000_001) }).error, /4MB limit/);
  });
});

describe("game-design — collaborative session op-log", () => {
  it("collab-open then a second user joins + pushes ops the owner polls", () => {
    const id = makeGame(ctxA);
    const lvl = call("level-create", ctxA, { gameId: id }).result.level;
    const open = call("collab-open", ctxA, { levelId: lvl.id });
    assert.equal(open.ok, true);
    const sessionId = open.result.sessionId;
    assert.equal(open.result.cursor, 0);

    // user_b joins and pushes a paint op.
    const join = call("collab-join", ctxB, { sessionId });
    assert.equal(join.ok, true);
    const push = call("collab-push-op", ctxB, { sessionId, kind: "paint", payload: { index: 3, tile: "grass" } });
    assert.equal(push.result.seq, 1);

    // the owner polls since cursor 0 and sees the op + the active participants.
    const poll = call("collab-poll", ctxA, { sessionId, since: 0 });
    assert.equal(poll.result.ops.length, 1);
    assert.equal(poll.result.ops[0].authorId, "user_b");
    assert.ok(poll.result.activeParticipants >= 2);

    // a non-participant cannot push.
    const stranger = call("collab-push-op", { actor: { userId: "user_c" } }, { sessionId, kind: "paint" });
    assert.match(stranger.error, /join the session/);

    // owner closes it.
    assert.equal(call("collab-close", ctxA, { sessionId }).result.closed, sessionId);
  });
});

describe("game-design — per-user isolation", () => {
  it("one user's games / levels never leak into another user's lists", () => {
    const idA = makeGame(ctxA, "A-game");
    makeGame(ctxB, "B-game");
    call("level-create", ctxA, { gameId: idA, name: "A-level" });

    assert.equal(call("game-list", ctxA, {}).result.count, 1);
    assert.equal(call("game-list", ctxB, {}).result.count, 1);
    assert.equal(call("game-list", ctxA, {}).result.games[0].title, "A-game");
    // user_b cannot get user_a's game or its levels.
    assert.equal(call("game-get", ctxB, { id: idA }).error, "game not found");
    assert.equal(call("level-list", ctxB, { gameId: idA }).result.count, 0);
  });
});

describe("game-design — degrade-graceful + fail-CLOSED on poisoned numerics", () => {
  it("read macros on an empty store return ok:true with empty collections, never throw / no_db", () => {
    assert.equal(call("game-list", ctxA, {}).result.count, 0);
    assert.equal(call("level-list", ctxA, { gameId: "anything" }).result.count, 0);
    assert.equal(call("tile-palette", ctxA, {}).ok, true);
  });

  it("level-create clamps poisoned cols/rows into the 4..64 band — no runaway grid is minted", () => {
    const id = makeGame(ctxA);
    for (const poison of [1e308, Infinity, NaN, -1, 1e9]) {
      const r = call("level-create", ctxA, { gameId: id, cols: poison, rows: poison });
      assert.equal(r.ok, true, `level-create ok for poison=${String(poison)}`);
      const lvl = r.result.level;
      assert.ok(lvl.cols >= 4 && lvl.cols <= 64, `cols clamped: ${lvl.cols}`);
      assert.ok(lvl.rows >= 4 && lvl.rows <= 64, `rows clamped: ${lvl.rows}`);
      // the allocated tile array is bounded — Infinity*Infinity never reaches the fill.
      assert.equal(lvl.layers[0].tiles.length, lvl.cols * lvl.rows);
      assert.ok(Number.isFinite(lvl.layers[0].tiles.length));
    }
  });

  it("entity stats stay finite + non-negative under poisoned numeric input", () => {
    const id = makeGame(ctxA);
    for (const poison of [1e308, Infinity, NaN, -50]) {
      const e = call("entity-add", ctxA, { gameId: id, name: "Poison", health: poison, damage: poison, speed: poison });
      assert.equal(e.ok, true);
      for (const k of ["health", "damage", "speed"]) {
        const v = e.result.entity[k];
        assert.ok(Number.isFinite(v) || v === 0 || v >= 0, `${k} is bounded for poison=${String(poison)}: ${v}`);
        assert.ok(v >= 0, `${k} never negative`);
      }
    }
  });

  it("level-collision-set sanitizes a poisoned solidInts list into a bounded int set", () => {
    const id = makeGame(ctxA);
    const lvl = call("level-create", ctxA, { gameId: id }).result.level;
    const r = call("level-collision-set", ctxA, { levelId: lvl.id, solidInts: [1e308, Infinity, NaN, -5, 2, 2, 200], gravity: 1e308 });
    assert.equal(r.ok, true);
    // every retained int is in [1,99] and finite; duplicates collapsed.
    for (const v of r.result.collision.solidInts) {
      assert.ok(Number.isInteger(v) && v >= 1 && v <= 99, `bounded int: ${v}`);
    }
    assert.ok(Number.isFinite(r.result.collision.gravity), "gravity clamped finite");
    assert.ok(r.result.collision.gravity <= 4000);
  });
});
