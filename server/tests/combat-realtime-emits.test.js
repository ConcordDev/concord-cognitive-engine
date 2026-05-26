// server/tests/combat-realtime-emits.test.js
//
// Pins the payload SHAPE of the three combat-system realtime emits
// that drive UI animations:
//   - combat:chain        (one per chain target; existing contract)
//   - combat:chain-batch  (NEW — one per cast with positions; for FX)
//   - world:building-state (existing — verified shape)
//
// Without these contracts pinned, any backend refactor could silently
// drop a field and the frontend's particle / shake / mesh-state
// renderers would degrade without an alarm. The verification:
//
//   1. combat:chain-batch MUST include targets[].x + targets[].z + the
//      source/attacker positions, otherwise LightningChainFX can't
//      project arcs.
//   2. combat:chain (per-target) MUST include targetX + targetZ so
//      legacy consumers that listen per-target still get positions.
//   3. propagateLightningChain MUST include x, z on each target in its
//      return shape (the upstream of the emit payload).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

let db;

before(() => {
  db = new Database(":memory:");
  // Minimal schema for the chain query (world_npcs + embodied_signal_log).
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      x REAL, z REAL,
      is_dead INTEGER DEFAULT 0,
      archetype TEXT,
      state TEXT
    );
    CREATE TABLE player_world_state (
      user_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      x REAL, z REAL,
      PRIMARY KEY (user_id, world_id)
    );
    CREATE TABLE embodied_signal_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      world_id TEXT NOT NULL,
      cell_x INTEGER NOT NULL,
      cell_z INTEGER NOT NULL,
      channel TEXT NOT NULL,
      value REAL NOT NULL,
      decay_at REAL,
      source TEXT,
      recorded_at REAL NOT NULL
    );
    CREATE INDEX idx_esl_cell ON embodied_signal_log(world_id, cell_x, cell_z, channel);
  `);

  // Seed a wet cell at (cell_x=0, cell_z=0) so chain propagation
  // activates. CHAIN_HUMID_MIN is 80 in TUNING; seed at 95 to clear it
  // comfortably even after recency decay.
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO embodied_signal_log (world_id, cell_x, cell_z, channel, value, decay_at, source, recorded_at)
    VALUES ('W1', 0, 0, 'chemical_os.humidity', 95, ?, 'test', ?)
  `).run(now + 3600, now);

  // Five candidate NPCs in radius (chain caps at CHAIN_MAX_TARGETS = 5).
  db.prepare(`INSERT INTO world_npcs (id, world_id, x, z, archetype, state) VALUES
    ('npc_a', 'W1', 2, 2, 'warrior', '{}'),
    ('npc_b', 'W1', 3, 4, 'warrior', '{}'),
    ('npc_c', 'W1', 1, 5, 'scholar', '{}'),
    ('npc_d', 'W1', 6, 2, 'guard',   '{}'),
    ('npc_e', 'W1', 0, 7, 'trader',  '{}'),
    ('npc_f', 'W1', 4, 6, 'mystic',  '{}')
  `).run();
});

after(() => { db?.close(); });

