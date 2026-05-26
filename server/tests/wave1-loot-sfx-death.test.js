// server/tests/wave1-loot-sfx-death.test.js
//
// Pins the Wave 1 contract: when an NPC dies, the simulation produces three
// distinct presentation hooks for the frontend to render:
//   1. world:loot-dropped — death_loot_bag forked from npc_gear with
//      weapon_class + rarity preserved
//   2. world:npc-death    — emitted at the same time, drives ragdoll VFX
//   3. claim-loot path    — inserts into player_inventory with weapon_class
//      and world_id preserved (so the looted item infers correctly downstream)
//
// The combat:hit-sfx emit (T1.4) is wired in the route layer; its shape is
// exercised by combat-realtime-emits.test.js indirectly. This file focuses
// on the NPC-death pipeline.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { triggerNPCDeath } from "../lib/npc-consequences.js";
import { dropNpcGearAsLoot, rollNpcGearLoot, claimLootBag } from "../lib/pvp-loot.js";

let db;

function buildSchema(d) {
  d.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      archetype TEXT, faction TEXT, name TEXT, family_name TEXT,
      x REAL DEFAULT 0, y REAL DEFAULT 0, z REAL DEFAULT 0,
      is_dead INTEGER DEFAULT 0, died_at INTEGER, killer_id TEXT,
      is_conscious INTEGER DEFAULT 0, is_immortal INTEGER DEFAULT 0,
      home_dtu_id TEXT, disrepair_level REAL DEFAULT 0
    );
    CREATE TABLE npc_gear (
      id TEXT PRIMARY KEY, npc_id TEXT NOT NULL, slot TEXT,
      item_id TEXT, item_name TEXT, item_type TEXT,
      gear_level INTEGER DEFAULT 1, stats TEXT,
      equipped INTEGER DEFAULT 1
    );
    CREATE TABLE death_loot_bags (
      id TEXT PRIMARY KEY, world_id TEXT, x REAL, y REAL, z REAL,
      owner_id TEXT, killer_id TEXT, sparks INTEGER DEFAULT 0,
      items_json TEXT, expires_at INTEGER, created_at INTEGER DEFAULT (unixepoch()),
      claimed_by TEXT, claimed_at INTEGER
    );
    CREATE TABLE npc_deaths (
      id TEXT PRIMARY KEY, npc_id TEXT, world_id TEXT,
      killer_id TEXT, consequence TEXT, created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY, sparks INTEGER DEFAULT 0
    );
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_type TEXT, item_id TEXT,
      item_name TEXT, quantity INTEGER DEFAULT 1, quality INTEGER DEFAULT 50,
      world_id TEXT DEFAULT 'concordia-hub', weapon_class TEXT,
      handedness TEXT DEFAULT 'either'
    );
    CREATE TABLE sparks_ledger (
      id TEXT PRIMARY KEY, user_id TEXT, delta INTEGER, reason TEXT,
      world_id TEXT, created_at INTEGER DEFAULT (unixepoch())
    );
  `);
}

before(() => {
  db = new Database(":memory:");
  buildSchema(db);

  // Seed a Lv5 (rare-tier) hunter NPC with a Crossbow equipped.
  db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, z) VALUES
    ('npc_hunter', 'concordia', 'hunter', 10, 12)
  `).run();
  db.prepare(`INSERT INTO npc_gear (id, npc_id, slot, item_id, item_name, item_type, gear_level, stats, equipped) VALUES
    ('g_xbow', 'npc_hunter', 'weapon', 'hunter-crossbow-lv5', 'Rare Hunter''s Crossbow Lv5', 'weapon', 5,
     '{"damage":25,"speed":5,"weapon_class":"crossbow","rarity":"rare","rarity_color":"#3b82f6"}', 1)
  `).run();
  // Also seed an armor row so we cover the multi-slot path.
  db.prepare(`INSERT INTO npc_gear (id, npc_id, slot, item_id, item_name, item_type, gear_level, stats, equipped) VALUES
    ('g_armor', 'npc_hunter', 'armor', 'hunter-armor-lv5', 'Rare Hunter Armor Lv5', 'armor', 5,
     '{"defense":25,"hp":50,"rarity":"rare","rarity_color":"#3b82f6"}', 1)
  `).run();

  // Seed a player for the claim path.
  db.prepare(`INSERT INTO users (id, sparks) VALUES ('player_1', 0)`).run();
});

after(() => { db?.close(); });

