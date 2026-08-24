/**
 * Line-of-sight gate for NPC combat AI target acquisition.
 *
 * Two layers:
 *   1. Pure geometry — segmentIntersectsFootprint (2D segment vs axis-aligned
 *      building AABB): mid-segment footprint blocks; offset footprint clears;
 *      endpoint-inside returns false; degenerate footprint returns false;
 *      a footprint the segment stops short of does not block.
 *   2. Real FSM — drive the exported updateNPCCombatAI against an in-memory DB
 *      with CONCORD_TEMPERAMENT=0 (FSM isolated from temperament math):
 *        (a) wall between NPC and player → stays idle
 *        (b) clear line → idle → alerted → pursuing
 *        (c) DB error (world_buildings dropped) → fails open, still alerts
 *
 * Run: node --test server/tests/npc-combat-los.test.js
 */

process.env.CONCORD_TEMPERAMENT = "0"; // isolate the FSM before importing the module

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  segmentIntersectsFootprint,
  hasLineOfSight,
  updateNPCCombatAI,
  _losCacheClear,
  _combatStateFor,
} from "../lib/npc-simulator.js";

const getState = (npcId) => _combatStateFor(npcId)?.state;

// ── Layer 1: pure geometry ────────────────────────────────────────────────────

describe("segmentIntersectsFootprint (pure)", () => {
  it("blocks when a footprint sits mid-segment", () => {
    const a = { x: 0, z: 0 }, b = { x: 10, z: 0 };
    const bld = { x: 5, z: 0, width: 2, depth: 2 };
    assert.equal(segmentIntersectsFootprint(a, b, bld), true);
  });

  it("blocks on a diagonal segment crossing the footprint", () => {
    const a = { x: 0, z: 0 }, b = { x: 10, z: 10 };
    const bld = { x: 5, z: 5, width: 2, depth: 2 };
    assert.equal(segmentIntersectsFootprint(a, b, bld), true);
  });

  it("clears when the footprint is offset to the side", () => {
    const a = { x: 0, z: 0 }, b = { x: 10, z: 0 };
    const bld = { x: 5, z: 10, width: 2, depth: 2 };
    assert.equal(segmentIntersectsFootprint(a, b, bld), false);
  });

  it("clears when the segment stops short of the footprint", () => {
    const a = { x: 0, z: 0 }, b = { x: 2, z: 0 };
    const bld = { x: 5, z: 0, width: 2, depth: 2 };
    assert.equal(segmentIntersectsFootprint(a, b, bld), false);
  });

  it("returns false when an endpoint is inside the footprint", () => {
    const a = { x: 5, z: 0 }, b = { x: 20, z: 0 };
    const bld = { x: 5, z: 0, width: 2, depth: 2 };
    assert.equal(segmentIntersectsFootprint(a, b, bld), false);
  });

  it("returns false for a degenerate (zero-area) footprint", () => {
    const a = { x: 0, z: 0 }, b = { x: 10, z: 0 };
    assert.equal(segmentIntersectsFootprint(a, b, { x: 5, z: 0, width: 0, depth: 2 }), false);
    assert.equal(segmentIntersectsFootprint(a, b, { x: 5, z: 0, width: 2, depth: 0 }), false);
  });

  it("returns false for malformed / missing input", () => {
    assert.equal(segmentIntersectsFootprint(null, { x: 1, z: 1 }, { x: 0, z: 0, width: 2, depth: 2 }), false);
    assert.equal(segmentIntersectsFootprint({ x: 0, z: 0 }, { x: 1, z: 1 }, { x: NaN, z: 0, width: 2, depth: 2 }), false);
  });
});

