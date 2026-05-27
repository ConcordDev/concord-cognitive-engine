// server/tests/wave-a-user-profile.test.js
//
// Wave A / A3 — pins the user_player_profiles compilation contract.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  compileProfile, getProfile, activitySignature, _internal,
} from "../lib/user-player-profile.js";
import { runUserProfileCompilerCycle } from "../emergent/user-profile-compiler-cycle.js";

let db;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE user_player_profiles (
      user_id TEXT PRIMARY KEY,
      dialogue_signature TEXT,
      lineage_summary TEXT,
      playstyle_json TEXT,
      gift_preferences_json TEXT,
      last_compiled_at INTEGER,
      activity_signature TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      skill_type TEXT NOT NULL, native_world_type TEXT NOT NULL,
      level INTEGER DEFAULT 0, xp INTEGER DEFAULT 0,
      xp_to_next INTEGER DEFAULT 100, last_used_at INTEGER
    );
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      item_type TEXT, item_id TEXT, item_name TEXT,
      quantity INTEGER DEFAULT 1, quality INTEGER DEFAULT 50,
      world_id TEXT DEFAULT 'concordia-hub',
      weapon_class TEXT, handedness TEXT
    );
    CREATE TABLE player_glyph_spells (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      name TEXT, element TEXT, max_damage REAL,
      range_m REAL, composed_glyph TEXT, component_chain TEXT,
      mana_cost REAL, stamina_cost REAL, cooldown_s REAL, created_at INTEGER
    );
    CREATE TABLE skill_demonstration_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, caster_user_id TEXT, witnessed_npc_id TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
  `);

  // Seed: a player heavy in ice + scythe wielding + legendary rarity.
  const uid = "U1";
  db.prepare(`INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level, xp) VALUES
    ('s1', ?, 'combat', 'concordia', 12, 800),
    ('s2', ?, 'magical', 'concordia', 8, 400),
    ('s3', ?, 'movement', 'concordia', 3, 100)
  `).run(uid, uid, uid);
  // 5 items: 2 scythes, 1 legendary, 2 epic
  db.prepare(`INSERT INTO player_inventory (id, user_id, item_type, item_id, item_name, quality, weapon_class) VALUES
    ('i1', ?, 'weapon', 'sc_a', 'Scythe', 95, 'scythe'),
    ('i2', ?, 'weapon', 'sc_b', 'Scythe', 75, 'scythe'),
    ('i3', ?, 'weapon', 'sw_a', 'Sword',  72, 'sword'),
    ('i4', ?, 'weapon', 'sg_a', 'Shotgun', 55, 'shotgun'),
    ('i5', ?, 'tool',   'h_a',  'Hammer',  40, 'hammer')
  `).run(uid, uid, uid, uid, uid);
  // 3 spells, all ice
  db.prepare(`INSERT INTO player_glyph_spells (id, user_id, name, element, max_damage) VALUES
    ('sp1', ?, 'frost spike', 'ice', 12),
    ('sp2', ?, 'frost wall',  'ice', 8),
    ('sp3', ?, 'frost dance', 'ice', 15)
  `).run(uid, uid, uid);
  // 6 demonstrations
  for (let i = 0; i < 6; i++) {
    db.prepare(`INSERT INTO skill_demonstration_log (caster_user_id, witnessed_npc_id) VALUES (?, ?)`)
      .run(uid, `npc_${i}`);
  }
});

after(() => { db?.close(); });

describe("compileProfile", () => {
  it("compiles a row + lineage summary that reflects the input", () => {
    const r = compileProfile(db, "U1");
    assert.equal(r.ok, true);
    const p = getProfile(db, "U1");
    assert.ok(p);
    assert.ok(p.dialogueSignature.length > 0);
    assert.ok(p.dialogueSignature.length <= 240);
    assert.ok(p.lineageSummary.includes("ice"));
    assert.ok(p.lineageSummary.includes("scythe"));
    assert.ok(p.lineageSummary.includes("teaches via demonstration"),
      `expected demonstration mention, got: "${p.lineageSummary}"`);
  });

  it("playstyle reflects the dominant element + weapon class", () => {
    const p = getProfile(db, "U1");
    assert.equal(p.playstyle.dominantElement, "ice");
    assert.equal(p.playstyle.weaponClassTop, "scythe");
    assert.deepEqual(Object.keys(p.playstyle.rarityHistogram).sort(),
      ["common", "epic", "legendary", "rare", "uncommon"]);
    assert.equal(p.playstyle.rarityHistogram.legendary, 1);
    assert.ok(p.playstyle.topSkills.length === 3);
  });

  it("gift preferences include the dominant element", () => {
    const p = getProfile(db, "U1");
    assert.ok(p.giftPrefs.preferredElements.includes("ice"));
    assert.ok(["legendary", "epic", "rare"].includes(p.giftPrefs.preferredRarity));
  });

  it("rejects missing args", () => {
    assert.equal(compileProfile(db, null).ok, false);
    assert.equal(compileProfile(null, "U1").ok, false);
  });
});

describe("activitySignature", () => {
  it("changes when the user gains a skill", () => {
    const before = activitySignature(db, "U1");
    db.prepare(`INSERT INTO player_skill_levels (id, user_id, skill_type, native_world_type, level, xp) VALUES
      ('s_new', 'U1', 'crafting', 'concordia', 1, 0)
    `).run();
    const after = activitySignature(db, "U1");
    assert.notEqual(before, after);
  });
});

describe("compiler cycle", () => {
  it("compiles users whose signature differs", async () => {
    db.prepare(`DELETE FROM user_player_profiles`).run();
    const r = await runUserProfileCompilerCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.compiled >= 1);
    const p = getProfile(db, "U1");
    assert.ok(p);
  });

  it("skips users compiled recently with unchanged activity", async () => {
    // U1 was just compiled; re-running should mostly skip.
    const r = await runUserProfileCompilerCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.skipped >= 1 || r.compiled === 0,
      "expected to skip or no-op when signature unchanged");
  });

  it("respects kill switch", async () => {
    process.env.CONCORD_USER_PROFILE_COMPILER = "0";
    try {
      const r = await runUserProfileCompilerCycle({ db });
      assert.equal(r.reason, "disabled");
    } finally { delete process.env.CONCORD_USER_PROFILE_COMPILER; }
  });
});

describe("internal composition (deterministic)", () => {
  it("dialogue signature is short + non-empty", () => {
    const sig = _internal._composeDialogueSignature({
      topSkills: [{ skill_type: "combat", level: 12 }, { skill_type: "magical", level: 8 }],
      dominantElement: "ice",
      weaponClassTop: "scythe",
      rarityHistogram: { legendary: 1, epic: 2 },
      demonstrations: 6,
    });
    assert.ok(sig.length > 0 && sig.length <= 240);
    assert.ok(sig.includes("ice"));
  });
});
