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
  rarityForLevel,
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

describe("ARCHETYPE_WEAPON_TIERS — registry validation", () => {
  it("every archetype has tier bands at all 5 levels with canonical classes", () => {
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
      for (const lv of [1, 3, 5, 7, 9]) {
        const prefs = getArchetypeWeaponPreferences(a, lv);
        assert.ok(Array.isArray(prefs) && prefs.length > 0, `no prefs for "${a}" lv${lv}`);
        const validCount = prefs.filter((c) => WEAPON_CLASS_INFO[c]).length;
        assert.ok(validCount > 0, `"${a}" lv${lv} has no canonical class in ${JSON.stringify(prefs)}`);
      }
    }
  });

  it("category coherence — warrior stays melee_* across all tiers", () => {
    for (const lv of [1, 3, 5, 7, 9]) {
      for (let i = 0; i < 10; i++) {
        const r = pickWeaponClassForArchetype("warrior", `w_${lv}_${i}`, lv);
        const info = WEAPON_CLASS_INFO[r.class];
        assert.ok(info.category.startsWith("melee"),
          `warrior lv${lv} picked ${r.class} (${info.category})`);
      }
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

  it("category coherence — cyborg picks cyberware at lv5+ (apprentices start fist/knuckles)", () => {
    // Lv1 cyborg has unchromed humanoid kit (gauntlet/knuckles), so we test
    // the higher-tier band where the implants actually unlock.
    for (let i = 0; i < 20; i++) {
      const r = pickWeaponClassForArchetype("cyborg", `c_${i}`, 5);
      const info = WEAPON_CLASS_INFO[r.class];
      assert.ok(["cyberware", "fist", "firearm"].includes(info.category),
        `cyborg lv5 ${r.class} (${info.category})`);
    }
    // At lv9, fully chromed — cyberware-only.
    for (let i = 0; i < 20; i++) {
      const r = pickWeaponClassForArchetype("cyborg", `c9_${i}`, 9);
      const info = WEAPON_CLASS_INFO[r.class];
      assert.equal(info.category, "cyberware", `cyborg lv9 ${r.class}`);
    }
  });
});

describe("Class progression — tiers grow with level", () => {
  it("warrior — high-tier levels pull from 2H / polearm pool, novice from club/mace", () => {
    const noviceCats = new Set();
    const eliteCats = new Set();
    for (let i = 0; i < 50; i++) {
      noviceCats.add(WEAPON_CLASS_INFO[pickWeaponClassForArchetype("warrior", `w_${i}`, 1).class].category);
      eliteCats.add(WEAPON_CLASS_INFO[pickWeaponClassForArchetype("warrior", `w_${i}`, 9).class].category);
    }
    // At lv1 only blunt_1h. At lv9 the pool includes blade_2h / exotic / polearm.
    assert.ok(noviceCats.has("melee_blunt_1h"));
    assert.ok(
      eliteCats.has("melee_blade_2h") || eliteCats.has("melee_exotic") || eliteCats.has("melee_polearm"),
      `lv9 warrior should reach 2H/exotic/polearm pool; saw ${[...eliteCats].join(",")}`,
    );
    // And novice never reaches the elite-only classes.
    assert.ok(
      !noviceCats.has("melee_blade_2h") && !noviceCats.has("melee_exotic"),
      `lv1 warrior should not reach 2H/exotic; saw ${[...noviceCats].join(",")}`,
    );
  });

  it("hunter — novice uses sling/shortbow, elite reaches sniper/longbow", () => {
    const novices = new Set();
    const elites = new Set();
    for (let i = 0; i < 50; i++) {
      novices.add(pickWeaponClassForArchetype("hunter", `h_${i}`, 1).class);
      elites.add(pickWeaponClassForArchetype("hunter", `h_${i}`, 9).class);
    }
    assert.ok(novices.has("sling") || novices.has("shortbow"));
    assert.ok(elites.has("longbow") || elites.has("sniper"));
    assert.ok(!novices.has("sniper"), "novice hunter shouldn't get a sniper rifle");
  });

  it("soldier — novice has pistol/club, elite has rpg/anti_material", () => {
    const novices = new Set();
    const elites = new Set();
    for (let i = 0; i < 50; i++) {
      novices.add(pickWeaponClassForArchetype("soldier", `s_${i}`, 1).class);
      elites.add(pickWeaponClassForArchetype("soldier", `s_${i}`, 9).class);
    }
    assert.ok(novices.has("pistol") || novices.has("club"));
    assert.ok(elites.has("rpg") || elites.has("anti_material") || elites.has("sniper"));
    assert.ok(!novices.has("rpg") && !novices.has("anti_material"));
  });

  it("mage — novice uses wand/rod, elite reaches staff/grimoire/crystal", () => {
    const novices = new Set();
    const elites = new Set();
    for (let i = 0; i < 50; i++) {
      novices.add(pickWeaponClassForArchetype("mage", `m_${i}`, 1).class);
      elites.add(pickWeaponClassForArchetype("mage", `m_${i}`, 9).class);
    }
    assert.ok(novices.has("wand") || novices.has("rod"));
    assert.ok(elites.has("staff") || elites.has("grimoire") || elites.has("crystal"));
  });

  it("tier-gating is sharp at level boundaries (3 / 5 / 7 / 9)", () => {
    // soldier at lv4 should NOT have access to elite-only sniper/rpg.
    let elite4 = 0;
    for (let i = 0; i < 100; i++) {
      const c = pickWeaponClassForArchetype("soldier", `b_${i}`, 4).class;
      if (c === "sniper" || c === "rpg" || c === "anti_material" || c === "lmg") elite4++;
    }
    assert.equal(elite4, 0, "lv4 soldier should never roll elite-tier classes");
    // soldier at lv7 SHOULD reach sniper/lmg sometimes.
    let elite7 = 0;
    for (let i = 0; i < 100; i++) {
      const c = pickWeaponClassForArchetype("soldier", `b_${i}`, 7).class;
      if (c === "sniper" || c === "lmg") elite7++;
    }
    assert.ok(elite7 > 0, "lv7 soldier should sometimes roll elite-tier classes");
  });
});

describe("Rarity ladder — grows with level", () => {
  it("rarityForLevel maps levels to canonical buckets", () => {
    assert.equal(rarityForLevel(1).key,  "common");
    assert.equal(rarityForLevel(2).key,  "common");
    assert.equal(rarityForLevel(3).key,  "uncommon");
    assert.equal(rarityForLevel(4).key,  "uncommon");
    assert.equal(rarityForLevel(5).key,  "rare");
    assert.equal(rarityForLevel(6).key,  "rare");
    assert.equal(rarityForLevel(7).key,  "epic");
    assert.equal(rarityForLevel(8).key,  "epic");
    assert.equal(rarityForLevel(9).key,  "legendary");
    assert.equal(rarityForLevel(10).key, "legendary");
  });

  it("pick emits the matching rarity for the level", () => {
    const r1 = pickWeaponClassForArchetype("warrior", "npc_x", 1);
    assert.equal(r1.rarityKey, "common");
    assert.equal(r1.rarity, "Common");
    assert.match(r1.name, /^Common /);
    const r9 = pickWeaponClassForArchetype("warrior", "npc_x", 9);
    assert.equal(r9.rarityKey, "legendary");
    assert.equal(r9.rarity, "Legendary");
    assert.match(r9.name, /^Legendary /);
  });

  it("rarity color is a hex string", () => {
    for (const lv of [1, 3, 5, 7, 9]) {
      const r = rarityForLevel(lv);
      assert.match(r.color, /^#[0-9a-f]{6}$/i, `${lv}: ${r.color}`);
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
    assert.equal(stats.rarity, "uncommon", "lv3 → uncommon rarity stamped");
    assert.ok(stats.rarity_color, "rarity color present");
  });

  it("seeded weapon level → rarity stamp matches the ladder", () => {
    const cases = [
      [1, "common"], [3, "uncommon"], [5, "rare"], [7, "epic"], [9, "legendary"],
    ];
    for (const [level, expectedKey] of cases) {
      const id = `npc_rarity_${level}`;
      db.prepare("INSERT INTO world_npcs (id, archetype) VALUES (?, ?)").run(id, "warrior");
      seedStarterGear(db, id, "warrior", level);
      const row = db.prepare("SELECT * FROM npc_gear WHERE npc_id = ? AND slot = 'weapon'").get(id);
      const stats = JSON.parse(row.stats);
      assert.equal(stats.rarity, expectedKey, `lv${level} → ${expectedKey}, got ${stats.rarity}`);
    }
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
