/**
 * Tier-2 contract tests for Theme 2 (game-feel pass): fauna boid steering.
 *
 * Pins:
 *   - clusterCenterFor is deterministic per (world, biome, species) and
 *     yields different anchors for different species.
 *   - tickFlock writes back position deltas (creatures actually move).
 *   - Cohesion: 10 conspecifics scattered → mean pairwise distance shrinks
 *     after a few passes.
 *   - Flee: a creature within FLEE_R of a player has its velocity vector
 *     pointing AWAY from the player after one pass.
 *   - Separation: two creatures inside SEP_R of each other end up further
 *     apart after the pass.
 *   - Graceful degrade: missing player_world_state table doesn't poison
 *     the cycle; missing world_npcs returns no_world_npcs.
 *
 * Run: node --test tests/creature-behaviors.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  tickFlock,
  clearMotionForWorld,
  TUNING,
} from "../lib/ecosystem/creature-behaviors.js";
import { clusterCenterFor } from "../lib/ecosystem/fauna-spawner.js";

function setupDb({ withPlayerState = true } = {}) {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      archetype TEXT NOT NULL,
      name TEXT,
      x REAL NOT NULL DEFAULT 0,
      y REAL DEFAULT 0,
      z REAL NOT NULL DEFAULT 0,
      level INTEGER DEFAULT 1,
      is_dead INTEGER DEFAULT 0,
      is_conscious INTEGER DEFAULT 0,
      is_immortal INTEGER DEFAULT 0
    );
  `);
  if (withPlayerState) {
    db.exec(`
      CREATE TABLE player_world_state (
        user_id TEXT,
        world_id TEXT,
        x REAL, y REAL, z REAL
      );
    `);
  }
  return db;
}

function spawnCreature(db, { id, worldId, species, x, z }) {
  db.prepare(`
    INSERT INTO world_npcs (id, world_id, archetype, name, x, z)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, worldId, `creature:${species}`, species, x, z);
}

function readCreature(db, id) {
  return db.prepare(`SELECT id, x, z FROM world_npcs WHERE id = ?`).get(id);
}

function meanPairwise(positions) {
  if (positions.length < 2) return 0;
  let total = 0, n = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const dx = positions[i].x - positions[j].x;
      const dz = positions[i].z - positions[j].z;
      total += Math.hypot(dx, dz);
      n++;
    }
  }
  return total / n;
}

describe("clusterCenterFor (fauna-spawner)", () => {
  it("is deterministic for same (world, biome, species)", () => {
    const a = clusterCenterFor("concordia-hub", "forest", "deer");
    const b = clusterCenterFor("concordia-hub", "forest", "deer");
    assert.equal(a.x, b.x);
    assert.equal(a.z, b.z);
  });

  it("differs across species in same biome", () => {
    const deer = clusterCenterFor("concordia-hub", "forest", "deer");
    const wolf = clusterCenterFor("concordia-hub", "forest", "wolf");
    assert.ok(Math.abs(deer.x - wolf.x) > 0.0001 || Math.abs(deer.z - wolf.z) > 0.0001);
  });

  it("differs across biomes for same species", () => {
    const deerForest   = clusterCenterFor("concordia-hub", "forest", "deer");
    const deerHighland = clusterCenterFor("concordia-hub", "highland", "deer");
    assert.ok(Math.abs(deerForest.x - deerHighland.x) > 0.0001 || Math.abs(deerForest.z - deerHighland.z) > 0.0001);
  });

  it("respects bounds", () => {
    const c = clusterCenterFor("concordia-hub", "plains", "rabbit", { x0: -100, x1: 100, z0: -100, z1: 100 });
    assert.ok(c.x >= -100 && c.x <= 100);
    assert.ok(c.z >= -100 && c.z <= 100);
  });
});

describe("tickFlock — boid steering", () => {
  let db, state;

  beforeEach(() => {
    db = setupDb();
    state = {};
  });

  it("returns no_world_npcs gracefully when table missing", () => {
    const bad = new Database(":memory:");
    const r = tickFlock(bad, state, "concordia-hub");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_world_npcs");
  });

  it("returns ok with no creatures when world has none", () => {
    const r = tickFlock(db, state, "concordia-hub");
    assert.equal(r.ok, true);
    assert.equal(r.moved, 0);
    assert.equal(r.species, 0);
  });

  it("survives missing player_world_state (flee silently disabled)", () => {
    const db2 = setupDb({ withPlayerState: false });
    spawnCreature(db2, { id: "cr_a", worldId: "concordia-hub", species: "deer", x: 0, z: 0 });
    spawnCreature(db2, { id: "cr_b", worldId: "concordia-hub", species: "deer", x: 5, z: 0 });
    const r = tickFlock(db2, {}, "concordia-hub");
    assert.equal(r.ok, true);
    assert.equal(r.species, 1);
  });

  it("cohesion: scattered conspecifics drift toward each other over passes", () => {
    // 10 deer in a 100m × 100m area
    const ids = [];
    for (let i = 0; i < 10; i++) {
      const id = `cr_${i}`;
      ids.push(id);
      spawnCreature(db, {
        id, worldId: "concordia-hub", species: "deer",
        x: -50 + Math.random() * 100,
        z: -50 + Math.random() * 100,
      });
    }
    const before = ids.map((id) => readCreature(db, id));
    const meanBefore = meanPairwise(before);

    // Run 5 passes (≈5 minutes simulation)
    for (let i = 0; i < 5; i++) tickFlock(db, state, "concordia-hub");

    const after = ids.map((id) => readCreature(db, id));
    const meanAfter = meanPairwise(after);
    // Mean pairwise distance should shrink (cohesion working). Allow some
    // jitter — must shrink by at least 2m, comfortable headroom over noise.
    assert.ok(
      meanAfter < meanBefore - 2,
      `cohesion failed: mean before=${meanBefore.toFixed(2)} after=${meanAfter.toFixed(2)}`,
    );
  });

  it("flee: creature within FLEE_R of player moves away in one pass", () => {
    spawnCreature(db, { id: "cr_target", worldId: "concordia-hub", species: "rabbit", x: 0, z: 0 });
    // Player 5m to the +X side
    db.prepare(`
      INSERT INTO player_world_state (user_id, world_id, x, y, z)
      VALUES (?, ?, ?, ?, ?)
    `).run("user_alice", "concordia-hub", 5, 0, 0);

    const before = readCreature(db, "cr_target");
    tickFlock(db, state, "concordia-hub");
    const after = readCreature(db, "cr_target");

    // Distance to player should grow (creature ran away)
    const distBefore = Math.hypot(before.x - 5, before.z - 0);
    const distAfter  = Math.hypot(after.x  - 5, after.z  - 0);
    assert.ok(
      distAfter > distBefore,
      `flee failed: distBefore=${distBefore.toFixed(2)} distAfter=${distAfter.toFixed(2)}`,
    );

    // Velocity stored in motion state should point away from player (+X)
    // → vx negative (creature moving in −X direction).
    const stored = state.creatureMotion["concordia-hub"]?.["cr_target"];
    assert.ok(stored, "motion state should be populated");
    assert.ok(stored.vx < 0, `flee velocity should point −X but vx=${stored.vx}`);
  });

  it("separation: two creatures inside SEP_R move apart", () => {
    spawnCreature(db, { id: "cr_x", worldId: "concordia-hub", species: "fox", x: 0, z: 0 });
    spawnCreature(db, { id: "cr_y", worldId: "concordia-hub", species: "fox", x: 1.5, z: 0 });
    const distBefore = Math.hypot(1.5, 0);
    // Run a few passes — separation is a constant push, so distance grows
    for (let i = 0; i < 3; i++) tickFlock(db, state, "concordia-hub");
    const x = readCreature(db, "cr_x");
    const y = readCreature(db, "cr_y");
    const distAfter = Math.hypot(x.x - y.x, x.z - y.z);
    assert.ok(
      distAfter > distBefore,
      `separation failed: before=${distBefore.toFixed(2)} after=${distAfter.toFixed(2)}`,
    );
  });

  it("species are flocked independently — wolves don't follow deer", () => {
    // Two distant clusters: 5 deer at (-200, 0), 5 wolves at (+200, 0)
    for (let i = 0; i < 5; i++) {
      spawnCreature(db, { id: `deer_${i}`, worldId: "concordia-hub", species: "deer", x: -200 + i, z: 0 });
      spawnCreature(db, { id: `wolf_${i}`, worldId: "concordia-hub", species: "wolf", x:  200 + i, z: 0 });
    }
    for (let i = 0; i < 3; i++) tickFlock(db, state, "concordia-hub");

    // Cluster centroids should remain ≥300m apart — neither species pulls
    // the other across the world.
    const deer  = db.prepare(`SELECT x, z FROM world_npcs WHERE archetype = 'creature:deer'`).all();
    const wolf  = db.prepare(`SELECT x, z FROM world_npcs WHERE archetype = 'creature:wolf'`).all();
    const cd = deer.reduce((a, c) => ({ x: a.x + c.x, z: a.z + c.z }), { x: 0, z: 0 });
    const cw = wolf.reduce((a, c) => ({ x: a.x + c.x, z: a.z + c.z }), { x: 0, z: 0 });
    cd.x /= deer.length; cd.z /= deer.length;
    cw.x /= wolf.length; cw.z /= wolf.length;
    assert.ok(Math.hypot(cd.x - cw.x, cd.z - cw.z) > 300);
  });

  it("clearMotionForWorld removes in-memory state", () => {
    spawnCreature(db, { id: "cr_a", worldId: "concordia-hub", species: "deer", x: 0, z: 0 });
    tickFlock(db, state, "concordia-hub");
    assert.ok(state.creatureMotion["concordia-hub"]);
    clearMotionForWorld(state, "concordia-hub");
    assert.equal(state.creatureMotion["concordia-hub"], undefined);
  });

  it("MAX_SPEED clamp keeps creatures from streaking", () => {
    spawnCreature(db, { id: "cr_a", worldId: "concordia-hub", species: "deer", x: 0, z: 0 });
    spawnCreature(db, { id: "cr_b", worldId: "concordia-hub", species: "deer", x: 1.0, z: 0 });
    tickFlock(db, state, "concordia-hub");
    const a = state.creatureMotion["concordia-hub"]["cr_a"];
    const b = state.creatureMotion["concordia-hub"]["cr_b"];
    if (a) assert.ok(Math.hypot(a.vx, a.vz) <= TUNING.MAX_SPEED * 1.7);
    if (b) assert.ok(Math.hypot(b.vx, b.vz) <= TUNING.MAX_SPEED * 1.7);
  });
});
