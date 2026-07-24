// V1.2 Wave D — read-only simulation-observability aggregation backend.
//
// Proves server/domains/world-overview.js's worldstate.world_detail /
// worldstate.overview macros return REAL numbers matching what the
// underlying real getters independently report for a seeded world — exact
// value-equality against the source tables, not just "doesn't crash" — and
// an honest empty response for a world with no faction/realm/district data.
//
// Uses a real, fully-migrated in-memory better-sqlite3 db (same pattern as
// tests/career-cycle.test.js) so every table this domain queries
// (world_npcs, faction_strategy_state, faction_relations, realms,
// realm_citizens, districts, world_buildings, worlds) is the real schema,
// not a hand-rolled stand-in.
//
// Run: node --test server/tests/world-overview-domain.test.js

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerWorldOverviewMacros from "../domains/world-overview.js";
import { updateUserPosition, removeUser, getWorldUserCount } from "../lib/city-presence.js";
import { polygonArea } from "../lib/districts.js";
import { getRelation } from "../lib/embodied/faction-strategy.js";
import { kingdomLoyaltySummary } from "../lib/kingdoms.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`${name} not registered`);
  return fn(ctx, input);
}

before(() => {
  registerWorldOverviewMacros(register);
});

const WORLD = "test_world_overview_1";
const EMPTY_WORLD = "test_world_overview_empty";
const STUCK_SCHEDULER_GRACE_S = 86400; // must match server/lib/world-health.js default

