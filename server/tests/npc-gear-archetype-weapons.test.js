// server/tests/npc-gear-archetype-weapons.test.js
//
// Pins the archetype → weapon-class preferences contract. After the
// 2026-05-26 vocabulary expansion, NPCs spawn with category-matched
// weapons (guard → spear/halberd, hunter → longbow, mage → staff) instead
// of generic "Guard Weapon Lv1". The test verifies:
//   1. Every archetype's preference list resolves to canonical
//      WEAPON_CLASS_INFO keys (no orphaned strings)
//   2. The picked item name round-trips through inferWeaponClass —
//      "Hunter's Longbow Lv3" parses back to weapon_class='longbow'
//   3. pickWeaponClassForArchetype is deterministic per npcId
//   4. seedStarterGear writes the weapon_class into the npc_gear.stats
//      JSON so combat / loot / dialogue can read it without re-inferring

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  seedStarterGear,
  pickWeaponClassForArchetype,
  getArchetypeWeaponPreferences,
} from "../lib/npc-gear.js";
import { WEAPON_CLASS_INFO, inferWeaponClass } from "../lib/combat/loadout.js";

let db;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY,
      archetype TEXT,
      wealth_sparks REAL DEFAULT 0,
      gear_level INTEGER DEFAULT 1,
      is_conscious INTEGER DEFAULT 0
    );
    CREATE TABLE npc_gear (
      id TEXT PRIMARY KEY,
      npc_id TEXT NOT NULL,
      slot TEXT,
      item_id TEXT,
      item_name TEXT,
      item_type TEXT,
      gear_level INTEGER,
      stats TEXT,
      equipped INTEGER DEFAULT 1
    );
  `);
});

after(() => { db?.close(); });

describe("pickWeaponClassForArchetype — deterministic per-NPC pick", () => {
  it("same archetype + npcId yields same class on repeat calls", () => {
    const a = pickWeaponClassForArchetype("hunter", "npc_alpha", 1);
    const b = pickWeaponClassForArchetype("hunter", "npc_alpha", 1);
    assert.deepEqual(a, b);
  });

  it("different npcIds may yield different classes (spread across prefs)", () => {
    // Sample 30 npcs — expect >1 distinct class for an archetype with ≥2 prefs
    const seen = new Set();
    for (let i = 0; i < 30; i++) {
      const r = pickWeaponClassForArchetype("hunter", `npc_${i}`, 1);
      seen.add(r.class);
    }
    assert.ok(seen.size > 1, "expected variety across NPCs");
  });

  it("returned class is keyed in WEAPON_CLASS_INFO", () => {
    for (const archetype of ["warrior", "guard", "hunter", "mage", "rogue", "ninja"]) {
      const r = pickWeaponClassForArchetype(archetype, "npc_x", 1);
      assert.ok(WEAPON_CLASS_INFO[r.class], `${archetype} → ${r.class} not in registry`);
    }
  });

  it("item name round-trips through inferWeaponClass", () => {
    // Verifies the readable name a player sees actually resolves to the
    // class we claimed it was.
    for (const archetype of ["warrior", "guard", "hunter", "mage", "soldier", "rogue", "berserker"]) {
      for (let i = 0; i < 10; i++) {
        const r = pickWeaponClassForArchetype(archetype, `npc_${archetype}_${i}`, 2);
        const inferred = inferWeaponClass(r.name);
        assert.equal(inferred.weaponClass, r.class,
          `name="${r.name}" expected class=${r.class}, got ${inferred.weaponClass}`);
      }
    }
  });

  it("unknown archetype falls through to default", () => {
    const r = pickWeaponClassForArchetype("xyzzy", "npc_x", 1);
    assert.ok(r.class, "default returns something");
    assert.ok(WEAPON_CLASS_INFO[r.class]);
  });

  it("level appears in item name", () => {
    const r = pickWeaponClassForArchetype("warrior", "npc_x", 7);
    assert.ok(r.name.includes("Lv7"));
  });
});

describe("ARCHETYPE_WEAPON_CLASSES — registry validation", () => {
  it("every archetype's preferences resolve to canonical classes (after pickaxe-like filter)", () => {
    const archetypes = [
      "warrior", "guard", "guardian", "knight", "soldier", "enforcer",
      "fanatic", "raider", "hunter", "scout", "ranger", "archer",
      "rogue", "assassin", "thief", "ninja", "thug", "predator", "berserker",
      "mage", "mystic", "wizard", "sorcerer", "warlock", "shaman",
      "cleric", "priest", "hacker", "pilot", "engineer", "cyborg",
      "marksman", "gunslinger", "vigilante", "security", "trader",
      "blacksmith", "miner", "farmer", "medic", "scientist",
      "journalist", "entertainer", "citizen", "wanderer",
      "investigator", "official", "default",
    ];
    for (const a of archetypes) {
      const prefs = getArchetypeWeaponPreferences(a);
      assert.ok(Array.isArray(prefs) && prefs.length > 0, `no prefs for "${a}"`);
      const validCount = prefs.filter((c) => WEAPON_CLASS_INFO[c]).length;
      assert.ok(validCount > 0, `archetype "${a}" has no canonical class in prefs ${JSON.stringify(prefs)}`);
    }
  });

  it("category coherence — frontline melee archetypes pick melee weapons", () => {
    // warrior should pick from melee categories, not firearm
    for (let i = 0; i < 20; i++) {
      const r = pickWeaponClassForArchetype("warrior", `w_${i}`, 1);
      const info = WEAPON_CLASS_INFO[r.class];
      assert.ok(info.category.startsWith("melee"),
        `warrior picked ${r.class} (${info.category}), expected melee_*`);
    }
  });

  it("category coherence — hunter picks projectile or short blade", () => {
    for (let i = 0; i < 20; i++) {
      const r = pickWeaponClassForArchetype("hunter", `h_${i}`, 1);
      const info = WEAPON_CLASS_INFO[r.class];
      assert.ok(["projectile", "melee_blade_1h"].includes(info.category),
        `hunter picked ${r.class} (${info.category})`);
    }
  });

  it("category coherence — mage / wizard picks focus", () => {
    for (let i = 0; i < 20; i++) {
      const r = pickWeaponClassForArchetype("mage", `m_${i}`, 1);
      const info = WEAPON_CLASS_INFO[r.class];
      assert.equal(info.category, "focus");
    }
  });

  it("category coherence — soldier picks firearm-heavy", () => {
    const seen = { firearm: 0, other: 0 };
    for (let i = 0; i < 40; i++) {
      const r = pickWeaponClassForArchetype("soldier", `s_${i}`, 1);
      const info = WEAPON_CLASS_INFO[r.class];
      if (info.category === "firearm") seen.firearm++;
      else seen.other++;
    }
    assert.ok(seen.firearm > seen.other,
      `expected mostly firearms for soldier, got ${seen.firearm}/${seen.firearm + seen.other}`);
  });

  it("category coherence — cyborg picks cyberware", () => {
    for (let i = 0; i < 20; i++) {
      const r = pickWeaponClassForArchetype("cyborg", `c_${i}`, 1);
      const info = WEAPON_CLASS_INFO[r.class];
      assert.equal(info.category, "cyberware");
    }
  });
});

describe("seedStarterGear — wires the picked class into npc_gear.stats", () => {
  it("guard gets a polearm/sword/mace weapon with weapon_class in stats", () => {
    db.prepare("INSERT INTO world_npcs (id, archetype) VALUES (?, ?)").run("npc_g1", "guard");
    seedStarterGear(db, "npc_g1", "guard", 1);
    const row = db.prepare(
      "SELECT * FROM npc_gear WHERE npc_id = ? AND slot = 'weapon'"
    ).get("npc_g1");
    assert.ok(row, "weapon row exists");
    const stats = JSON.parse(row.stats);
    assert.ok(stats.weapon_class, "weapon_class stamped in stats");
    assert.ok(WEAPON_CLASS_INFO[stats.weapon_class], "class is canonical");
    const cat = WEAPON_CLASS_INFO[stats.weapon_class].category;
    assert.ok(["melee_polearm", "melee_blade_1h", "melee_blunt_1h", "shield"].includes(cat),
      `guard cat=${cat}`);
  });

  it("hunter gets a projectile weapon and the name resolves back", () => {
    db.prepare("INSERT INTO world_npcs (id, archetype) VALUES (?, ?)").run("npc_h1", "hunter");
    seedStarterGear(db, "npc_h1", "hunter", 3);
    const row = db.prepare(
      "SELECT * FROM npc_gear WHERE npc_id = ? AND slot = 'weapon'"
    ).get("npc_h1");
    const stats = JSON.parse(row.stats);
    const inferred = inferWeaponClass(row.item_name);
    assert.equal(inferred.weaponClass, stats.weapon_class,
      `name="${row.item_name}" name-class=${inferred.weaponClass} stats-class=${stats.weapon_class}`);
    assert.ok(row.item_name.includes("Lv3"));
  });

  it("blacksmith (no 'weapon' slot in ARCHETYPE_SLOTS) seeds only tool+armor", () => {
    db.prepare("INSERT INTO world_npcs (id, archetype) VALUES (?, ?)").run("npc_bs", "blacksmith");
    seedStarterGear(db, "npc_bs", "blacksmith", 1);
    const rows = db.prepare(
      "SELECT slot FROM npc_gear WHERE npc_id = ?"
    ).all("npc_bs");
    const slots = rows.map((r) => r.slot).sort();
    assert.deepEqual(slots, ["armor", "tool"]);
  });

  it("same NPC re-seeded gets the same weapon_class (deterministic)", () => {
    db.prepare("INSERT INTO world_npcs (id, archetype) VALUES (?, ?)").run("npc_stable", "warrior");
    seedStarterGear(db, "npc_stable", "warrior", 1);
    const first = db.prepare(
      "SELECT stats FROM npc_gear WHERE npc_id = ? AND slot = 'weapon'"
    ).get("npc_stable");
    const firstClass = JSON.parse(first.stats).weapon_class;
    // Subsequent picks return the same class (deterministic from npcId).
    const pick = pickWeaponClassForArchetype("warrior", "npc_stable", 1);
    assert.equal(pick.class, firstClass, "same npcId → same class across calls");
  });
});
