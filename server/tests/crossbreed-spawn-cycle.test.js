// server/tests/crossbreed-spawn-cycle.test.js
//
// Pins the end-to-end crossbreed → spawn → render-ready contract:
//   1. Bond-up two cross-species parents
//   2. Run the heartbeat
//   3. Verify a row landed in world_hybrid_creatures with a parseable
//      blueprint JSON containing the fields the Three.js renderer needs
//      (topology, parts, mass, height)
//   4. Verify the GET /api/worlds/:id/hybrids endpoint surfaces it

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runCrossbreedSpawnCycle } from "../emergent/crossbreed-spawn-cycle.js";
import { ensureCrossbreedingTables, recordEncounter } from "../lib/creature-crossbreeding.js";
import createHybridCreaturesRouter from "../routes/hybrid-creatures.js";

let db;
let router;

function buildSchema(d) {
  d.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      x REAL, z REAL,
      is_dead INTEGER DEFAULT 0,
      archetype TEXT,
      species_id TEXT,
      mass_kg REAL,
      height_m REAL,
      topology TEXT,
      state TEXT
    );
    CREATE TABLE world_hybrid_creatures (
      id              TEXT PRIMARY KEY,
      world_id        TEXT NOT NULL,
      x               REAL NOT NULL DEFAULT 0,
      y               REAL NOT NULL DEFAULT 0,
      z               REAL NOT NULL DEFAULT 0,
      blueprint_json  TEXT NOT NULL,
      parent_a        TEXT,
      parent_b        TEXT,
      generation      INTEGER NOT NULL DEFAULT 1,
      stability       REAL NOT NULL DEFAULT 0.5,
      cross_world     INTEGER NOT NULL DEFAULT 0,
      alive           INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  ensureCrossbreedingTables(d);
}

before(() => {
  db = new Database(":memory:");
  buildSchema(db);
  router = createHybridCreaturesRouter({ db });

  // Two creatures of different species in the same world, co-located.
  db.prepare(`INSERT INTO world_npcs (id, world_id, x, z, archetype, species_id, mass_kg, height_m, topology) VALUES
    ('npc_dragon', 'concordia', 10, 10, 'creature:beast', 'dragon',  120, 2.4, 'winged_quadruped'),
    ('npc_wolf',   'concordia', 12, 11, 'creature:beast', 'wolf',     45, 0.9, 'quadruped')
  `).run();

  // Bump bond past threshold (100) via multiple encounters.
  for (let i = 0; i < 40; i++) {
    recordEncounter(db, {
      aId: "npc_dragon", bId: "npc_wolf",
      worldA: "concordia", worldB: "concordia",
      sameEnvironmentBonus: true,
    });
  }
});

after(() => { db?.close(); });

function invoke(path) {
  return new Promise((resolve) => {
    let status = 200, body = null;
    const req = { method: "GET", url: path, headers: {}, params: {} };
    const res = {
      status(c) { status = c; return this; },
      json(b)   { body = b; resolve({ status, body }); },
    };
    router.handle(req, res, () => resolve({ status: 404, body: null }));
  });
}

describe("crossbreed-spawn-cycle — produces 3D-ready hybrid", () => {
  it("heartbeat spawns at least one hybrid when a bond crosses threshold", async () => {
    let emitted = null;
    const realtime = {
      io: {
        to: (room) => ({
          emit: (event, payload) => { emitted = { room, event, payload }; },
        }),
      },
    };

    const r = await runCrossbreedSpawnCycle({ db, realtime });
    assert.equal(r.ok, true);
    assert.ok(r.spawned >= 1, `expected ≥1 spawn, got ${r.spawned} (failures: ${JSON.stringify(r.failures)})`);
    assert.ok(emitted, "realtime emit should fire");
    assert.equal(emitted.event, "world:hybrid-spawned");
    assert.equal(emitted.room, "world:concordia");
    assert.ok(emitted.payload?.blueprint, "emit includes blueprint");
    assert.ok(emitted.payload?.position, "emit includes position");
  });

  it("the persisted hybrid row has a parseable blueprint with topology + parts", () => {
    const row = db.prepare(`SELECT * FROM world_hybrid_creatures WHERE world_id = 'concordia' ORDER BY created_at DESC LIMIT 1`).get();
    assert.ok(row, "hybrid row exists");
    assert.ok(row.id.startsWith("hybrid_"));
    assert.equal(row.alive, 1);
    assert.equal(row.parent_a, "npc_dragon");
    assert.equal(row.parent_b, "npc_wolf");
    assert.ok(row.stability > 0);

    const blueprint = JSON.parse(row.blueprint_json);
    // The Three.js renderer needs these fields. Pin the contract:
    assert.ok(blueprint.topology,         "blueprint.topology");
    assert.ok(blueprint.massKg > 0,       "blueprint.massKg");
    assert.ok(blueprint.heightM > 0,      "blueprint.heightM");
    assert.ok(Array.isArray(blueprint.parts) || typeof blueprint.parts === "object",
      "blueprint.parts (array or object)");
  });

  it("the bond is reset after spawn so the same pair doesn't immediately re-breed", () => {
    const bondRow = db.prepare(`SELECT bond FROM creature_bonds WHERE a_id = ? AND b_id = ?`).get("npc_dragon", "npc_wolf");
    assert.ok(bondRow);
    assert.equal(bondRow.bond, 0);
  });

  it("GET /:worldId/hybrids returns alive hybrids with blueprint", async () => {
    const r = await invoke("/concordia/hybrids");
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(Array.isArray(r.body.hybrids));
    assert.ok(r.body.hybrids.length >= 1);
    const h = r.body.hybrids[0];
    assert.ok(h.id.startsWith("hybrid_"));
    assert.ok(h.position && typeof h.position.x === "number");
    assert.ok(h.blueprint && h.blueprint.topology);
  });

  it("returns empty array for an unknown world (graceful, no 500)", async () => {
    const r = await invoke("/nonsense/hybrids");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.hybrids, []);
  });

  it("kill-switch disables the heartbeat", async () => {
    const prev = process.env.CONCORD_CROSSBREED_SPAWN;
    process.env.CONCORD_CROSSBREED_SPAWN = "0";
    try {
      const r = await runCrossbreedSpawnCycle({ db });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prev == null) delete process.env.CONCORD_CROSSBREED_SPAWN;
      else process.env.CONCORD_CROSSBREED_SPAWN = prev;
    }
  });

  it("never throws when a parent is missing — cleans the bond instead", async () => {
    // Bond two NPCs but only persist one (simulate a dead parent).
    db.prepare(`INSERT INTO world_npcs (id, world_id, x, z, archetype, species_id, mass_kg, height_m, topology) VALUES
      ('npc_alive', 'concordia', 5, 5, 'creature:beast', 'falcon', 8, 0.5, 'winged_biped')
    `).run();
    for (let i = 0; i < 40; i++) {
      recordEncounter(db, { aId: "npc_alive", bId: "npc_ghost", worldA: "concordia", worldB: "concordia" });
    }
    const r = await runCrossbreedSpawnCycle({ db });
    assert.equal(r.ok, true);
    // The dangling bond should be removed.
    const dangling = db.prepare(`SELECT bond FROM creature_bonds WHERE a_id = ? AND b_id = ?`)
      .get("npc_alive", "npc_ghost");
    assert.equal(dangling, undefined, "dangling bond removed");
  });
});