describe("worldstate — world_detail / overview (real aggregation, no mutation)", () => {
  let db;

  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
  });

  afterEach(() => {
    removeUser("owv_u1");
    removeUser("owv_u2");
    try { db.close(); } catch { /* noop */ }
  });

  function seedWorld() {
    db.prepare(`INSERT INTO worlds (id, name, universe_type) VALUES (?, ?, 'fantasy')`)
      .run(WORLD, "Test Overview World");

    // Two factions with living NPCs in this world.
    db.prepare(`INSERT INTO world_npcs (id, world_id, faction) VALUES (?, ?, ?)`)
      .run("npc_f1_a", WORLD, "faction_alpha");
    db.prepare(`INSERT INTO world_npcs (id, world_id, faction) VALUES (?, ?, ?)`)
      .run("npc_f2_a", WORLD, "faction_beta");

    // Faction strategy state — faction_alpha's scheduler is long overdue
    // (stuck); faction_beta's is not.
    const now = Math.floor(Date.now() / 1000);
    const overdue = now - (STUCK_SCHEDULER_GRACE_S + 3600); // >24h overdue
    db.prepare(`
      INSERT INTO faction_strategy_state (faction_id, stance, momentum, next_move_at)
      VALUES (?, ?, ?, ?)
    `).run("faction_alpha", "war", 0.42, overdue);
    db.prepare(`
      INSERT INTO faction_strategy_state (faction_id, stance, momentum, next_move_at)
      VALUES (?, ?, ?, ?)
    `).run("faction_beta", "consolidate", -0.1, now + 1000);

    db.prepare(`
      INSERT INTO faction_relations (faction_a, faction_b, score, kind)
      VALUES (?, ?, ?, ?)
    `).run("faction_alpha", "faction_beta", -0.65, "war");

    // Realm tied to faction_alpha, with two citizens of known loyalty.
    db.prepare(`
      INSERT INTO realms (id, name, world_id, faction_id, ruler_kind, ruler_id, legitimacy, treasury, tax_rate)
      VALUES ('realm_1', 'Test Realm', ?, 'faction_alpha', 'npc', 'npc_f1_a', 72, 5000, 0.15)
    `).run(WORLD);
    db.prepare(`INSERT INTO realm_citizens (npc_id, kingdom_id, loyalty) VALUES ('npc_f1_a', 'realm_1', 80)`).run();
    db.prepare(`INSERT INTO realm_citizens (npc_id, kingdom_id, loyalty) VALUES ('npc_f2_a', 'realm_1', 40)`).run();

    // A 100x100 district square centered at the origin, with one building
    // inside and one building far outside (must NOT be counted).
    const boundary = [{ x: -50, z: -50 }, { x: 50, z: -50 }, { x: 50, z: 50 }, { x: -50, z: 50 }];
    db.prepare(`
      INSERT INTO districts (id, world_id, name, boundary_json, palette_json, lighting_tag, elevation_hint)
      VALUES (?, ?, 'Test District', ?, '{}', 'warm_day', 0)
    `).run(`${WORLD}:d1`, WORLD, JSON.stringify(boundary));
    db.prepare(`
      INSERT INTO world_buildings (id, world_id, building_type, x, y, z, width, depth, height)
      VALUES ('bld_1', ?, 'house', 10, 0, 10, 5, 5, 5)
    `).run(WORLD);
    db.prepare(`
      INSERT INTO world_buildings (id, world_id, building_type, x, y, z, width, depth, height)
      VALUES ('bld_2', ?, 'house', 500, 0, 500, 5, 5, 5)
    `).run(WORLD);

    return { boundary };
  }

  it("returns no_db honestly when no db is supplied", async () => {
    const r = await call("worldstate.world_detail", {}, { worldId: WORLD });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("rejects a missing worldId honestly", async () => {
    seedWorld();
    const r = await call("worldstate.world_detail", { db }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_world_id");
  });

  it("population.activeUsers matches the live city-presence count exactly", async () => {
    seedWorld();
    updateUserPosition("owv_u1", { worldId: WORLD, cityId: "c1", x: 0, y: 0, z: 0 });
    const r = await call("worldstate.world_detail", { db }, { worldId: WORLD });
    assert.equal(r.ok, true);
    assert.equal(r.population.activeUsers, getWorldUserCount(WORLD));
    assert.equal(r.population.activeUsers, 1);
  });

  it("faction states + relations exactly match faction_strategy_state / faction_relations", async () => {
    seedWorld();
    const r = await call("worldstate.world_detail", { db }, { worldId: WORLD });
    assert.equal(r.factions.count, 2);

    const alpha = r.factions.states.find((s) => s.factionId === "faction_alpha");
    const beta = r.factions.states.find((s) => s.factionId === "faction_beta");
    assert.ok(alpha && beta);
    assert.equal(alpha.stance, "war");
    assert.equal(alpha.momentum, 0.42);
    assert.equal(beta.stance, "consolidate");
    assert.equal(beta.momentum, -0.1);

    assert.equal(r.factions.relations.length, 1);
    assert.equal(r.factions.relations[0].score, -0.65);
    assert.equal(r.factions.relations[0].kind, "war");

    // Cross-check against the real getRelation() helper independently.
    const real = getRelation(db, "faction_alpha", "faction_beta");
    assert.equal(r.factions.relations[0].score, real.score);
    assert.equal(r.factions.relations[0].kind, real.kind);
  });

  it("surfaces the stuck-scheduler finding for faction_alpha only, and never mutates the row (read-only)", async () => {
    seedWorld();
    const r = await call("worldstate.world_detail", { db }, { worldId: WORLD });
    assert.equal(r.health.factionSchedulerFindings.length, 1);
    assert.equal(r.health.factionSchedulerFindings[0].subjectId, "faction_alpha");
    assert.equal(r.health.factionSchedulerFindings[0].pathology, "stuck_scheduler");
    assert.equal(r.health.factionSchedulerFindings[0].disposition, "healed");

    // No 'economy' findings ever leak through this surface, even though
    // detectPathologies would report them for other users on this box.
    for (const f of r.health.factionSchedulerFindings) {
      assert.notEqual(f.category, "economy");
    }

    // The macro must NEVER heal/mutate — this is read-only aggregation.
    // Confirm next_move_at is exactly the overdue value we inserted.
    const now = Math.floor(Date.now() / 1000);
    const row = db.prepare(`SELECT next_move_at FROM faction_strategy_state WHERE faction_id = 'faction_alpha'`).get();
    assert.ok(row.next_move_at < now - STUCK_SCHEDULER_GRACE_S, "world_detail must not heal the stuck scheduler it reports on");
  });

  it("realm legitimacy/treasury/taxRate/citizens exactly match realms.js's own getters", async () => {
    seedWorld();
    const r = await call("worldstate.world_detail", { db }, { worldId: WORLD });
    assert.equal(r.realms.length, 1);
    const realm = r.realms[0];
    assert.equal(realm.id, "realm_1");
    assert.equal(realm.legitimacy, 72);
    assert.equal(realm.treasury, 5000);
    assert.equal(realm.taxRate, 0.15);

    const realLoyalty = kingdomLoyaltySummary(db, "realm_1");
    assert.deepEqual(realm.citizens, realLoyalty);
    assert.equal(realm.citizens.avg, Math.round((80 + 40) / 2));
    assert.equal(realm.citizens.count, 2);
  });

  it("district areaM2 + buildingCount exactly match the real shoelace / point-in-polygon computation", async () => {
    const { boundary } = seedWorld();
    const r = await call("worldstate.world_detail", { db }, { worldId: WORLD });
    assert.equal(r.districts.length, 1);
    const d = r.districts[0];
    assert.equal(d.areaM2, Math.round(polygonArea(boundary)));
    assert.equal(d.areaM2, 10000); // 100m x 100m square
    assert.equal(d.buildingCount, 1); // bld_1 is inside; bld_2 is far outside
  });

  it("is an honest empty response for a world with zero faction/realm/district/presence data", async () => {
    db.prepare(`INSERT INTO worlds (id, name, universe_type) VALUES (?, ?, 'fantasy')`)
      .run(EMPTY_WORLD, "Empty World");
    const r = await call("worldstate.world_detail", { db }, { worldId: EMPTY_WORLD });
    assert.equal(r.ok, true);
    assert.equal(r.population.activeUsers, 0);
    assert.deepEqual(r.factions, { count: 0, states: [], relations: [] });
    assert.deepEqual(r.realms, []);
    assert.deepEqual(r.districts, []);
    assert.deepEqual(r.health.factionSchedulerFindings, []);
  });

  it("even a totally unknown worldId (no worlds row either) is an honest empty response, never a fabricated number", async () => {
    const r = await call("worldstate.world_detail", { db }, { worldId: "no_such_world_at_all" });
    assert.equal(r.ok, true);
    assert.equal(r.population.activeUsers, 0);
    assert.equal(r.factions.count, 0);
    assert.deepEqual(r.realms, []);
    assert.deepEqual(r.districts, []);
  });

  it("overview's per-world counts never drift from world_detail's own numbers for the same world", async () => {
    seedWorld();
    updateUserPosition("owv_u1", { worldId: WORLD, cityId: "c1", x: 0, y: 0, z: 0 });
    updateUserPosition("owv_u2", { worldId: WORLD, cityId: "c1", x: 1, y: 0, z: 1 });

    const detail = await call("worldstate.world_detail", { db }, { worldId: WORLD });
    const overview = await call("worldstate.overview", { db }, {});
    assert.equal(overview.ok, true);

    const row = overview.worlds.find((w) => w.worldId === WORLD);
    assert.ok(row, "seeded world must appear in the overview list");
    assert.equal(row.activeUsers, detail.population.activeUsers);
    assert.equal(row.activeUsers, 2);
    assert.equal(row.factionCount, detail.factions.count);
    assert.equal(row.realmCount, detail.realms.length);
    assert.equal(row.districtCount, detail.districts.length);
    assert.equal(row.stuckFactionSchedulers, detail.health.factionSchedulerFindings.length);
  });

  it("overview honors an explicit worldIds filter", async () => {
    seedWorld();
    db.prepare(`INSERT INTO worlds (id, name, universe_type) VALUES (?, ?, 'fantasy')`)
      .run(EMPTY_WORLD, "Empty World");
    const overview = await call("worldstate.overview", { db }, { worldIds: [WORLD] });
    assert.equal(overview.ok, true);
    assert.equal(overview.worlds.length, 1);
    assert.equal(overview.worlds[0].worldId, WORLD);
  });
});
