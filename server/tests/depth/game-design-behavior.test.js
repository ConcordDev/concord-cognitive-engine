// tests/depth/game-design-behavior.test.js — REAL behavioral tests for the
// game-design domain (registerLensAction family, invoked via lensRun).
//
// Q63 tranche 4 (GH #850): the 51 game-design macros the macro-depth
// grader carried as important but untested at the Q27 regeneration
// (87800ce54). Every test drives the domain's own actions through the
// depth harness against the per-user STATE.gameDesignLens stores and
// asserts on returned state: CRUD round-trips, exact aggregations
// (dashboard counts, collision clamps, loop net-delta verdicts,
// monetization projections), ordering rules (GDD reorder, frame
// reorder), coercion fallbacks, and the handlers' own validation
// refusals. Seeding uses the domain's create actions; every
// lensRun("game-design", "<macro>", …) call literally names its macro
// so the grader credits it.
//
// lens.run unwrapping (per _harness): a handler's { ok:true, result }
// comes back as-is; a handler refusal { ok:false, error } comes back at
// the top level (r.ok false, r.error set).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

async function seedGame(ctx, title = "Starfall") {
  const r = await lensRun("game-design", "game-create", { params: { title } }, ctx);
  assert.equal(r.ok, true);
  return r.result.game.id;
}
async function seedSection(ctx, gameId, title) {
  const r = await lensRun("game-design", "gdd-add", { params: { gameId, title } }, ctx);
  assert.equal(r.ok, true);
  return r.result.section;
}
async function seedEntity(ctx, gameId, params = {}) {
  const r = await lensRun("game-design", "entity-add", { params: { gameId, name: "Goblin", ...params } }, ctx);
  assert.equal(r.ok, true);
  return r.result.entity;
}
async function seedLevel(ctx, gameId, params = {}) {
  const r = await lensRun("game-design", "level-create", { params: { gameId, cols: 6, rows: 5, ...params } }, ctx);
  assert.equal(r.ok, true);
  return r.result.level;
}

describe("game-design — artifact calc macros", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("q63-gd-calc"); });

  it("mechanicsAnalysis buckets categories, defaults unknown to core, scores depth", async () => {
    const r = await lensRun("game-design", "mechanicsAnalysis", {
      data: {
        mechanics: [
          { name: "Jump", category: "core" },
          { name: "Swordplay", category: "Combat" },
          { name: "Mystery", category: "weird" },
          { name: "Grind", category: "economy", loop: true },
        ],
      },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalMechanics, 4);
    const byCat = Object.fromEntries(r.result.categories.map((c) => [c.category, c.count]));
    assert.equal(byCat.core, 2);
    assert.equal(byCat.combat, 1);
    assert.equal(byCat.economy, 1);
    assert.equal(r.result.depthScore, 77); // 4*8 + 3 non-empty buckets * 15
    assert.equal(r.result.loopCount, 1);
    assert.equal(r.result.emergentPotential, "moderate");
    assert.deepEqual(r.result.pillars.sort(), ["combat", "core", "economy"]);
  });

  it("mechanicsAnalysis with no mechanics returns the guidance message", async () => {
    const r = await lensRun("game-design", "mechanicsAnalysis", { data: {} }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.message, "Add game mechanics to analyze design.");
  });

  it("monetizationModel projects premium revenue at full conversion by default", async () => {
    const r = await lensRun("game-design", "monetizationModel", { data: {} }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.model, "premium");
    assert.equal(r.result.expectedDAU, 10000);
    assert.equal(r.result.conversionRate, "100.0%");
    assert.equal(r.result.projectedMonthlyRevenue, 25000); // 10000 * 1 * 30 / 12
    assert.equal(r.result.projectedAnnualRevenue, 300000);
    assert.deepEqual(r.result.ethicalConsiderations, ["Fair pricing for content"]);
  });

  it("monetizationModel applies the free-to-play LTV and conversion inputs", async () => {
    const r = await lensRun("game-design", "monetizationModel", {
      data: { model: "free-to-play", expectedDAU: 2000, conversionRate: 0.1 },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.revenue, "ongoing");
    assert.equal(r.result.conversionRate, "10.0%");
    assert.equal(r.result.projectedMonthlyRevenue, 83); // round(2000 * 0.1 * 5 / 12)
    assert.equal(r.result.ethicalConsiderations.length, 3);
  });
});

