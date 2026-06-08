// tests/depth/analytics-behavior.test.js — REAL behavioral tests for the
// analytics domain's DB-backed structural macros: world-summary + global-summary
// (registerLensAction family, invoked via lensRun → the real lens.run macro).
//
// These two macros aggregate genuine facts from the live SQLite tables
// (worlds, world_events, world_buildings, world_visits, dtus). The tests seed
// real rows into the migrated DB (the same handle ctx.db resolves to), then
// assert the macros return the true counts — and that an unknown world / empty
// platform reports honest zeros, never fabricated data.
//
// lens.run wraps a handler's {ok:false,error} as {ok:true, result:{ok:false,error}}
// — the OUTER ok is dispatch success; the handler's verdict is in result.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";

// A unique world id per test run so seeded rows never collide with seed data
// or a prior run sharing the isolated DB.
const W = `depth-analytics-world-${Date.now().toString(36)}`;
const W2 = `${W}-b`;
let db;

before(async () => {
  const t = await load(); // boot server.js once → migrated DB + LENS_ACTIONS map
  db = t.STATE?.db;
  assert.ok(db, "migrated STATE.db handle must be available");

  // Seed a world with known population / npc_count / status.
  db.prepare(
    "INSERT OR REPLACE INTO worlds (id, name, universe_type, population, total_visits, npc_count, status) VALUES (?,?,?,?,?,?,?)"
  ).run(W, "Depth Analytics World", "concordia", 42, 7, 9, "active");

  // 3 buildings — 2 standing, 1 collapsed (infraCoverage should read 67%).
  const bstmt = db.prepare(
    "INSERT OR REPLACE INTO world_buildings (id, world_id, building_type, x, y, z, state) VALUES (?,?,?,?,?,?,?)"
  );
  bstmt.run(`${W}-b1`, W, "inn", 0, 0, 0, "standing");
  bstmt.run(`${W}-b2`, W, "market", 1, 0, 0, "standing");
  bstmt.run(`${W}-b3`, W, "tower", 2, 0, 0, "collapsed");

  // 2 world events.
  const estmt = db.prepare(
    "INSERT OR REPLACE INTO world_events (id, world_id, event_type, title) VALUES (?,?,?,?)"
  );
  estmt.run(`${W}-e1`, W, "festival", "Harvest Festival");
  estmt.run(`${W}-e2`, W, "uprising", "Plaza Uprising");

  // 3 visits: 2 distinct users, one still present (departed_at NULL).
  const vstmt = db.prepare(
    "INSERT OR REPLACE INTO world_visits (id, user_id, world_id, departed_at) VALUES (?,?,?,?)"
  );
  vstmt.run(`${W}-v1`, "userA", W, null);            // present
  vstmt.run(`${W}-v2`, "userA", W, 1000);            // past visit, same user
  vstmt.run(`${W}-v3`, "userB", W, 2000);            // past visit, other user

  // 2 DTUs tagged to this world (one public, one private).
  const dstmt = db.prepare(
    "INSERT OR REPLACE INTO dtus (id, title, visibility, world_id) VALUES (?,?,?,?)"
  );
  dstmt.run(`${W}-d1`, "World DTU public", "public", W);
  dstmt.run(`${W}-d2`, "World DTU private", "private", W);

  // A second world so global aggregates exceed a single world.
  db.prepare(
    "INSERT OR REPLACE INTO worlds (id, name, universe_type, population, npc_count, status) VALUES (?,?,?,?,?,?)"
  ).run(W2, "Depth Analytics World B", "concordia", 5, 1, "archived");
  bstmt.run(`${W2}-b1`, W2, "house", 0, 0, 0, "standing");
});

describe("analytics — world-summary (REAL per-world DB aggregation)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("analytics-world"); });

  it("aggregates true counts for the seeded world", async () => {
    const r = await lensRun("analytics", "world-summary", { params: { worldId: W } }, ctx);
    assert.equal(r.ok, true, "dispatch succeeds");
    const res = r.result; // lens.run unwraps {ok:true,result:X} → r.result IS X
    assert.equal(res.worldId, W);
    assert.equal(res.found, true);
    assert.equal(res.worldName, "Depth Analytics World");
    assert.equal(res.status, "active");
    assert.equal(res.population, 42);
    assert.equal(res.npcCount, 9);
    assert.equal(res.buildingCount, 3);
    assert.equal(res.standingBuildings, 2);
    assert.equal(res.infraCoverage, 67); // round(2/3 * 100)
    assert.equal(res.eventCount, 2);
    assert.equal(res.activePresence, 1); // one open visit
    assert.equal(res.uniqueVisitors, 2); // userA + userB
    assert.equal(res.taggedDtus, 2);
  });

  it("rejects a missing worldId", async () => {
    const r = await lensRun("analytics", "world-summary", { params: {} }, ctx);
    assert.equal(r.ok, true, "dispatch still succeeds");
    assert.equal(r.result.ok, false, "handler refuses");
    assert.ok(String(r.result.error).includes("worldId required"));
  });

  it("reports an unknown world as not-found with honest zeros", async () => {
    const r = await lensRun("analytics", "world-summary", { params: { worldId: "no-such-world-xyz" } }, ctx);
    assert.equal(r.ok, true);
    const res = r.result;
    assert.equal(res.found, false);
    assert.equal(res.population, 0);
    assert.equal(res.buildingCount, 0);
    assert.equal(res.eventCount, 0);
    assert.equal(res.activePresence, 0);
    assert.equal(res.taggedDtus, 0);
    assert.equal(res.infraCoverage, 0);
  });
});

describe("analytics — global-summary (REAL cross-world DB aggregation)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("analytics-global"); });

  it("counts at least the seeded worlds / buildings / events / dtus", async () => {
    const r = await lensRun("analytics", "global-summary", {}, ctx);
    assert.equal(r.ok, true);
    const res = r.result;
    // Two worlds were seeded; the platform may have seed worlds too, so assert
    // lower bounds (the seeded rows are genuinely present).
    assert.ok(res.totalWorlds >= 2, `totalWorlds ${res.totalWorlds} >= 2`);
    assert.ok(res.activeWorlds >= 1, `activeWorlds ${res.activeWorlds} >= 1`);
    assert.ok(res.totalBuildings >= 4, `totalBuildings ${res.totalBuildings} >= 4`); // 3 + 1
    assert.ok(res.totalEvents >= 2, `totalEvents ${res.totalEvents} >= 2`);
    assert.ok(res.totalDtus >= 2, `totalDtus ${res.totalDtus} >= 2`);
    assert.ok(res.publicDtus >= 1, `publicDtus ${res.publicDtus} >= 1`);
    assert.ok(res.activeUsers >= 2, `activeUsers ${res.activeUsers} >= 2`);
    assert.equal(typeof res.totalCitations, "number");
  });

  it("returns a topWorlds array containing the highest-population seeded world", async () => {
    const r = await lensRun("analytics", "global-summary", {}, ctx);
    assert.equal(r.ok, true);
    const res = r.result;
    assert.ok(Array.isArray(res.topWorlds), "topWorlds is an array");
    assert.ok(res.topWorlds.length >= 1, "topWorlds has entries");
    // Every entry has the real per-world shape.
    for (const w of res.topWorlds) {
      assert.equal(typeof w.worldId, "string");
      assert.equal(typeof w.population, "number");
      assert.equal(typeof w.npcCount, "number");
    }
    // The seeded population-42 world should rank in the top 5.
    const ours = res.topWorlds.find((w) => w.worldId === W);
    if (ours) assert.equal(ours.population, 42);
  });
});
