// server/tests/population-migration-acceptance.test.js
//
// Sprint 3 acceptance criterion (per user spec):
//   "NPC conservation invariant: outflow from world A == inflow to
//   world B within transport delay."
//
// Test plan:
//   1. Spin up :memory: with mig 166 (transport_routes + kill switch),
//      mig 167 (cross-world relationships), mig 168 (population flow).
//   2. Seed 3 worlds with N=20 NPCs each, total 60.
//   3. Initiate 12 migrations (4 per world-pair).
//   4. After initiate: residents drop, in-transit grows, total = 60.
//      conservationCheck().ok must be true.
//   5. Drive heartbeat with `forceTime` past expected_arrival_at — all
//      arrivals process, residents shift to destination worlds.
//   6. After arrival: outflow A == inflow B for each pair.
//   7. Boundary discipline: same-world initiate rejected.
//   8. Kill switch: every cross-world op blocked when not 'live'.
//   9. Partial unique index: cannot double-migrate the same NPC.

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  initiateMigration, arriveAtDestination,
  findArrivalsDue, conservationCheck, residentCount,
  outboundInTransitCount, inboundInTransitCount,
  flowBetween, markLost, findOverdue,
  POPULATION_MIGRATION_CONSTANTS,
} from "../lib/population-migration.js";
import { setKillSwitchMode } from "../lib/cross-world-economy.js";
import { runPopulationMigrationCycle } from "../emergent/population-migration-cycle.js";

import { up as upMig166 } from "../migrations/166_cross_world_economy.js";
import { up as upMig167 } from "../migrations/167_cross_world_relationships.js";
import { up as upMig168 } from "../migrations/168_population_migration.js";

function setup() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      name TEXT,
      is_dead INTEGER NOT NULL DEFAULT 0,
      meta_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE TABLE economy_flows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE world_market (
      world_id TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      current_price REAL NOT NULL,
      PRIMARY KEY (world_id, resource_id)
    );
  `);
  upMig166(db);
  upMig167(db);
  upMig168(db);
  return db;
}

function seedWorld(db, worldId, count, prefix) {
  const ins = db.prepare(`INSERT INTO world_npcs (id, world_id, name) VALUES (?, ?, ?)`);
  for (let i = 0; i < count; i++) {
    ins.run(`${prefix}_npc_${i}`, worldId, `${worldId}-${i}`);
  }
}

test("acceptance — conservation invariant holds across initiate + arrive cycle", () => {
  const db = setup();
  seedWorld(db, "tunya", 20, "tu");
  seedWorld(db, "fantasy", 20, "fa");
  seedWorld(db, "crime", 20, "cr");

  // Pre-condition: 60 NPCs, all resident.
  const pre = conservationCheck(db);
  assert.equal(pre.ok, true);
  assert.equal(pre.totalNpcs, 60);
  assert.equal(pre.totalResidents, 60);
  assert.equal(pre.inTransit, 0);

  // Initiate 12 migrations: 4 per directed pair (3 pairs total ×4 = 12).
  // Route choice: each pair must exist in mig 166 transport_routes seed.
  // tunya↔fantasy, fantasy↔crime, crime↔cyber are all seeded directly.
  // tunya↔crime is NOT direct (boundary discipline; force callers to be
  // explicit about transit hops via hub/frontier — out of scope for sprint 3).
  const pairs = [
    ["tunya", "fantasy", "tu"],
    ["fantasy", "crime", "fa"],
    ["crime", "cyber", "cr"],
  ];
  let initiated = 0;
  for (const [from, to, prefix] of pairs) {
    for (let i = 0; i < 4; i++) {
      const r = initiateMigration(db, {
        npcId: `${prefix}_npc_${i}`, fromWorld: from, toWorld: to,
        reason: "voluntary",
      });
      assert.equal(r.ok, true, `initiate ${from}→${to} #${i} should succeed: ${JSON.stringify(r)}`);
      initiated++;
    }
  }
  assert.equal(initiated, 12);

  // Conservation: 60 = (residents) + (in-transit) + (dead).
  const mid = conservationCheck(db);
  assert.equal(mid.ok, true, `conservation broken mid-flight: ${JSON.stringify(mid)}`);
  assert.equal(mid.totalNpcs, 60);
  assert.equal(mid.inTransit, 12);
  assert.equal(mid.totalResidents, 48);

  // ── Drive arrivals using forceTime to bypass real-time wait ────
  const farFuture = Math.floor(Date.now() / 1000) + 100000;
  const due = findArrivalsDue(db, farFuture);
  assert.equal(due.length, 12, "all 12 events should be due in the far future");
  for (const event of due) {
    const r = arriveAtDestination(db, event.id, { forceTime: farFuture });
    assert.equal(r.ok, true, `arrival should succeed: ${JSON.stringify(r)}`);
  }

  // Conservation: still 60, all resident, none in transit.
  const post = conservationCheck(db);
  assert.equal(post.ok, true);
  assert.equal(post.totalNpcs, 60);
  assert.equal(post.totalResidents, 60);
  assert.equal(post.inTransit, 0);

  // ── Per-pair acceptance: outflow from A == inflow to B ─────────
  for (const [from, to] of pairs) {
    const flow = flowBetween(db, from, to, 0);
    assert.equal(flow.departed, 4, `${from}→${to}: 4 departed`);
    assert.equal(flow.arrived, 4, `${from}→${to}: 4 arrived (== outflow)`);
    assert.equal(flow.in_transit, 0);
  }

  // Per-world resident counts after the 3-pair migration chain
  // (tunya→fantasy, fantasy→crime, crime→cyber): every world's
  // outflow equals every world's inflow on each leg, but cyber wasn't
  // seeded so it ends with 4 NPCs (the new arrivals from crime).
  assert.equal(residentCount(db, "tunya"), 16);   // 20 - 4 outflow
  assert.equal(residentCount(db, "fantasy"), 20); // 20 + 4 - 4
  assert.equal(residentCount(db, "crime"), 20);   // 20 + 4 - 4
  assert.equal(residentCount(db, "cyber"), 4);    //  0 + 4 inflow
});

