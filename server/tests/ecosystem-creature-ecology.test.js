// Animal Kingdom — the systemic behaviour wired into tickFlock:
// cross-species predator awareness (prey bolt), predation kills, and the
// off-switch (CONCORD_CREATURE_ECOLOGY=0 → pure boids, no kills).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { tickFlock } from "../lib/ecosystem/creature-behaviors.js";

function db0() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, species_id TEXT,
      x REAL, y REAL, z REAL, is_dead INTEGER DEFAULT 0, level INTEGER DEFAULT 1
    );
  `);
  return db;
}
const addCreature = (db, id, species, x, z) =>
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, species_id, x, y, z, is_dead, level)
              VALUES (?, 'w1', ?, ?, ?, 0, ?, 0, 1)`).run(id, `creature:${species}`, species, x, z);

test("prey bolts from a sensed predator (cross-species awareness)", () => {
  const db = db0();
  addCreature(db, "wolf1", "wolf", 0, 0);
  addCreature(db, "deer1", "deer", 5, 0); // within PREDATOR_SENSE_R (16m)
  const state = {};
  const r = tickFlock(db, state, "w1", { ecology: true });
  assert.equal(r.ok, true);
  const deer = db.prepare(`SELECT x FROM world_npcs WHERE id = 'deer1'`).get();
  // The deer should have moved AWAY from the predator at the origin → larger x.
  assert.ok(deer.x > 5, `deer fled the predator (x ${deer.x} > 5)`);
});

test("a hungry predator on top of prey it eats makes a kill", () => {
  const db = db0();
  addCreature(db, "wolf1", "wolf", 10, 10);
  addCreature(db, "deer1", "deer", 10, 10); // overlapping → caught
  // Seed the wolf's hunger high so it's actively hunting this pass.
  const state = { creatureMotion: { w1: { wolf1: { vx: 0, vz: 0, needs: { hunger: 0.6 } } } } };
  const r = tickFlock(db, state, "w1", { ecology: true });
  assert.ok(r.kills >= 1, "predation occurred");
  const deer = db.prepare(`SELECT is_dead FROM world_npcs WHERE id = 'deer1'`).get();
  assert.equal(deer.is_dead, 1, "prey was killed");
  assert.equal(r.killed[0].predatorSpecies, "wolf");
  assert.equal(r.killed[0].preySpecies, "deer");
});

test("ecology OFF is the pure boids path — no predation, no kills", () => {
  const db = db0();
  addCreature(db, "wolf1", "wolf", 10, 10);
  addCreature(db, "deer1", "deer", 10, 10);
  const state = { creatureMotion: { w1: { wolf1: { vx: 0, vz: 0, needs: { hunger: 0.9 } } } } };
  const r = tickFlock(db, state, "w1", { ecology: false });
  assert.equal(r.ok, true);
  assert.equal(r.kills, 0, "no kills when ecology disabled");
  const deer = db.prepare(`SELECT is_dead FROM world_npcs WHERE id = 'deer1'`).get();
  assert.equal(deer.is_dead, 0, "prey survives — pure boids never predate");
});

test("predator never eats a peer predator (no cannibal kills)", () => {
  const db = db0();
  addCreature(db, "wolf1", "wolf", 0, 0);
  addCreature(db, "bear1", "bear", 0, 0); // both carnivores, overlapping
  const state = { creatureMotion: { w1: {
    wolf1: { vx: 0, vz: 0, needs: { hunger: 0.9 } },
    bear1: { vx: 0, vz: 0, needs: { hunger: 0.9 } },
  } } };
  const r = tickFlock(db, state, "w1", { ecology: true });
  assert.equal(r.kills, 0, "carnivores don't predate each other");
});