// ── Layer 2: real FSM ─────────────────────────────────────────────────────────

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id               TEXT PRIMARY KEY,
      world_id         TEXT,
      current_hp       INTEGER DEFAULT 100,
      max_hp           INTEGER DEFAULT 100,
      is_wanted        INTEGER DEFAULT 0,
      criminal_rep     INTEGER DEFAULT 0,
      is_dead          INTEGER DEFAULT 0,
      current_location TEXT
    );
    CREATE TABLE world_visits (
      user_id       TEXT,
      world_id      TEXT,
      departed_at   INTEGER,
      last_position TEXT
    );
    CREATE TABLE player_world_state (
      user_id TEXT PRIMARY KEY,
      x       REAL,
      z       REAL
    );
    CREATE TABLE world_buildings (
      id       TEXT PRIMARY KEY,
      world_id TEXT,
      x        REAL,
      z        REAL,
      width    REAL,
      depth    REAL,
      state    TEXT DEFAULT 'standing'
    );
  `);
  return db;
}

function seedNpc(db, id, worldId, x, z) {
  db.prepare(
    `INSERT INTO world_npcs (id, world_id, current_hp, max_hp, is_wanted, is_dead, current_location)
     VALUES (?, ?, 100, 100, 0, 0, ?)`,
  ).run(id, worldId, JSON.stringify({ x, z }));
}

function seedPlayer(db, userId, worldId, x, z) {
  db.prepare(
    `INSERT INTO world_visits (user_id, world_id, departed_at, last_position)
     VALUES (?, ?, NULL, ?)`,
  ).run(userId, worldId, JSON.stringify({ x, z }));
}

function bandit(id, x, z) {
  return { id, archetype: "bandit", location: { x, z }, state: {} };
}

describe("hasLineOfSight + updateNPCCombatAI FSM", () => {
  beforeEach(() => _losCacheClear());

  it("stays idle when a building blocks the line to the player", () => {
    const db = setupDb();
    const worldId = "los-blocked";
    seedNpc(db, "npc1", worldId, 0, 0);
    seedPlayer(db, "p1", worldId, 5, 0);
    // Building squarely between (0,0) and (5,0).
    db.prepare(
      `INSERT INTO world_buildings (id, world_id, x, z, width, depth, state)
       VALUES ('b1', ?, 2.5, 0, 3, 3, 'standing')`,
    ).run(worldId);

    // Sanity: LOS helper agrees the line is blocked.
    assert.equal(hasLineOfSight(db, worldId, { x: 0, z: 0 }, { x: 5, z: 0 }), false);

    const npc = bandit("npc1", 0, 0);
    updateNPCCombatAI(npc, worldId, db);
    assert.equal(getState("npc1"), "idle");
  });

  it("acquires (idle → alerted → pursuing) when the line is clear", () => {
    const db = setupDb();
    const worldId = "los-clear";
    seedNpc(db, "npc2", worldId, 0, 0);
    seedPlayer(db, "p2", worldId, 5, 0);
    // Building far off the sight line — does not occlude.
    db.prepare(
      `INSERT INTO world_buildings (id, world_id, x, z, width, depth, state)
       VALUES ('b2', ?, 2.5, 50, 3, 3, 'standing')`,
    ).run(worldId);

    assert.equal(hasLineOfSight(db, worldId, { x: 0, z: 0 }, { x: 5, z: 0 }), true);

    const npc = bandit("npc2", 0, 0);
    updateNPCCombatAI(npc, worldId, db); // tick 1: idle → alerted
    assert.equal(getState("npc2"), "alerted");
    updateNPCCombatAI(npc, worldId, db); // tick 2: alerted → pursuing
    assert.equal(getState("npc2"), "pursuing");
  });

  it("fails open (still acquires) when the buildings query errors", () => {
    const db = setupDb();
    const worldId = "los-dberror";
    seedNpc(db, "npc3", worldId, 0, 0);
    seedPlayer(db, "p3", worldId, 5, 0);
    // Drop the buildings table so _getWorldBuildings throws → hasLineOfSight
    // returns true (fail-open) and the FSM behaves radius-only.
    db.exec("DROP TABLE world_buildings");

    assert.equal(hasLineOfSight(db, worldId, { x: 0, z: 0 }, { x: 5, z: 0 }), true);

    const npc = bandit("npc3", 0, 0);
    updateNPCCombatAI(npc, worldId, db);
    assert.equal(getState("npc3"), "alerted");
  });
});

// ── cachedPlayers (2026-08-23): NPCSimulator#tick fetches player positions
// ONCE per world-tick and threads the same array into every agent's combat
// check, instead of each agent re-querying world_visits/player_world_state
// itself. See updateNPCCombatAI's doc comment for the full rationale.
describe("updateNPCCombatAI — cachedPlayers parameter", () => {
  beforeEach(() => _losCacheClear());

  it("uses the provided cachedPlayers array instead of querying the DB — proven by a DB with NO world_visits table at all", () => {
    const db = setupDb();
    db.exec("DROP TABLE world_visits");
    const worldId = "los-cached";
    seedNpc(db, "npc-cached", worldId, 0, 0);

    const npc = bandit("npc-cached", 0, 0);
    // Would throw/return [] via _getPlayerPositions's own try/catch if this
    // NPC fell through to a real query (world_visits doesn't exist) — passing
    // cachedPlayers must bypass that path entirely and still acquire normally.
    assert.doesNotThrow(() => updateNPCCombatAI(npc, worldId, db, [{ userId: "p1", x: 5, z: 0 }]));
    assert.equal(getState("npc-cached"), "alerted", "must acquire using the cached player, never touching world_visits");
  });

  it("an empty cachedPlayers array means no players nearby — NPC stays idle even though a real player row exists in the DB", () => {
    const db = setupDb();
    const worldId = "los-cached-empty";
    seedNpc(db, "npc-ignore-real", worldId, 0, 0);
    seedPlayer(db, "p-real", worldId, 5, 0); // real row exists...

    const npc = bandit("npc-ignore-real", 0, 0);
    updateNPCCombatAI(npc, worldId, db, []); // ...but the cache says nobody's there
    assert.equal(getState("npc-ignore-real"), "idle", "cachedPlayers is authoritative, not a hint layered on top of a real query");
  });

  it("omitting cachedPlayers (undefined) preserves the original fetch-it-yourself behavior", () => {
    const db = setupDb();
    const worldId = "los-no-cache";
    seedNpc(db, "npc-fallback", worldId, 0, 0);
    seedPlayer(db, "p-fallback", worldId, 5, 0);

    const npc = bandit("npc-fallback", 0, 0);
    updateNPCCombatAI(npc, worldId, db); // 3-arg call, exactly as every pre-existing caller does
    assert.equal(getState("npc-fallback"), "alerted");
  });

  it("NPCSimulator#tick fetches player positions exactly ONCE per world-tick, not once per agent", async () => {
    const { NPCSimulator, NPCAgent } = await import("../lib/npc-simulator.js");
    const db = setupDb();
    const worldId = "los-once-per-tick";
    for (const id of ["npc-a", "npc-b", "npc-c"]) seedNpc(db, id, worldId, 0, 0);
    seedPlayer(db, "p1", worldId, 500, 500); // far away — no combat state change needed, just counting the query

    let playerQueryCount = 0;
    const realPrepare = db.prepare.bind(db);
    db.prepare = (sql) => {
      if (sql.includes("FROM world_visits")) playerQueryCount++;
      return realPrepare(sql);
    };

    const sim = new NPCSimulator(worldId, db, async () => ({ handle: { generate: async () => "" } }));
    sim._agents = ["npc-a", "npc-b", "npc-c"].map((id) => {
      const row = db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(id);
      const agent = new NPCAgent(row, worldId, db, async () => ({ handle: { generate: async () => "" } }));
      agent.needs = { hunger: 0.1, rest: 1, social: 1, purpose: 1, safety: 1 }; // urgent -> deterministic action, no brain call
      agent.archetype = "bandit";
      return agent;
    });

    await sim.tick();

    assert.equal(playerQueryCount, 1, `expected the world_visits query exactly once for 3 agents, got ${playerQueryCount}`);
  });
});
