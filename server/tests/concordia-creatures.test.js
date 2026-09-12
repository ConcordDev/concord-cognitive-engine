// Creature pillar: snapshot of live fauna + lineage, ecology counts,
// and thin creature:born emit from generateHybrid. Empty stays empty.
//
//   cd server && node --test tests/concordia-creatures.test.js

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { snapshotCreatures, snapshotEcology, announceCreatureBorn } from "../lib/concordia-creatures.js";
import { ensureCrossbreedingTables, generateHybrid, recordEncounter } from "../lib/creature-crossbreeding.js";

function fresh() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      world_id TEXT,
      archetype TEXT,
      species_id TEXT,
      x REAL, y REAL, z REAL,
      is_dead INTEGER DEFAULT 0
    );
    CREATE TABLE creature_population (
      id TEXT PRIMARY KEY,
      world_id TEXT,
      biome TEXT,
      species_id TEXT,
      target_count INTEGER,
      current_count INTEGER,
      lifestyle TEXT
    );
  `);
  ensureCrossbreedingTables(db);
  return db;
}

test("snapshotCreatures is empty without fauna rows — never invents a pack", () => {
  const db = fresh();
  assert.deepEqual(snapshotCreatures(db, "concordia-hub"), []);
  assert.deepEqual(snapshotCreatures(null, "concordia-hub"), []);
  assert.deepEqual(snapshotCreatures(db, ""), []);
});

test("snapshotCreatures cards a live fauna row with topology from taxonomy", () => {
  const db = fresh();
  db.prepare(`
    INSERT INTO world_npcs (id, world_id, archetype, species_id, x, y, z, is_dead)
    VALUES ('cr_wolf_1', 'fantasy', 'creature:wolf', 'wolf', 4.2, 0, 3.1, 0)
  `).run();
  const cards = snapshotCreatures(db, "fantasy");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].id, "cr_wolf_1");
  assert.equal(cards[0].speciesId, "wolf");
  assert.equal(cards[0].topology, "quadruped");
  assert.equal(cards[0].x, 4.2);
  assert.equal(cards[0].z, 3.1);
  assert.equal(cards[0].generation, 0);
  assert.equal(cards[0].parentA, null);
});

test("snapshotCreatures joins lineage generation and parents", () => {
  const db = fresh();
  db.prepare(`
    INSERT INTO world_npcs (id, world_id, archetype, species_id, x, y, z, is_dead)
    VALUES ('child_1', 'fantasy', 'creature:wolf', 'wolf', 2, 0, 2, 0)
  `).run();
  db.prepare(`
    INSERT INTO creature_lineage (child_id, parent_a, parent_b, generation, stability, blueprint)
    VALUES ('child_1', 'wolf_a', 'hound_b', 4, 0.7, ?)
  `).run(JSON.stringify({
    id: "child_1",
    worldId: "fantasy",
    topology: "quadruped",
    massKg: 72,
    heightM: 1.1,
    genotype: { dominant: "frost", variant: "ice" },
    gait: { kind: "quadruped", walkMps: 2.4 },
    species_id: "wolf",
  }));
  const cards = snapshotCreatures(db, "fantasy");
  assert.equal(cards.length, 1);
  assert.equal(cards[0].generation, 4);
  assert.equal(cards[0].parentA, "wolf_a");
  assert.equal(cards[0].parentB, "hound_b");
  assert.equal(cards[0].massKg, 72);
  assert.equal(cards[0].dominant, "frost");
  assert.equal(cards[0].variant, "ice");
});

test("snapshotEcology is empty without population rows", () => {
  const db = fresh();
  assert.deepEqual(snapshotEcology(db, "fantasy"), []);
});

test("snapshotEcology reports real counts, not fabricated herds", () => {
  const db = fresh();
  db.prepare(`
    INSERT INTO creature_population (id, world_id, biome, species_id, target_count, current_count, lifestyle)
    VALUES ('p1', 'fantasy', 'forest', 'wolf', 2, 1, 'carnivore')
  `).run();
  const eco = snapshotEcology(db, "fantasy");
  assert.equal(eco.length, 1);
  assert.equal(eco[0].speciesId, "wolf");
  assert.equal(eco[0].count, 1);
  assert.equal(eco[0].target, 2);
  assert.equal(eco[0].biome, "forest");
});

test("announceCreatureBorn emits the hybrid id, never a fabricated child", () => {
  const db = fresh();
  const a = {
    id: "wolf_a", topology: "quadruped", massKg: 80, heightM: 1.4,
    worldId: "fantasy", skillIds: [], abilitySeeds: [],
  };
  const b = {
    id: "hound_b", topology: "quadruped", massKg: 70, heightM: 1.2,
    worldId: "fantasy", skillIds: [], abilitySeeds: [],
  };
  for (let i = 0; i < 25; i++) {
    recordEncounter(db, { aId: a.id, bId: b.id, worldA: "fantasy", worldB: "fantasy" });
  }
  const seen = [];
  const prev = globalThis._concordRealtimeEmit;
  globalThis._concordRealtimeEmit = (event, payload) => seen.push({ event, payload });
  try {
    const r = generateHybrid(db, { a, b, generation: 3 });
    assert.equal(r.ok, true);
    const announced = announceCreatureBorn(r, "fantasy");
    assert.equal(announced.ok, true);
    assert.equal(announced.childId, r.hybrid.id);
  } finally {
    globalThis._concordRealtimeEmit = prev;
  }
  const born = seen.find((s) => s.event === "creature:born");
  assert.ok(born, "hybrid emit is creature:born");
  assert.equal(born.payload.childId.length > 0, true);
  assert.equal(born.payload.generation, 3);
  assert.equal(born.payload.parentA, "wolf_a");
  assert.equal(born.payload.worldId, "fantasy");
  assert.equal(born.payload.topology, "quadruped");
});

test("announceCreatureBorn without emit is an honest no-op", () => {
  const prev = globalThis._concordRealtimeEmit;
  globalThis._concordRealtimeEmit = undefined;
  try {
    const r = announceCreatureBorn({ ok: true, hybrid: { id: "x" }, generation: 1, parents: ["a", "b"] }, "hub");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_emit");
  } finally {
    globalThis._concordRealtimeEmit = prev;
  }
});