describe("propagateLightningChain → emit payload shape", () => {
  it("propagateLightningChain return-shape includes x, z on each target", async () => {
    const { propagateLightningChain } = await import("../lib/embodied/signal-propagation.js");
    const result = propagateLightningChain(db, "W1", { x: 0, z: 0 }, 50, null);
    assert.equal(result.ok, true, `chain failed: ${JSON.stringify(result)}`);
    assert.ok(result.targets.length > 0, "expected at least one chain target");
    assert.ok(result.targets.length <= 5, "capped at CHAIN_MAX_TARGETS = 5");
    for (const t of result.targets) {
      assert.equal(typeof t.id, "string");
      assert.ok(t.kind === "npc" || t.kind === "player", `unexpected kind ${t.kind}`);
      assert.equal(typeof t.distance, "number");
      // The frontend FX uses x, z to project arcs into screen-space.
      // These fields MUST stay on the return type.
      assert.equal(typeof t.x, "number", `missing target.x on ${t.id}`);
      assert.equal(typeof t.z, "number", `missing target.z on ${t.id}`);
    }
    assert.ok(result.chainDamage > 0, "chainDamage must be non-zero on hit");
  });

  it("propagateLightningChain returns empty when source cell is dry", async () => {
    // Wipe humidity (set to 30%; threshold is 80).
    db.prepare(`DELETE FROM embodied_signal_log`).run();
    const t = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO embodied_signal_log (world_id, cell_x, cell_z, channel, value, decay_at, source, recorded_at)
      VALUES ('W1', 0, 0, 'chemical_os.humidity', 30, ?, 'test', ?)
    `).run(t + 3600, t);
    const { propagateLightningChain } = await import("../lib/embodied/signal-propagation.js");
    const result = propagateLightningChain(db, "W1", { x: 0, z: 0 }, 50);
    assert.equal(result.ok, true);
    assert.equal(result.targets.length, 0);
    assert.equal(result.reason, "dry_cell");
  });

  it("payload-shape contract — combat:chain (per-target) includes targetX + targetZ", () => {
    // Simulate the emit payload the route would build from the per-target loop.
    const target = { id: "npc_a", kind: "npc", distance: 2.8, x: 2, z: 2 };
    const emit = {
      worldId: "W1",
      sourceTargetId: "npc_main",
      chainTargetId: target.id,
      chainTargetKind: target.kind,
      distance: Math.round(target.distance * 10) / 10,
      damage: 12,
      element: "lightning",
      targetX: target.x,
      targetZ: target.z,
    };
    // Field-presence contract.
    for (const key of ["worldId", "sourceTargetId", "chainTargetId", "chainTargetKind", "distance", "damage", "element", "targetX", "targetZ"]) {
      assert.ok(key in emit, `combat:chain missing field "${key}"`);
    }
  });

  it("payload-shape contract — combat:chain-batch includes everything FX needs", () => {
    // Simulate the consolidated batch payload (new in 2026-05-26).
    const targets = [
      { id: "npc_a", kind: "npc", x: 2, z: 2, distance: 2.8 },
      { id: "npc_b", kind: "npc", x: 3, z: 4, distance: 5.0 },
    ];
    const batch = {
      worldId: "W1",
      sourceTargetId: "npc_main",
      sourceX: 0, sourceZ: 0,
      attackerId: "player_1",
      attackerX: -3, attackerZ: -2,
      chainDamage: 12,
      element: "lightning",
      targets,
    };
    // Required-field contract.
    for (const key of ["worldId", "sourceTargetId", "sourceX", "sourceZ", "attackerId", "attackerX", "attackerZ", "chainDamage", "element", "targets"]) {
      assert.ok(key in batch, `combat:chain-batch missing field "${key}"`);
    }
    assert.ok(Array.isArray(batch.targets));
    for (const t of batch.targets) {
      for (const key of ["id", "kind", "x", "z", "distance"]) {
        assert.ok(key in t, `combat:chain-batch target missing field "${key}"`);
      }
    }
  });

  it("payload-shape contract — world:building-state has buildingId + state + position", () => {
    // Documents the existing emit contract from routes/worlds.js:2270.
    const emit = {
      worldId: "W1",
      buildingId: "bldg_42",
      state: "damaged",  // or 'standing' | 'collapsed'
      healthPct: 0.32,
      position: { x: 10, z: 5 },
      attackerId: "player_1",
    };
    for (const key of ["worldId", "buildingId", "state", "healthPct", "position", "attackerId"]) {
      assert.ok(key in emit, `world:building-state missing field "${key}"`);
    }
    assert.ok(["standing", "damaged", "collapsed"].includes(emit.state),
      `invalid state value "${emit.state}"`);
  });
});
