/**
 * Persistent organisms: genome/person → field → consequence → remains.
 *
 *   cd server && node --test tests/concordia-organism.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { up as up416 } from "../migrations/416_world_consequences.js";
import { fieldCenter } from "../lib/concordia-world-field.js";
import {
  ORGANISM_LOOPS,
  speciesById,
  preyOf,
  organismInField,
  sharedWorldSurface,
  explainOrganism,
  recordOrganismDeath,
  recordOrganismBirth,
} from "../lib/concordia-organism.js";
import { listConsequences } from "../lib/world-consequence.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function mkDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, name TEXT, archetype TEXT,
      npc_type TEXT, state TEXT, is_dead INTEGER DEFAULT 0
    );
  `);
  up416(db);
  return db;
}

describe("two loops, one world", () => {
  it("creature and person loops are named and meet at the field", () => {
    assert.deepEqual(ORGANISM_LOOPS.creature, [
      "genome", "organism", "ecology", "civilization", "history", "presentation",
    ]);
    assert.deepEqual(ORGANISM_LOOPS.person, [
      "person", "needs", "action", "consequence", "memory", "place", "history", "presentation",
    ]);
    const f = fieldCenter("fantasy");
    const surface = sharedWorldSurface(f.x, f.z);
    const stalker = organismInField({
      kind: "creature", speciesId: "gloom_stalker", originWorldId: "fantasy", x: f.x, z: f.z, nativeStrength: 70,
    });
    const person = organismInField({
      kind: "person", personId: "asha", originWorldId: "fantasy", x: f.x, z: f.z, nativeStrength: 40,
    });
    assert.equal(surface.ok, true);
    assert.equal(stalker.ok, true);
    assert.equal(person.ok, true);
    assert.equal(stalker.field.dominant, person.field.dominant);
    assert.equal(stalker.localPhysics.magic, person.localPhysics.magic);
    assert.equal(stalker.loop[stalker.loop.length - 1], "presentation");
    assert.equal(person.loop[person.loop.length - 1], "presentation");
  });
});

describe("Gloom Stalker is a catalog organism, not a fabricated spawn", () => {
  it("unknown species is not_found, not a made-up beast", () => {
    const r = speciesById("definitely_not_a_dragon_we_invented");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "unknown_species");
  });

  it("authored gloom_stalker keeps empty prey rather than inventing a hunting list", () => {
    const cat = speciesById("gloom_stalker", "fantasy");
    assert.equal(cat.ok, true);
    assert.equal(cat.species.worldId, "fantasy");
    assert.match(cat.species.description, /fear/i);
    const authored = JSON.parse(readFileSync(join(root, "content/world/fantasy/creatures.json"), "utf8"));
    const row = authored.find((c) => c.id === "gloom_stalker");
    assert.equal(row.prey, undefined);
    assert.deepEqual(preyOf("gloom_stalker"), []);
    const f = fieldCenter("fantasy");
    const o = organismInField({
      kind: "creature", speciesId: "gloom_stalker", originWorldId: "fantasy", x: f.x, z: f.z,
    });
    assert.deepEqual(o.prey, []);
    assert.equal(o.pack, null);
    assert.equal(o.territory, null);
    const why = explainOrganism({
      kind: "creature", speciesId: "gloom_stalker", originWorldId: "fantasy", x: f.x, z: f.z,
    });
    assert.match(why.because, /Prey is unknown/);
    assert.doesNotMatch(why.because, /isolated targets/);
  });

  it("bare gloom_stalker id is ambiguous across authored worlds", () => {
    const r = speciesById("gloom_stalker");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "ambiguous_species");
    assert.ok(r.worlds.includes("fantasy"));
    assert.ok(r.worlds.includes("sovereign-ruins"));
  });

  it("the same stalker is weaker in Crime than in Fantasy — the field changed under it", () => {
    const home = fieldCenter("fantasy");
    const crime = fieldCenter("crime");
    const atHome = organismInField({
      kind: "creature", speciesId: "gloom_stalker", originWorldId: "fantasy",
      x: home.x, z: home.z, nativeStrength: 80, domain: "magic",
    });
    const abroad = organismInField({
      kind: "creature", speciesId: "gloom_stalker", originWorldId: "fantasy",
      x: crime.x, z: crime.z, nativeStrength: 80, domain: "magic",
    });
    assert.ok(atHome.habitatFitness > 0.85, `home habitat ${atHome.habitatFitness}`);
    assert.ok(abroad.habitatFitness < 0.15, `crime habitat ${abroad.habitatFitness}`);
    assert.ok(abroad.geographic.effective < atHome.geographic.effective);
    assert.equal(atHome.species.topologyHint, abroad.species.topologyHint);
  });
});

describe("death remains; birth does not mint a fake body", () => {
  it("killing a creature tombstones the row and writes the graph", () => {
    const db = mkDb();
    db.prepare(`
      INSERT INTO world_npcs (id, world_id, name, archetype, is_dead)
      VALUES ('gst_1', 'fantasy', 'Gloom Stalker', 'creature', 0)
    `).run();
    const r = recordOrganismDeath(db, {
      worldId: "fantasy",
      actorKind: "player",
      actorId: "p1",
      targetId: "gst_1",
      speciesId: "gloom_stalker",
      kind: "creature",
    });
    assert.equal(r.ok, true);
    assert.equal(r.deleted, false);
    assert.equal(r.stillPresent, true);
    const row = db.prepare(`SELECT is_dead FROM world_npcs WHERE id = 'gst_1'`).get();
    assert.equal(row.is_dead, 1);
    const kills = listConsequences(db, { action: "kill", worldId: "fantasy" });
    assert.equal(kills.length, 1);
    assert.equal(kills[0].longTerm.deleted, false);
  });

  it("birth without an id is missing_id, not a spawned anonymous cub", () => {
    const db = mkDb();
    const r = recordOrganismBirth(db, { worldId: "fantasy", speciesId: "gloom_stalker" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_id");
    const n = db.prepare(`SELECT COUNT(*) AS n FROM world_npcs`).get().n;
    assert.equal(n, 0);
  });
});

describe("fauna-spawner still tops up anonymous counts (W8, not claimed)", () => {
  it("the live spawner is a population quota, not organism identity", () => {
    const src = readFileSync(join(root, "server/lib/ecosystem/fauna-spawner.js"), "utf8");
    assert.match(src, /tops up/);
    assert.match(src, /archetype='creature'/);
    assert.match(src, /not organism identity/);
    assert.doesNotMatch(src, /from ["'].*concordia-organism/);
  });
});