test("acceptance — heartbeat processes due events end-to-end", async () => {
  const db = setup();
  seedWorld(db, "tunya", 5, "tu");
  seedWorld(db, "fantasy", 5, "fa");

  // Initiate 3 migrations.
  for (let i = 0; i < 3; i++) {
    initiateMigration(db, { npcId: `tu_npc_${i}`, fromWorld: "tunya", toWorld: "fantasy" });
  }

  // Force events past their expected_arrival_at (sets to now-1 to be safe).
  db.prepare(`UPDATE population_flow_events SET expected_arrival_at = unixepoch() - 1 WHERE status = 'in_transit'`).run();

  // Run heartbeat.
  const r = await runPopulationMigrationCycle({ db });
  assert.equal(r.ok, true);
  assert.equal(r.arrivalsProcessed, 3);

  // All 3 NPCs now resident in fantasy.
  assert.equal(residentCount(db, "fantasy"), 8); // 5 native + 3 arrived
  assert.equal(residentCount(db, "tunya"), 2);   // 5 native - 3 left
});

test("acceptance — overdue events marked lost (NPC conserved as 'lost' not deleted)", async () => {
  const db = setup();
  seedWorld(db, "tunya", 3, "tu");
  seedWorld(db, "fantasy", 3, "fa");

  // Initiate one migration, then artificially backdate so it's overdue.
  initiateMigration(db, { npcId: "tu_npc_0", fromWorld: "tunya", toWorld: "fantasy" });
  const overdueWindow = POPULATION_MIGRATION_CONSTANTS.LOST_AFTER_OVERDUE_S + 86400;
  db.prepare(`UPDATE population_flow_events SET expected_arrival_at = unixepoch() - ?`).run(overdueWindow);

  const overdue = findOverdue(db);
  assert.equal(overdue.length, 1);
  const r = markLost(db, overdue[0].id);
  assert.equal(r.ok, true);

  // Lost NPC still in world_npcs (with the original from-world id),
  // not in transit, not dead. Conservation holds.
  const c = conservationCheck(db);
  // residents: 3 (fantasy) + 2 (tunya, the third is lost-but-still-rowed) = 5 active
  // dead: 0; in_transit: 0; lost: 1 (sits in world_npcs as resident of from-world)
  // totalNpcs: 6. accountedFor = residents + in_transit + dead = 6.
  assert.equal(c.totalNpcs, 6);
  assert.equal(c.inTransit, 0);
  // Lost NPC is no longer in_transit; it remains resident of from-world (from the engine's view).
  assert.equal(c.ok, true, `conservation should hold after lost event: ${JSON.stringify(c)}`);
});

test("boundary discipline — same-world initiate is rejected", () => {
  const db = setup();
  seedWorld(db, "tunya", 1, "tu");
  const r = initiateMigration(db, {
    npcId: "tu_npc_0", fromWorld: "tunya", toWorld: "tunya",
  });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "same_world");
});

test("boundary discipline — both world IDs are required, no implicit current world", () => {
  const db = setup();
  seedWorld(db, "tunya", 1, "tu");
  let r = initiateMigration(db, { npcId: "tu_npc_0", fromWorld: null, toWorld: "fantasy" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "missing_inputs");
  r = initiateMigration(db, { npcId: "tu_npc_0", fromWorld: "tunya", toWorld: null });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "missing_inputs");
});

