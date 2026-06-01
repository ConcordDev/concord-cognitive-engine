// Animal Kingdom — the systemic behaviour wired into tickFlock:
// cross-species predator awareness (prey bolt), predation kills, and the
// off-switch (CONCORD_CREATURE_ECOLOGY=0 → pure boids, no kills).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { tickFlock } from "../lib/ecosystem/creature-behaviors.js";
import { _diurnalModifier } from "../lib/ecosystem/fauna-spawner.js";

function db0() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, species_id TEXT,
      x REAL, y REAL, z REAL, is_dead INTEGER DEFAULT 0, level INTEGER DEFAULT 1
    );
    CREATE TABLE creature_corpses (
      id TEXT PRIMARY KEY, world_id TEXT, species_id TEXT, killer_user_id TEXT,
      x REAL, y REAL, z REAL, claimed INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()), expires_at INTEGER DEFAULT (unixepoch() + 1800)
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

test("a predation kill leaves a carcass (the scavenge loop's food)", () => {
  const db = db0();
  addCreature(db, "wolf1", "wolf", 10, 10);
  addCreature(db, "deer1", "deer", 10, 10);
  const state = { creatureMotion: { w1: { wolf1: { vx: 0, vz: 0, needs: { hunger: 0.6 } } } } };
  const r = tickFlock(db, state, "w1", { ecology: true });
  assert.ok(r.kills >= 1);
  const corpse = db.prepare(`SELECT species_id, killer_user_id FROM creature_corpses WHERE world_id='w1'`).get();
  assert.ok(corpse, "a carcass was left at the kill");
  assert.equal(corpse.species_id, "deer");
  assert.equal(corpse.killer_user_id, null, "NPC kill — no player killer");
});

test("a hungry scavenger feeds on a nearby carcass + claims it", () => {
  const db = db0();
  addCreature(db, "owl1", "archive_owl", 10, 10); // a scavenger
  db.prepare(`INSERT INTO creature_corpses (id, world_id, species_id, x, y, z, claimed) VALUES ('c1','w1','deer',10,0,10,0)`).run();
  const state = { creatureMotion: { w1: { owl1: { vx: 0, vz: 0, needs: { hunger: 0.8 } } } } };
  const r = tickFlock(db, state, "w1", { ecology: true });
  assert.ok(r.scavenged >= 1, "scavenger fed");
  assert.equal(db.prepare(`SELECT claimed FROM creature_corpses WHERE id='c1'`).get().claimed, 1, "carcass consumed");
});

test("day/night spawn gating: nocturnal swells in dark, thins in daylight", () => {
  // archive_owl is nocturnal.
  assert.ok(_diurnalModifier("archive_owl", { light: 1000 }) > 1, "owl swells at night");
  assert.ok(_diurnalModifier("archive_owl", { light: 80000 }) < 1, "owl thins in daylight");
  // hawk is diurnal.
  assert.ok(_diurnalModifier("hawk", { light: 80000 }) > 1, "hawk swells by day");
  assert.ok(_diurnalModifier("hawk", { light: 1000 }) < 1, "hawk thins at night");
  // neutral species + no signal → 1.0.
  assert.equal(_diurnalModifier("deer", { light: 1000 }), 1.0);
  assert.equal(_diurnalModifier("archive_owl", null), 1.0);
});
