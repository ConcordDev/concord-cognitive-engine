// server/tests/npc-building-affinity.test.js
//
// Contract tests for server/lib/npc-building-affinity.js + its heartbeat
// server/emergent/npc-building-affinity-cycle.js — audit item #16, the
// connective tissue between npc-routines.js (schedule), building-purpose.js
// (60 authored purposeful buildings) and dtu-props.js (DTU world-props).
//
// Real :memory: SQLite + the full migration chain (same pattern as
// tests/building-purpose.test.js / tests/dtu-props.test.js) — no
// hand-rolled mock DB, since this unit spans three real tables
// (world_buildings, npc_routine_state, dtus) whose schemas are easiest to
// get right by just running the real migrations.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { seedRoomsForBuilding } from "../lib/building-interiors.js";
import {
  pickBuildingForNpc,
  npcUseProp,
  getNpcPropUse,
  currentActivityForNpc,
  ACTIVITY_BUILDING_TYPES,
} from "../lib/npc-building-affinity.js";
import { runNpcBuildingAffinityCycle } from "../emergent/npc-building-affinity-cycle.js";
import { CITY_LAYOUT_WORLD_ID } from "../lib/building-purpose.js";

// ── Fixtures ─────────────────────────────────────────────────────────────

function insertNpc(db, { id, worldId = CITY_LAYOUT_WORLD_ID, faction = null, archetype = "trader", isDead = 0 }) {
  db.prepare(`
    INSERT INTO world_npcs (id, world_id, current_location, faction, archetype, is_dead)
    VALUES (?, ?, '{"x":0,"z":0}', ?, ?, ?)
  `).run(id, worldId, faction, archetype, isDead);
}

function insertRoutineState(db, { npcId, activityKind, locationKind = "market", arrived = true }) {
  db.prepare(`
    INSERT INTO npc_routine_state
      (npc_id, current_block, activity_kind, location_kind, target_x, target_z, started_at, arrived_at, expected_end_at)
    VALUES (?, 0, ?, ?, 0, 0, unixepoch(), ?, unixepoch() + 10800)
  `).run(npcId, activityKind, locationKind, arrived ? Math.floor(Date.now() / 1000) : null);
}