describe("Wave 1 — NPC death pipeline", () => {
  it("rollNpcGearLoot at high level (Lv5) usually drops both slots", () => {
    // Lv5 → 60% per slot. Over 20 rolls, expect at least one drop with both
    // weapon and armor present at least once.
    let sawWeapon = false, sawArmor = false;
    for (let i = 0; i < 20; i++) {
      const items = rollNpcGearLoot(db, "npc_hunter");
      if (items.some((it) => it.weapon_class === "crossbow")) sawWeapon = true;
      if (items.some((it) => it.item_type === "armor")) sawArmor = true;
    }
    assert.ok(sawWeapon, "Lv5 weapon slot should drop at least once in 20 rolls");
    assert.ok(sawArmor,  "Lv5 armor slot should drop at least once in 20 rolls");
  });

  it("dropNpcGearAsLoot creates a death_loot_bag with rarity-tagged items", () => {
    let attempt = null;
    // Loop until at least one item rolls (probabilistic; bounded retries).
    for (let i = 0; i < 30 && !attempt; i++) {
      const npc = db.prepare(`SELECT * FROM world_npcs WHERE id = 'npc_hunter'`).get();
      const r = dropNpcGearAsLoot(db, { npc, killerId: "player_1", x: 10, z: 12, worldId: "concordia" });
      if (r && r.items.length > 0) attempt = r;
    }
    assert.ok(attempt, "drop should succeed within 30 attempts at Lv5 60% prob");
    assert.ok(attempt.items.length >= 1, "at least one item");
    for (const it of attempt.items) {
      assert.ok(it.rarity, "rarity stamped");
      assert.ok(it.rarity_color, "rarity_color stamped");
    }
    const bag = db.prepare(`SELECT * FROM death_loot_bags WHERE id = ?`).get(attempt.bagId);
    assert.ok(bag, "bag persisted");
    assert.equal(bag.world_id, "concordia");
    assert.equal(bag.killer_id, "player_1");
  });

  it("claim transfers items into player_inventory with weapon_class + world_id preserved", () => {
    // Find an unclaimed bag from the previous test that has a weapon item.
    const allBags = db.prepare(`SELECT * FROM death_loot_bags WHERE claimed_by IS NULL`).all();
    let chosen = null;
    for (const b of allBags) {
      const items = JSON.parse(b.items_json);
      if (items.some((it) => it.weapon_class === "crossbow")) { chosen = b; break; }
    }
    assert.ok(chosen, "should have a bag with a crossbow drop from previous test");
    // The bag is owned by the NPC; claimer is the killer (player_1). The
    // killer-priority window is 2 min — we're well within it.
    const r = claimLootBag(db, { bagId: chosen.id, claimerId: "player_1" });
    assert.equal(r.ok, true, `claim should succeed: ${JSON.stringify(r)}`);

    const inv = db.prepare(`SELECT * FROM player_inventory WHERE user_id = 'player_1'`).all();
    assert.ok(inv.length >= 1, "at least one item in inventory");
    const xbow = inv.find((i) => i.weapon_class === "crossbow");
    assert.ok(xbow, "crossbow landed with weapon_class set");
    assert.equal(xbow.world_id, "concordia", "world_id preserved");
  });

  it("triggerNPCDeath emits world:loot-dropped + world:npc-death", async () => {
    // Fresh NPC for an isolated death cycle.
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, z) VALUES
      ('npc_target', 'concordia', 'warrior', 20, 20)
    `).run();
    db.prepare(`INSERT INTO npc_gear (id, npc_id, slot, item_id, item_name, item_type, gear_level, stats, equipped) VALUES
      ('g_t_sword', 'npc_target', 'weapon', 'warrior-greatsword-lv9', 'Legendary Warrior''s Greatsword Lv9', 'weapon', 9,
       '{"damage":45,"speed":9,"weapon_class":"greatsword","rarity":"legendary","rarity_color":"#f59e0b"}', 1)
    `).run();

    const emits = [];
    const realtimeEmit = (event, payload) => emits.push({ event, payload });

    const r = await triggerNPCDeath(db, "npc_target", "player_1", realtimeEmit);
    assert.equal(r.died, true);

    const deathEmit = emits.find((e) => e.event === "world:npc-death");
    assert.ok(deathEmit, "world:npc-death emitted");
    assert.equal(deathEmit.payload.npcId, "npc_target");
    assert.ok(deathEmit.payload.position, "position present for ragdoll spawn");
    assert.ok(deathEmit.payload.impulse, "impulse present for ragdoll spawn");

    // At Lv9 the drop probability is 90% — bag should almost always exist.
    // Run until it does (bounded so the test isn't flaky).
    let lootEmit = emits.find((e) => e.event === "world:loot-dropped");
    if (!lootEmit) {
      // Retry up to 5 fresh deaths.
      for (let i = 0; i < 5 && !lootEmit; i++) {
        const id = `npc_t_${i}`;
        db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, x, z) VALUES (?, 'concordia', 'warrior', 20, 20)`).run(id);
        db.prepare(`INSERT INTO npc_gear (id, npc_id, slot, item_id, item_name, item_type, gear_level, stats, equipped) VALUES
          (?, ?, 'weapon', 'warrior-greatsword-lv9', 'Legendary Warrior''s Greatsword Lv9', 'weapon', 9,
           '{"damage":45,"speed":9,"weapon_class":"greatsword","rarity":"legendary","rarity_color":"#f59e0b"}', 1)
        `).run(`g_${i}`, id);
        emits.length = 0;
        await triggerNPCDeath(db, id, "player_1", realtimeEmit);
        lootEmit = emits.find((e) => e.event === "world:loot-dropped");
      }
    }
    assert.ok(lootEmit, "world:loot-dropped emitted at Lv9 90% probability");
    assert.ok(lootEmit.payload.bagId);
    assert.ok(Array.isArray(lootEmit.payload.items));
    assert.ok(lootEmit.payload.items.length >= 1);
    const sword = lootEmit.payload.items.find((it) => it.weapon_class === "greatsword");
    assert.ok(sword, "the greatsword surfaces in the emit");
    assert.equal(sword.rarity, "legendary");
  });

  it("immortal NPCs do not emit death / loot", async () => {
    db.prepare(`INSERT INTO world_npcs (id, world_id, archetype, is_immortal, x, z)
      VALUES ('npc_god', 'concordia', 'guardian', 1, 50, 50)`).run();
    const emits = [];
    const r = await triggerNPCDeath(db, "npc_god", "player_1", (ev, p) => emits.push({ ev, p }));
    assert.equal(r.died, false);
    assert.equal(r.reason, "immortal");
    assert.equal(emits.length, 0, "no emits for immortal NPC");
  });
});
