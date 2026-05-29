/**
 * D4 #3 — procedural NPCs now join the existing gear economy on spawn, so they
 * are visually distinct (gear_level + archetype loadout) AND drop loot on death
 * via the existing kill-path loot generator (which reads getNPCGear). Before
 * this the spawner skipped seedStarterGear and the bulk of the population had
 * 0 gear / 0 loot.
 *
 * Run: node --test tests/procedural-npc-gear.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up061 } from "../migrations/061_npc_gear_and_knowledge.js";
import { up as up139 } from "../migrations/139_procedural_npcs.js";
import { generateNpc, persistGeneratedNpc } from "../lib/npc-generator.js";
import { getNPCGear } from "../lib/npc-gear.js";

function setupDb() {
  const db = new Database(":memory:");
  // world_npcs with exactly the columns persistGeneratedNpc inserts; migration
  // 061 then adds gear_level/wealth_sparks (guarded ALTER) + the npc_gear table
  // (FK → world_npcs.id). 139 adds procedural_npcs.
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT, archetype TEXT, faction TEXT, level INTEGER,
      x REAL, z REAL, current_location TEXT, spawn_location TEXT, state TEXT, is_dead INTEGER DEFAULT 0
    );
  `);
  up061(db); up139(db);
  return db;
}

describe("D4#3 — procedural NPC gear on spawn", () => {
  it("persistGeneratedNpc seeds gear rows + sets gear_level", () => {
    const db = setupDb();
    const npc = generateNpc({ factionId: "iron_wardens", seed: "g1", worldId: "concordia-hub", level: 20 });
    const r = persistGeneratedNpc(db, npc);
    assert.equal(r.ok, true);

    const gear = getNPCGear(db, npc.id);
    assert.ok(gear.length > 0, "expected the NPC to carry gear rows");

    const wn = db.prepare(`SELECT gear_level FROM world_npcs WHERE id = ?`).get(npc.id);
    assert.ok(wn.gear_level >= 1, "expected gear_level set on world_npcs");
  });

  it("gear level scales with NPC level (a level-40 NPC outgears a level-5 one)", () => {
    const db = setupDb();
    const lowNpc = generateNpc({ factionId: "iron_wardens", seed: "low", worldId: "w", level: 5 });
    const highNpc = generateNpc({ factionId: "iron_wardens", seed: "high", worldId: "w", level: 40 });
    persistGeneratedNpc(db, lowNpc);
    persistGeneratedNpc(db, highNpc);
    const lowLvl = db.prepare(`SELECT gear_level FROM world_npcs WHERE id = ?`).get(lowNpc.id).gear_level;
    const highLvl = db.prepare(`SELECT gear_level FROM world_npcs WHERE id = ?`).get(highNpc.id).gear_level;
    assert.ok(highLvl > lowLvl, `expected ${highLvl} > ${lowLvl}`);
  });

  it("seeded gear is the substrate the kill-path loot generator reads", () => {
    const db = setupDb();
    const npc = generateNpc({ factionId: "merchant_collective", seed: "loot", worldId: "w", level: 15 });
    persistGeneratedNpc(db, npc);
    // getNPCGear is exactly what routes/worlds.js:895 passes to generateNPCLoot
    // on death — non-empty here means a procedural NPC now yields loot.
    const gear = getNPCGear(db, npc.id);
    assert.ok(gear.length > 0);
    assert.ok(gear.every((g) => g.gear_level >= 1));
  });
});