test("boundary discipline — initiate requires existing transport route", () => {
  const db = setup();
  seedWorld(db, "tunya", 1, "tu");
  // No route between tunya and a fictional world.
  const r = initiateMigration(db, { npcId: "tu_npc_0", fromWorld: "tunya", toWorld: "atlantis" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no_route");
});

test("boundary discipline — NPC must currently be in fromWorld", () => {
  const db = setup();
  seedWorld(db, "tunya", 1, "tu");
  // Try to migrate the NPC FROM the wrong world.
  const r = initiateMigration(db, { npcId: "tu_npc_0", fromWorld: "fantasy", toWorld: "crime" });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "npc_not_in_from_world");
});

test("partial unique index — cannot double-migrate the same NPC", () => {
  const db = setup();
  seedWorld(db, "tunya", 1, "tu");
  const r1 = initiateMigration(db, { npcId: "tu_npc_0", fromWorld: "tunya", toWorld: "fantasy" });
  assert.equal(r1.ok, true);
  // Use cyber as the second target — tunya→cyber IS a seeded route.
  const r2 = initiateMigration(db, { npcId: "tu_npc_0", fromWorld: "tunya", toWorld: "cyber" });
  assert.equal(r2.ok, false);
  assert.equal(r2.reason, "already_in_transit");
});

test("kill switch — every cross-world op blocked when not 'live'", async () => {
  const db = setup();
  seedWorld(db, "tunya", 1, "tu");

  for (const mode of ["paused", "isolated_per_world", "rolled_back_single_world"]) {
    setKillSwitchMode(db, mode);

    const init = initiateMigration(db, { npcId: "tu_npc_0", fromWorld: "tunya", toWorld: "fantasy" });
    assert.equal(init.ok, false);
    assert.equal(init.reason, `kill_switch_${mode}`);

    const arrive = arriveAtDestination(db, 1);
    assert.equal(arrive.ok, false);
    assert.equal(arrive.reason, `kill_switch_${mode}`);

    const cycle = await runPopulationMigrationCycle({ db });
    assert.equal(cycle.ok, false);
    assert.equal(cycle.reason, `kill_switch_${mode}`);
  }

  setKillSwitchMode(db, "live");
  const live = initiateMigration(db, { npcId: "tu_npc_0", fromWorld: "tunya", toWorld: "fantasy" });
  assert.equal(live.ok, true);
});

test("read helpers — outboundInTransitCount + inboundInTransitCount accurate per world", () => {
  const db = setup();
  seedWorld(db, "tunya", 5, "tu");
  seedWorld(db, "fantasy", 5, "fa");
  seedWorld(db, "crime", 5, "cr");

  initiateMigration(db, { npcId: "tu_npc_0", fromWorld: "tunya", toWorld: "fantasy" });
  initiateMigration(db, { npcId: "tu_npc_1", fromWorld: "tunya", toWorld: "cyber" });
  initiateMigration(db, { npcId: "fa_npc_0", fromWorld: "fantasy", toWorld: "tunya" });
  initiateMigration(db, { npcId: "cr_npc_0", fromWorld: "crime", toWorld: "fantasy" });

  assert.equal(outboundInTransitCount(db, "tunya"), 2);
  assert.equal(outboundInTransitCount(db, "fantasy"), 1);
  assert.equal(outboundInTransitCount(db, "crime"), 1);
  assert.equal(inboundInTransitCount(db, "tunya"), 1);
  assert.equal(inboundInTransitCount(db, "fantasy"), 2); // tu→fa, cr→fa
  assert.equal(inboundInTransitCount(db, "cyber"), 1);
});

test("conservation across many migrations of varied lengths — invariant always holds", () => {
  const db = setup();
  seedWorld(db, "tunya", 30, "tu");
  seedWorld(db, "fantasy", 30, "fa");
  seedWorld(db, "crime", 30, "cr");

  // Initiate 30 migrations across various pairs (all seeded routes).
  const pairs = [["tunya","fantasy","tu"],["fantasy","crime","fa"],["crime","cyber","cr"]];
  for (let i = 0; i < 30; i++) {
    const [from, to, prefix] = pairs[i % 3];
    initiateMigration(db, { npcId: `${prefix}_npc_${Math.floor(i/3)}`, fromWorld: from, toWorld: to });
  }

  // Conservation must hold at every step. Force half to arrive, check, force the rest.
  const halfTime = Math.floor(Date.now() / 1000) + 100000;
  const due = findArrivalsDue(db, halfTime);
  for (let i = 0; i < Math.floor(due.length / 2); i++) {
    arriveAtDestination(db, due[i].id, { forceTime: halfTime });
  }
  const half = conservationCheck(db);
  assert.equal(half.ok, true, `conservation broken halfway: ${JSON.stringify(half)}`);
  assert.equal(half.totalNpcs, 90);

  // Arrive the rest.
  const remaining = findArrivalsDue(db, halfTime);
  for (const event of remaining) {
    arriveAtDestination(db, event.id, { forceTime: halfTime });
  }
  const final = conservationCheck(db);
  assert.equal(final.ok, true);
  assert.equal(final.totalNpcs, 90);
  assert.equal(final.totalResidents, 90);
  assert.equal(final.inTransit, 0);
});