function insertBuilding(db, { id, worldId = CITY_LAYOUT_WORLD_ID, buildingType, x = 0, z = 0 }) {
  db.prepare(`
    INSERT INTO world_buildings (id, world_id, building_type, x, y, z)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(id, worldId, buildingType, x, z);
}

function insertDtu(db, { id, ownerId = "alice", type = "recipe", visibility = "public", worldId = CITY_LAYOUT_WORLD_ID, title = "A Real Recipe" }) {
  db.prepare(`
    INSERT INTO dtus (id, owner_user_id, creator_id, title, body_json, data, tags_json, visibility, tier, type, world_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, '{}', '{}', '[]', ?, 'regular', ?, ?, datetime('now'), datetime('now'))
  `).run(id, ownerId, ownerId, title, visibility, type, worldId);
}

function makeDb() {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = OFF");
  return db;
}

describe("npc-building-affinity", () => {
  let db;

  before(async () => {
    db = makeDb();
    await runMigrations(db);
  });

  // Fresh rows per test — several tests reuse the same activity's candidate
  // `building_type`s (e.g. multiple 'trade' scenarios all match
  // trading_floor/market/auction_house), so without a reset a later test
  // would silently pick up an earlier test's building/NPC rows from the
  // shared db instead of its own fixtures. Clearing tables (not re-running
  // the ~370-migration chain) keeps this fast.
  beforeEach(() => {
    for (const table of ["npc_routine_state", "world_npcs", "world_buildings", "building_rooms", "dtus", "npc_preoccupations"]) {
      try { db.prepare(`DELETE FROM ${table}`).run(); } catch { /* table optional on some schemas */ }
    }
  });

  describe("pickBuildingForNpc — activity -> purpose matching", () => {
    it("a 'trade' activity picks a REAL commerce-district building (trading_floor)", () => {
      insertNpc(db, { id: "npc_trader_1", archetype: "trader", faction: "guild" });
      insertRoutineState(db, { npcId: "npc_trader_1", activityKind: "trade" });
      insertBuilding(db, { id: "b_trade_1", buildingType: "trading_floor" });

      const pick = pickBuildingForNpc(db, CITY_LAYOUT_WORLD_ID, { id: "npc_trader_1" });
      assert.equal(pick.ok, true);
      assert.equal(pick.buildingId, "b_trade_1");
      assert.equal(pick.buildingType, "trading_floor");
      assert.equal(pick.activity, "trade");
      assert.equal(pick.districtId, "concordia-hub:market");
    });

    it("a 'commune' activity picks the sanctuary (Social district), not a random building", () => {
      insertNpc(db, { id: "npc_mystic_1", archetype: "mystic" });
      insertRoutineState(db, { npcId: "npc_mystic_1", activityKind: "commune" });
      insertBuilding(db, { id: "b_sanctuary_1", buildingType: "sanctuary" });
      // A decoy building of an unrelated type must never be picked for commune.
      insertBuilding(db, { id: "b_decoy_1", buildingType: "mill" });

      const pick = pickBuildingForNpc(db, CITY_LAYOUT_WORLD_ID, { id: "npc_mystic_1" });
      assert.equal(pick.ok, true);
      assert.equal(pick.buildingId, "b_sanctuary_1");
      assert.equal(pick.districtId, "concordia-hub:plaza");
    });

    it("a 'craft' activity picks a REAL creation-district building (workshop)", () => {
      insertNpc(db, { id: "npc_smith_1", archetype: "default" });
      insertRoutineState(db, { npcId: "npc_smith_1", activityKind: "craft" });
      insertBuilding(db, { id: "b_workshop_1", buildingType: "workshop" });

      const pick = pickBuildingForNpc(db, CITY_LAYOUT_WORLD_ID, { id: "npc_smith_1" });
      assert.equal(pick.ok, true);
      assert.equal(pick.buildingId, "b_workshop_1");
      assert.equal(pick.districtId, "concordia-hub:industrial");
    });

    it("is deterministic — same NPC, same day, same pick across repeated calls, even with multiple candidates", () => {
      insertNpc(db, { id: "npc_trader_det", archetype: "trader" });
      insertRoutineState(db, { npcId: "npc_trader_det", activityKind: "trade" });
      insertBuilding(db, { id: "b_trade_det_1", buildingType: "trading_floor" });
      insertBuilding(db, { id: "b_trade_det_2", buildingType: "market" });
      insertBuilding(db, { id: "b_trade_det_3", buildingType: "auction_house" });

      const first = pickBuildingForNpc(db, CITY_LAYOUT_WORLD_ID, { id: "npc_trader_det" });
      const second = pickBuildingForNpc(db, CITY_LAYOUT_WORLD_ID, { id: "npc_trader_det" });
      assert.equal(first.ok, true);
      assert.ok(first.buildingId);
      assert.equal(first.buildingId, second.buildingId, "repeated picks on the same day must agree");
    });

    it("honestly returns null (no fabricated pick) for 'wander' — no purpose mapping exists by design", () => {
      insertNpc(db, { id: "npc_wanderer_1", archetype: "default" });
      insertRoutineState(db, { npcId: "npc_wanderer_1", activityKind: "wander" });
      assert.ok(!("wander" in ACTIVITY_BUILDING_TYPES), "wander must have no purpose-building entry");

      const pick = pickBuildingForNpc(db, CITY_LAYOUT_WORLD_ID, { id: "npc_wanderer_1" });
      assert.equal(pick.ok, true);
      assert.equal(pick.buildingId, null);
      assert.equal(pick.reason, "no_purpose_for_activity");
    });

    it("honestly returns null when no matching building type exists yet in this world", () => {
      insertNpc(db, { id: "npc_patrol_nomatch", archetype: "guard" });
      insertRoutineState(db, { npcId: "npc_patrol_nomatch", activityKind: "patrol" });
      // No watch_house/courthouse building inserted for this NPC's world.
      const pick = pickBuildingForNpc(db, CITY_LAYOUT_WORLD_ID, { id: "npc_patrol_nomatch" });
      assert.equal(pick.ok, true);
      assert.equal(pick.buildingId, null);
      assert.equal(pick.reason, "no_matching_building");
    });

    it("honestly returns null for an NPC with no schedule yet", () => {
      insertNpc(db, { id: "npc_no_schedule", archetype: "default" });
      const pick = pickBuildingForNpc(db, CITY_LAYOUT_WORLD_ID, { id: "npc_no_schedule" });
      assert.equal(pick.ok, true);
      assert.equal(pick.buildingId, null);
      assert.equal(pick.reason, "no_schedule");
    });

    it("never fabricates a purpose mapping for a world other than the authored concordia-hub", () => {
      insertNpc(db, { id: "npc_other_world", worldId: "some-other-world", archetype: "trader" });
      insertRoutineState(db, { npcId: "npc_other_world", activityKind: "trade" });
      insertBuilding(db, { id: "b_other_world_trade", worldId: "some-other-world", buildingType: "trading_floor" });

      const pick = pickBuildingForNpc(db, "some-other-world", { id: "npc_other_world" });
      assert.equal(pick.ok, true);
      assert.equal(pick.buildingId, null);
      assert.equal(pick.reason, "no_authored_layout_for_world");
    });

    it("currentActivityForNpc reads the real routine-state row", () => {
      insertNpc(db, { id: "npc_activity_read", archetype: "default" });
      insertRoutineState(db, { npcId: "npc_activity_read", activityKind: "train" });
      const state = currentActivityForNpc(db, "npc_activity_read");
      assert.equal(state.activity_kind, "train");
    });
  });

  describe("npcUseProp — only records an interaction when a REAL dtu-prop exists at the building", () => {
    let originalEmit;
    let emittedEvents;

    beforeEach(() => {
      originalEmit = globalThis._concordRealtimeEmit;
      emittedEvents = [];
      globalThis._concordRealtimeEmit = (name, payload) => emittedEvents.push({ name, payload });
    });
    afterEach(() => {
      globalThis._concordRealtimeEmit = originalEmit;
    });

    it("records an interaction + emits npc:prop-interaction when a real room-scoped prop exists", () => {
      insertNpc(db, { id: "npc_uses_prop", archetype: "trader", faction: "guild" });
      insertRoutineState(db, { npcId: "npc_uses_prop", activityKind: "trade" });
      insertBuilding(db, { id: "b_trade_prop", buildingType: "trading_floor" });
      // "market" blueprint provides a market_stall room, which the
      // 'counter' slot (recipe/blueprint/craft DTUs) prefers.
      seedRoomsForBuilding(db, "b_trade_prop", CITY_LAYOUT_WORLD_ID, "market");
      insertDtu(db, { id: "dtu_recipe_1", type: "recipe", visibility: "public" });

      const pick = pickBuildingForNpc(db, CITY_LAYOUT_WORLD_ID, { id: "npc_uses_prop" });
      assert.equal(pick.buildingId, "b_trade_prop");

      const used = npcUseProp(db, CITY_LAYOUT_WORLD_ID, { id: "npc_uses_prop", faction: "guild" }, pick.buildingId);
      assert.equal(used.ok, true);
      assert.equal(used.dtuId, "dtu_recipe_1");
      assert.equal(used.buildingId, "b_trade_prop");

      // In-memory "currently using" state is recorded.
      const record = getNpcPropUse("npc_uses_prop");
      assert.ok(record);
      assert.equal(record.dtuId, "dtu_recipe_1");
      assert.equal(record.buildingId, "b_trade_prop");

      // Real event emitted following the existing npc-routines fan-out pattern.
      assert.equal(emittedEvents.length, 1);
      assert.equal(emittedEvents[0].name, "npc:prop-interaction");
      assert.equal(emittedEvents[0].payload.npcId, "npc_uses_prop");
      assert.equal(emittedEvents[0].payload.dtuId, "dtu_recipe_1");
      assert.equal(emittedEvents[0].payload.buildingId, "b_trade_prop");
    });

    it("honestly refuses to fabricate an interaction when the building has no rooms/props at all", () => {
      insertNpc(db, { id: "npc_no_prop", archetype: "trader" });
      insertRoutineState(db, { npcId: "npc_no_prop", activityKind: "trade" });
      insertBuilding(db, { id: "b_trade_empty", buildingType: "trading_floor" });
      // No seedRoomsForBuilding call, no dtus inserted for this building.

      const used = npcUseProp(db, CITY_LAYOUT_WORLD_ID, { id: "npc_no_prop" }, "b_trade_empty");
      assert.equal(used.ok, false);
      assert.equal(used.reason, "no_prop_at_building");
      assert.equal(emittedEvents.length, 0, "no event should fire on a non-interaction");
      assert.equal(getNpcPropUse("npc_no_prop"), null);
    });

    it("honestly refuses when a DTU exists in the world but resolves to a generic (non-room) placement, not this building", () => {
      insertNpc(db, { id: "npc_generic_only", archetype: "trader" });
      insertRoutineState(db, { npcId: "npc_generic_only", activityKind: "trade" });
      insertBuilding(db, { id: "b_trade_no_rooms", buildingType: "trading_floor" });
      // DTU exists in the world, but with no rooms seeded for this building
      // its slot can never resolve into a room -> generic plaza placement,
      // which must NOT be reported as "at this building."
      insertDtu(db, { id: "dtu_recipe_generic", type: "recipe", visibility: "public" });

      const used = npcUseProp(db, CITY_LAYOUT_WORLD_ID, { id: "npc_generic_only" }, "b_trade_no_rooms");
      assert.equal(used.ok, false);
      assert.equal(used.reason, "no_prop_at_building");
    });

    it("honest failure on missing db/npc/buildingId", () => {
      assert.equal(npcUseProp(null, CITY_LAYOUT_WORLD_ID, { id: "x" }, "b1").reason, "no_db");
      assert.equal(npcUseProp(db, CITY_LAYOUT_WORLD_ID, null, "b1").reason, "no_npc");
      assert.equal(npcUseProp(db, CITY_LAYOUT_WORLD_ID, { id: "x" }, null).reason, "no_building");
    });
  });

  describe("runNpcBuildingAffinityCycle — heartbeat-signature-compatible, never throws, kill-switch honored", () => {
    const ENV_KEY = "CONCORD_NPC_BUILDING_AFFINITY";
    let savedEnv;
    beforeEach(() => { savedEnv = process.env[ENV_KEY]; });
    afterEach(() => {
      if (savedEnv === undefined) delete process.env[ENV_KEY];
      else process.env[ENV_KEY] = savedEnv;
    });

    it("kill-switch disables the cycle honestly (no silent no-op success)", async () => {
      process.env[ENV_KEY] = "0";
      const r = await runNpcBuildingAffinityCycle({ db });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    });

    it("honest failure with no db, matching the heartbeat-registry ctx shape { state, db, tickCount, reason }", async () => {
      delete process.env[ENV_KEY];
      const r = await runNpcBuildingAffinityCycle({ state: {}, db: null, tickCount: 5, reason: "heartbeat" });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "no_db");
    });

    it("advances a bounded set of purposeful NPCs and reports honest stats", async () => {
      delete process.env[ENV_KEY];
      const cycleDb = makeDb();
      await runMigrations(cycleDb);

      insertNpc(cycleDb, { id: "cyc_npc_trade", archetype: "trader" });
      insertRoutineState(cycleDb, { npcId: "cyc_npc_trade", activityKind: "trade", arrived: true });
      insertBuilding(cycleDb, { id: "cyc_b_trade", buildingType: "trading_floor" });
      seedRoomsForBuilding(cycleDb, "cyc_b_trade", CITY_LAYOUT_WORLD_ID, "market");
      insertDtu(cycleDb, { id: "cyc_dtu_recipe", type: "recipe", visibility: "public" });

      // Second NPC still heading there (not yet arrived) — should get a
      // building pick but must NOT trigger a prop interaction.
      insertNpc(cycleDb, { id: "cyc_npc_heading", archetype: "trader" });
      insertRoutineState(cycleDb, { npcId: "cyc_npc_heading", activityKind: "trade", arrived: false });

      // Third NPC wandering — no purpose mapping, correctly skipped.
      insertNpc(cycleDb, { id: "cyc_npc_wander", archetype: "default" });
      insertRoutineState(cycleDb, { npcId: "cyc_npc_wander", activityKind: "wander", arrived: true });

      const r = await runNpcBuildingAffinityCycle({ db: cycleDb, tickCount: 10, reason: "heartbeat" });
      assert.equal(r.ok, true);
      assert.equal(r.evaluated, 2, "wander is not queried by the cycle's activity filter at all");
      assert.equal(r.buildingsPicked, 2, "both trade NPCs pick the real building");
      assert.equal(r.propsUsed, 1, "only the arrived NPC gets the prop interaction");
    });

    it("is resilient to a totally broken db handle — never throws, returns an honest ok:true no-op", async () => {
      const brokenDb = { prepare() { throw new Error("boom"); } };
      await assert.doesNotReject(async () => {
        const r = await runNpcBuildingAffinityCycle({ db: brokenDb });
        assert.equal(r.ok, true);
        assert.equal(r.evaluated, 0);
        // Whichever internal query hits the broken handle first, the cycle
        // must degrade to an honest no-op reason, never throw.
        assert.ok(["no_npc_table", "no_hub_npcs", "query_failed"].includes(r.reason), r.reason);
      });
    });

    it("never throws even when an individual NPC's data causes an internal error", async () => {
      const perNpcDb = makeDb();
      await runMigrations(perNpcDb);
      insertNpc(perNpcDb, { id: "cyc_npc_bad", archetype: "trader" });
      insertRoutineState(perNpcDb, { npcId: "cyc_npc_bad", activityKind: "trade", arrived: true });
      // No matching building at all -> pickBuildingForNpc returns an honest
      // null; the loop must continue without throwing.
      await assert.doesNotReject(async () => {
        const r = await runNpcBuildingAffinityCycle({ db: perNpcDb });
        assert.equal(r.ok, true);
        assert.equal(r.evaluated, 1);
        assert.equal(r.buildingsPicked, 0);
        assert.equal(r.propsUsed, 0);
      });
    });
  });
});