describe("game-design — games, GDD, dashboard", () => {
  let ctx; let gameId; let secA; let secB;
  before(async () => {
    ctx = await depthCtx("q63-gd-games");
    gameId = await seedGame(ctx);
    secA = await seedSection(ctx, gameId, "Overview");
    secB = await seedSection(ctx, gameId, "Systems");
    await lensRun("game-design", "mechanic-add", { params: { gameId, name: "Dash", category: "core" } }, ctx);
    await seedEntity(ctx, gameId);
    await seedLevel(ctx, gameId);
  });

  it("game-list returns only the caller's games", async () => {
    const mine = await lensRun("game-design", "game-list", {}, ctx);
    assert.equal(mine.ok, true);
    assert.equal(mine.result.count, 1);
    const other = await depthCtx("q63-gd-games-other");
    const theirs = await lensRun("game-design", "game-list", {}, other);
    assert.equal(theirs.result.count, 0);
  });

  it("game-get aggregates the project's parts with levels summarized", async () => {
    const r = await lensRun("game-design", "game-get", { params: { id: gameId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.gdd.length, 2);
    assert.equal(r.result.mechanics.length, 1);
    assert.equal(r.result.entities.length, 1);
    assert.equal(r.result.levels.length, 1);
    assert.equal(r.result.levels[0].layerCount, 2);
    const missing = await lensRun("game-design", "game-get", { params: { id: "gam_nope" } }, ctx);
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "game not found");
  });

  it("game-dashboard counts every collection and buckets mechanics by category", async () => {
    const r = await lensRun("game-design", "game-dashboard", { params: { gameId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.title, "Starfall");
    assert.equal(r.result.gddSections, 2);
    assert.equal(r.result.mechanics, 1);
    assert.equal(r.result.entities, 1);
    assert.equal(r.result.levels, 1);
    assert.equal(r.result.mechanicsByCategory.core, 1);
    assert.equal(r.result.mechanicsByCategory.combat, 0);
  });

  it("game-export bundles the whole project and round-trips as JSON", async () => {
    const r = await lensRun("game-design", "game-export", { params: { gameId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.project.game.id, gameId);
    assert.equal(r.result.project.gdd.length, 2);
    const parsed = JSON.parse(r.result.json);
    assert.equal(parsed.game.title, "Starfall");
  });

  it("game-update edits fields, keeps title on blank, clears pitch to null", async () => {
    const r = await lensRun("game-design", "game-update", { params: { id: gameId, title: "  ", genre: "roguelike", pitch: "A tiny epic" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.game.title, "Starfall");
    assert.equal(r.result.game.genre, "roguelike");
    assert.equal(r.result.game.pitch, "A tiny epic");
    const cleared = await lensRun("game-design", "game-update", { params: { id: gameId, pitch: "" } }, ctx);
    assert.equal(cleared.result.game.pitch, null);
  });

  it("gdd-update edits a section and refuses an unknown id", async () => {
    const r = await lensRun("game-design", "gdd-update", { params: { id: secA.id, content: "A game about falling stars." } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.section.content, "A game about falling stars.");
    const missing = await lensRun("game-design", "gdd-update", { params: { id: "gdd_nope", content: "x" } }, ctx);
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "section not found");
  });

  it("gdd-reorder flips section order and refuses a partial order", async () => {
    const bad = await lensRun("game-design", "gdd-reorder", { params: { gameId, order: [secB.id] } }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "order must list every section id exactly once");
    const r = await lensRun("game-design", "gdd-reorder", { params: { gameId, order: [secB.id, secA.id] } }, ctx);
    assert.equal(r.ok, true);
    const got = await lensRun("game-design", "game-get", { params: { id: gameId } }, ctx);
    assert.deepEqual(got.result.gdd.map((s) => s.id), [secB.id, secA.id]);
  });

  it("gdd-delete removes exactly the named section", async () => {
    const temp = await seedSection(ctx, gameId, "Scratch");
    const r = await lensRun("game-design", "gdd-delete", { params: { id: temp.id } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.deleted, temp.id);
    const again = await lensRun("game-design", "gdd-delete", { params: { id: temp.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "section not found");
  });
});

describe("game-design — mechanics and entities", () => {
  let ctx; let gameId; let mechId; let entId;
  before(async () => {
    ctx = await depthCtx("q63-gd-mech-ent");
    gameId = await seedGame(ctx, "Mech Bay");
    const m = await lensRun("game-design", "mechanic-add", { params: { gameId, name: "Wall Run", category: "bogus" } }, ctx);
    mechId = m.result.mechanic.id;
    assert.equal(m.result.mechanic.category, "core"); // invalid category falls back
    const e = await seedEntity(ctx, gameId, { kind: "bogus", health: 10.6, damage: -4 });
    entId = e.id;
    assert.equal(e.kind, "enemy"); // invalid kind falls back
    assert.equal(e.health, 11); // rounded
    assert.equal(e.damage, 0); // clamped at 0
  });

  it("mechanic-update renames and re-buckets, keeping the category on an invalid value", async () => {
    const r = await lensRun("game-design", "mechanic-update", { params: { id: mechId, name: "Wall Run II", category: "combat" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.mechanic.name, "Wall Run II");
    assert.equal(r.result.mechanic.category, "combat");
    const keep = await lensRun("game-design", "mechanic-update", { params: { id: mechId, category: "bogus" } }, ctx);
    assert.equal(keep.result.mechanic.category, "combat");
  });

  it("mechanic-delete removes it and refuses a repeat", async () => {
    const r = await lensRun("game-design", "mechanic-delete", { params: { id: mechId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.deleted, mechId);
    const again = await lensRun("game-design", "mechanic-delete", { params: { id: mechId } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "mechanic not found");
  });

  it("entity-update patches stats with the same rounding and clamping", async () => {
    const r = await lensRun("game-design", "entity-update", { params: { id: entId, speed: 7.5, kind: "boss" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.entity.speed, 8);
    assert.equal(r.result.entity.kind, "boss");
    const missing = await lensRun("game-design", "entity-update", { params: { id: "ent_nope", speed: 1 } }, ctx);
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "entity not found");
  });

  it("entity-field-delete drops a custom field and refuses when none exists", async () => {
    const set = await lensRun("game-design", "entity-field-set", { params: { entityId: entId, key: "level", type: "int", value: "42" } }, ctx);
    assert.equal(set.ok, true);
    assert.deepEqual(set.result.fields, [{ key: "level", type: "int", value: 42 }]);
    const r = await lensRun("game-design", "entity-field-delete", { params: { entityId: entId, key: "level" } }, ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.fields, []);
    const again = await lensRun("game-design", "entity-field-delete", { params: { entityId: entId, key: "level" } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "field not found");
  });

  it("entity-delete removes the entity and refuses a repeat", async () => {
    const r = await lensRun("game-design", "entity-delete", { params: { id: entId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.deleted, entId);
    const again = await lensRun("game-design", "entity-delete", { params: { id: entId } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "entity not found");
  });
});

describe("game-design — levels, collision, tiles", () => {
  let ctx; let gameId; let level;
  before(async () => {
    ctx = await depthCtx("q63-gd-levels");
    gameId = await seedGame(ctx, "Tileworks");
    level = await seedLevel(ctx, gameId);
  });

  it("level-update renames and validates orientation", async () => {
    const r = await lensRun("game-design", "level-update", { params: { id: level.id, name: "Keep", orientation: "diagonal" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.level.name, "Keep");
    assert.equal(r.result.level.orientation, "orthogonal"); // invalid value keeps current
    const iso = await lensRun("game-design", "level-update", { params: { id: level.id, orientation: "isometric" } }, ctx);
    assert.equal(iso.result.level.orientation, "isometric");
  });

  it("level-export emits a Tiled-shaped map whose JSON parses back", async () => {
    const r = await lensRun("game-design", "level-export", { params: { id: level.id } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.map.width, 6);
    assert.equal(r.result.map.height, 5);
    assert.equal(r.result.map.layers.length, 2);
    assert.equal(r.result.map.layers[0].data.length, 30);
    assert.equal(JSON.parse(r.result.json).name, "Keep");
    const missing = await lensRun("game-design", "level-export", { params: { id: "lvl_nope" } }, ctx);
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "level not found");
  });

  it("level-layer-delete refuses to remove the final layer", async () => {
    const first = level.layers[0].id;
    const r = await lensRun("game-design", "level-layer-delete", { params: { levelId: level.id, layerId: first } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.deleted, first);
    const last = await lensRun("game-design", "level-get", { params: { id: level.id } }, ctx);
    const lastId = last.result.level.layers[0].id;
    const refused = await lensRun("game-design", "level-layer-delete", { params: { levelId: level.id, layerId: lastId } }, ctx);
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "a level needs at least one layer");
  });

  it("level-collision-set clamps and dedupes, and level-collision-get reads it back", async () => {
    const before = await lensRun("game-design", "level-collision-get", { params: { levelId: level.id } }, ctx);
    assert.equal(before.ok, true);
    assert.equal(before.result.collision.gravity, 980); // default
    assert.deepEqual(before.result.collision.solidInts, []);
    const set = await lensRun("game-design", "level-collision-set", {
      params: { levelId: level.id, gravity: 5000, solidInts: [0, 1, 1, 2, 150], solidTiles: ["wall", "wall", "lava"] },
    }, ctx);
    assert.equal(set.ok, true);
    assert.equal(set.result.collision.gravity, 4000); // clamped to the 0..4000 band
    assert.deepEqual(set.result.collision.solidInts, [1, 2, 99]); // 0 dropped, dup merged, 150 clamped
    assert.deepEqual(set.result.collision.solidTiles, ["wall", "lava"]);
    const after = await lensRun("game-design", "level-collision-get", { params: { levelId: level.id } }, ctx);
    assert.equal(after.result.collision.gravity, 4000);
  });

  it("level-delete removes the level and refuses a repeat", async () => {
    const temp = await seedLevel(ctx, gameId, { name: "Temp" });
    const r = await lensRun("game-design", "level-delete", { params: { id: temp.id } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.deleted, temp.id);
    const again = await lensRun("game-design", "level-delete", { params: { id: temp.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "level not found");
  });

  it("tile-list merges the built-in palette with the game's custom tiles", async () => {
    const created = await lensRun("game-design", "tile-create", { params: { gameId, name: "Runed Stone" } }, ctx);
    assert.equal(created.ok, true);
    const r = await lensRun("game-design", "tile-list", { params: { gameId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.builtin.length, 17);
    assert.equal(r.result.custom.length, 1);
    assert.equal(r.result.all.length, 18);
    assert.equal(r.result.all[17].name, "Runed Stone");
    const del = await lensRun("game-design", "tile-delete", { params: { id: created.result.tile.id } }, ctx);
    assert.equal(del.ok, true);
    const again = await lensRun("game-design", "tile-delete", { params: { id: created.result.tile.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "tile not found");
  });

  it("autotile-rule-delete removes a rule and refuses a repeat", async () => {
    const add = await lensRun("game-design", "autotile-rule-add", { params: { gameId, intValue: 3, tile: "grass" } }, ctx);
    assert.equal(add.ok, true);
    const r = await lensRun("game-design", "autotile-rule-delete", { params: { id: add.result.rule.id } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.deleted, add.result.rule.id);
    const again = await lensRun("game-design", "autotile-rule-delete", { params: { id: add.result.rule.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "rule not found");
  });
});

describe("game-design — enums and loops", () => {
  let ctx; let gameId;
  before(async () => {
    ctx = await depthCtx("q63-gd-enums-loops");
    gameId = await seedGame(ctx, "Loophouse");
  });

  it("enum-create cleans and dedupes values; enum-delete removes and refuses a repeat", async () => {
    const r = await lensRun("game-design", "enum-create", { params: { gameId, name: "Rarity", values: ["common", "common", " rare ", ""] } }, ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.enum.values, ["common", "rare"]);
    const del = await lensRun("game-design", "enum-delete", { params: { id: r.result.enum.id } }, ctx);
    assert.equal(del.ok, true);
    const again = await lensRun("game-design", "enum-delete", { params: { id: r.result.enum.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "enum not found");
    const noName = await lensRun("game-design", "enum-create", { params: { gameId, name: " " } }, ctx);
    assert.equal(noName.ok, false);
    assert.equal(noName.error, "enum name required");
  });

  it("loop-step-add requires a loop and a label; loop-step-delete removes the step", async () => {
    const loop = await lensRun("game-design", "loop-create", { params: { gameId, name: "Harvest", kind: "economy" } }, ctx);
    const loopId = loop.result.loop.id;
    const noLabel = await lensRun("game-design", "loop-step-add", { params: { loopId, label: " " } }, ctx);
    assert.equal(noLabel.ok, false);
    assert.equal(noLabel.error, "step label required");
    const step = await lensRun("game-design", "loop-step-add", { params: { loopId, label: "Sell crops", delta: 5, resource: "gold" } }, ctx);
    assert.equal(step.ok, true);
    assert.equal(step.result.step.delta, 5);
    const del = await lensRun("game-design", "loop-step-delete", { params: { loopId, stepId: step.result.step.id } }, ctx);
    assert.equal(del.ok, true);
    const again = await lensRun("game-design", "loop-step-delete", { params: { loopId, stepId: step.result.step.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "step not found");
    const delLoop = await lensRun("game-design", "loop-delete", { params: { id: loopId } }, ctx);
    assert.equal(delLoop.ok, true);
    const againLoop = await lensRun("game-design", "loop-delete", { params: { id: loopId } }, ctx);
    assert.equal(againLoop.ok, false);
    assert.equal(againLoop.error, "loop not found");
  });

  it("loop-analysis nets step deltas into balance verdicts", async () => {
    const empty = await lensRun("game-design", "loop-analysis", { params: { gameId } }, ctx);
    assert.equal(empty.ok, true);
    assert.equal(empty.result.message, "Model core loops to analyse balance.");
    const a = await lensRun("game-design", "loop-create", { params: { gameId, name: "Trade", kind: "core" } }, ctx);
    await lensRun("game-design", "loop-step-add", { params: { loopId: a.result.loop.id, label: "Buy", delta: -5 } }, ctx);
    await lensRun("game-design", "loop-step-add", { params: { loopId: a.result.loop.id, label: "Sell", delta: 5 } }, ctx);
    const b = await lensRun("game-design", "loop-create", { params: { gameId, name: "Prestige", kind: "positive" } }, ctx);
    await lensRun("game-design", "loop-step-add", { params: { loopId: b.result.loop.id, label: "Reset cost", delta: -3 } }, ctx);
    const r = await lensRun("game-design", "loop-analysis", { params: { gameId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.totalLoops, 2);
    const byName = Object.fromEntries(r.result.loops.map((l) => [l.name, l]));
    assert.equal(byName.Trade.netDelta, 0);
    assert.equal(byName.Trade.verdict, "balanced");
    assert.equal(byName.Prestige.verdict, "stalling — should net gains");
    assert.equal(r.result.unbalanced, 1);
    assert.equal(r.result.health, "1 loop(s) need rebalancing");
  });
});

describe("game-design — narrative", () => {
  let ctx; let gameId; let nodeA; let nodeB;
  before(async () => {
    ctx = await depthCtx("q63-gd-narrative");
    gameId = await seedGame(ctx, "Branchline");
    const a = await lensRun("game-design", "narrative-node-create", { params: { gameId, title: "Intro", kind: "start" } }, ctx);
    nodeA = a.result.node;
    const b = await lensRun("game-design", "narrative-node-create", { params: { gameId, title: "Fork" } }, ctx);
    nodeB = b.result.node;
  });

  it("narrative-node-update patches title, body and rounded coordinates", async () => {
    const r = await lensRun("game-design", "narrative-node-update", { params: { id: nodeB.id, title: "The Fork", body: "Choose.", x: 3.6, y: -2 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.node.title, "The Fork");
    assert.equal(r.result.node.x, 4);
    assert.equal(r.result.node.y, -2);
    const missing = await lensRun("game-design", "narrative-node-update", { params: { id: "nar_nope", title: "x" } }, ctx);
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "node not found");
  });

  it("narrative-link-delete removes a link and refuses a repeat", async () => {
    const link = await lensRun("game-design", "narrative-link-add", { params: { fromId: nodeA.id, toId: nodeB.id, label: "go" } }, ctx);
    assert.equal(link.ok, true);
    const r = await lensRun("game-design", "narrative-link-delete", { params: { id: link.result.link.id } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.deleted, link.result.link.id);
    const again = await lensRun("game-design", "narrative-link-delete", { params: { id: link.result.link.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "link not found");
  });

  it("narrative-node-delete removes the node and every link touching it", async () => {
    const link = await lensRun("game-design", "narrative-link-add", { params: { fromId: nodeA.id, toId: nodeB.id } }, ctx);
    assert.equal(link.ok, true);
    const r = await lensRun("game-design", "narrative-node-delete", { params: { id: nodeB.id } }, ctx);
    assert.equal(r.ok, true);
    const list = await lensRun("game-design", "narrative-node-list", { params: { gameId } }, ctx);
    assert.equal(list.result.nodes.length, 1);
    assert.equal(list.result.links.length, 0);
    const again = await lensRun("game-design", "narrative-node-delete", { params: { id: nodeB.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "node not found");
  });
});

describe("game-design — assets and animations", () => {
  let ctx; let gameId;
  before(async () => {
    ctx = await depthCtx("q63-gd-assets-anim");
    gameId = await seedGame(ctx, "Spriteyard");
  });

  it("asset-list groups imports by kind after embedded and linked imports", async () => {
    const dataSrc = "data:image/png;base64,iVBORw0KGgo=";
    const a = await lensRun("game-design", "asset-import", { params: { gameId, name: "Hero", src: dataSrc, width: 64.4 } }, ctx);
    assert.equal(a.ok, true);
    assert.equal(a.result.asset.sourceType, "embedded");
    assert.equal(a.result.asset.bytes, dataSrc.length);
    assert.equal(a.result.asset.width, 64);
    const b = await lensRun("game-design", "asset-import", { params: { gameId, name: "Theme", kind: "audio", src: "https://example.com/theme.ogg" } }, ctx);
    assert.equal(b.result.asset.sourceType, "linked");
    assert.equal(b.result.asset.bytes, 0);
    const bad = await lensRun("game-design", "asset-import", { params: { gameId, name: "Bad", src: "ftp://x" } }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "src must be a data URL or http(s) URL");
    const r = await lensRun("game-design", "asset-list", { params: { gameId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.deepEqual(r.result.byKind, { sprite: 1, audio: 1 });
  });

  it("asset-update patches frame geometry; asset-delete removes and refuses a repeat", async () => {
    const a = await lensRun("game-design", "asset-import", { params: { gameId, name: "Sheet", src: "https://example.com/s.png" } }, ctx);
    const id = a.result.asset.id;
    const r = await lensRun("game-design", "asset-update", { params: { id, frameW: 32.6, frameH: 16, kind: "bogus" } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.asset.frameW, 33);
    assert.equal(r.result.asset.kind, "sprite"); // invalid kind keeps current
    const del = await lensRun("game-design", "asset-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    const again = await lensRun("game-design", "asset-delete", { params: { id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "asset not found");
  });

  it("animation-create clamps fps, defaults loop, and refuses an unknown entity", async () => {
    const bad = await lensRun("game-design", "animation-create", { params: { gameId, name: "Walk", entityId: "ent_nope" } }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "entity not found");
    const r = await lensRun("game-design", "animation-create", { params: { gameId, name: "Walk", fps: 120 } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.animation.fps, 60); // clamped to the 1..60 band
    assert.equal(r.result.animation.loop, true);
    assert.deepEqual(r.result.animation.frames, []);
  });

  it("animation frames: add with fps-derived default duration, update, reorder, delete", async () => {
    const anim = await lensRun("game-design", "animation-create", { params: { gameId, name: "Run", fps: 12 } }, ctx);
    const animId = anim.result.animation.id;
    const f1 = await lensRun("game-design", "animation-frame-add", { params: { animationId: animId, frameIndex: 0 } }, ctx);
    assert.equal(f1.ok, true);
    assert.equal(f1.result.frame.durationMs, 83); // round(1000 / 12)
    const f2 = await lensRun("game-design", "animation-frame-add", { params: { animationId: animId, frameIndex: 1, durationMs: 200 } }, ctx);
    assert.equal(f2.result.frames.length, 2);
    const upd = await lensRun("game-design", "animation-frame-update", { params: { animationId: animId, frameId: f1.result.frame.id, durationMs: 5 } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.frame.durationMs, 16); // clamped to the 16..10000 band
    const partial = await lensRun("game-design", "animation-frame-reorder", { params: { animationId: animId, order: [f2.result.frame.id] } }, ctx);
    assert.equal(partial.ok, false);
    assert.equal(partial.error, "order must list every frame id exactly once");
    const re = await lensRun("game-design", "animation-frame-reorder", { params: { animationId: animId, order: [f2.result.frame.id, f1.result.frame.id] } }, ctx);
    assert.equal(re.ok, true);
    const list = await lensRun("game-design", "animation-list", { params: { gameId } }, ctx);
    const mine = list.result.animations.find((a) => a.id === animId);
    assert.deepEqual(mine.frames.map((f) => f.id), [f2.result.frame.id, f1.result.frame.id]);
    const del = await lensRun("game-design", "animation-frame-delete", { params: { animationId: animId, frameId: f2.result.frame.id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.frames.length, 1);
    const again = await lensRun("game-design", "animation-frame-delete", { params: { animationId: animId, frameId: f2.result.frame.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "frame not found");
    const updAnim = await lensRun("game-design", "animation-update", { params: { id: animId, fps: 0, loop: false } }, ctx);
    assert.equal(updAnim.ok, true);
    assert.equal(updAnim.result.animation.fps, 1); // clamped to the band floor
    assert.equal(updAnim.result.animation.loop, false);
    const delAnim = await lensRun("game-design", "animation-delete", { params: { id: animId } }, ctx);
    assert.equal(delAnim.ok, true);
    const againAnim = await lensRun("game-design", "animation-delete", { params: { id: animId } }, ctx);
    assert.equal(againAnim.ok, false);
    assert.equal(againAnim.error, "animation not found");
  });
});

describe("game-design — behaviors, playtests, collab", () => {
  let ctx; let gameId; let level;
  before(async () => {
    ctx = await depthCtx("q63-gd-behavior");
    gameId = await seedGame(ctx, "Eventsheet");
    level = await seedLevel(ctx, gameId);
  });

  it("behavior-list advertises the trigger and action vocabularies", async () => {
    const created = await lensRun("game-design", "behavior-create", { params: { gameId, name: "Patrol" } }, ctx);
    assert.equal(created.ok, true);
    const r = await lensRun("game-design", "behavior-list", { params: { gameId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 1);
    assert.equal(r.result.triggers.length, 8);
    assert.equal(r.result.actions.length, 10);
    assert.ok(r.result.triggers.includes("on-collide"));
  });

  it("behavior rules validate vocabulary, update tolerantly, and delete", async () => {
    const created = await lensRun("game-design", "behavior-create", { params: { gameId, name: "Chaser" } }, ctx);
    const behaviorId = created.result.behavior.id;
    const bad = await lensRun("game-design", "behavior-rule-add", { params: { behaviorId, trigger: "on-whim", action: "move" } }, ctx);
    assert.equal(bad.ok, false);
    assert.equal(bad.error, "unknown trigger");
    const rule = await lensRun("game-design", "behavior-rule-add", { params: { behaviorId, trigger: "on-tick", action: "move", params: { speed: 2 } } }, ctx);
    assert.equal(rule.ok, true);
    const upd = await lensRun("game-design", "behavior-rule-update", { params: { behaviorId, ruleId: rule.result.rule.id, trigger: "bogus", enabled: false } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.rule.trigger, "on-tick"); // invalid trigger ignored
    assert.equal(upd.result.rule.enabled, false);
    const del = await lensRun("game-design", "behavior-rule-delete", { params: { behaviorId, ruleId: rule.result.rule.id } }, ctx);
    assert.equal(del.ok, true);
    assert.deepEqual(del.result.rules, []);
    const again = await lensRun("game-design", "behavior-rule-delete", { params: { behaviorId, ruleId: rule.result.rule.id } }, ctx);
    assert.equal(again.ok, false);
    assert.equal(again.error, "rule not found");
    const rename = await lensRun("game-design", "behavior-update", { params: { id: behaviorId, name: "Chaser II" } }, ctx);
    assert.equal(rename.ok, true);
    assert.equal(rename.result.behavior.name, "Chaser II");
    const delB = await lensRun("game-design", "behavior-delete", { params: { id: behaviorId } }, ctx);
    assert.equal(delB.ok, true);
    const againB = await lensRun("game-design", "behavior-delete", { params: { id: behaviorId } }, ctx);
    assert.equal(againB.ok, false);
    assert.equal(againB.error, "behavior not found");
  });

  it("playtest-clear removes only the scoped runs", async () => {
    const other = await seedLevel(ctx, gameId, { name: "Second" });
    await lensRun("game-design", "playtest-record", { params: { gameId, levelId: level.id, outcome: "completed", durationMs: 90000 } }, ctx);
    await lensRun("game-design", "playtest-record", { params: { gameId, levelId: other.id, outcome: "died" } }, ctx);
    const scoped = await lensRun("game-design", "playtest-clear", { params: { gameId, levelId: level.id } }, ctx);
    assert.equal(scoped.ok, true);
    assert.equal(scoped.result.cleared, 1);
    const rest = await lensRun("game-design", "playtest-clear", { params: { gameId } }, ctx);
    assert.equal(rest.result.cleared, 1);
    const none = await lensRun("game-design", "playtest-clear", { params: { gameId } }, ctx);
    assert.equal(none.result.cleared, 0);
  });

  it("collab-close is owner-only and closes the session", async () => {
    const open = await lensRun("game-design", "collab-open", { params: { levelId: level.id } }, ctx);
    assert.equal(open.ok, true);
    const sessionId = open.result.sessionId;
    const stranger = await depthCtx("q63-gd-collab-stranger");
    const denied = await lensRun("game-design", "collab-close", { params: { sessionId } }, stranger);
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "session not found (only the owner can close)");
    const r = await lensRun("game-design", "collab-close", { params: { sessionId } }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.closed, sessionId);
    const poll = await lensRun("game-design", "collab-poll", { params: { sessionId } }, ctx);
    assert.equal(poll.ok, true);
    assert.equal(poll.result.open, false);
  });
});
