// server/tests/character-sheet-route.test.js
//
// Pins the GET /api/character-sheet/me response shape: loadout (categorised
// per weapon), spells (school + element), powers (superpower-shaped skills),
// skills (every other skill bucketed by category). Schema mirror + handler
// invocation — runs without booting the server.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import createCharacterSheetRouter from "../routes/character-sheet.js";

let db;
let router;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      item_name TEXT,
      item_type TEXT,
      weapon_class TEXT,
      handedness TEXT,
      quality TEXT,
      world_id TEXT DEFAULT 'concordia-hub'
    );
    CREATE TABLE player_equipment (
      user_id TEXT PRIMARY KEY,
      right_hand_id TEXT,
      left_hand_id  TEXT,
      head_id       TEXT,
      body_id       TEXT,
      accessory_id  TEXT,
      updated_at    INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE player_glyph_spells (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT,
      element TEXT,
      max_damage REAL,
      range_m REAL,
      composed_glyph TEXT,
      component_chain TEXT,
      mana_cost REAL,
      stamina_cost REAL,
      cooldown_s REAL,
      created_at INTEGER
    );
    CREATE TABLE player_skill_levels (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      skill_type TEXT NOT NULL,
      native_world_type TEXT NOT NULL,
      level INTEGER DEFAULT 0,
      xp INTEGER DEFAULT 0,
      xp_to_next INTEGER DEFAULT 100,
      last_used_at INTEGER
    );
  `);

  // Seed: user U1 with a scythe (right hand) + a shotgun in inventory,
  // a frost spell, super_strength + flight (powers), combat + crafting skills.
  db.prepare(`INSERT INTO player_inventory VALUES (?,?,?,?,?,?,?,?)`)
    .run("inv_scythe", "U1", "war scythe", "weapon", null, null, "rare", "concordia-hub");
  db.prepare(`INSERT INTO player_inventory VALUES (?,?,?,?,?,?,?,?)`)
    .run("inv_shotgun", "U1", "Mossberg shotgun", "weapon", null, null, "common", "concordia-hub");
  db.prepare(`INSERT INTO player_equipment (user_id, right_hand_id, left_hand_id) VALUES (?,?,?)`)
    .run("U1", "inv_scythe", "inv_scythe"); // two-handed
  db.prepare(`INSERT INTO player_glyph_spells VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("spell_frost", "U1", "frost spike", "ice", 12, 8, "⟐⊚", "[]", 3, 1, 1, 1000);
  // "xyzzy weave" — no element keyword in name, stored element not in registry
  // → fully amorphous.
  db.prepare(`INSERT INTO player_glyph_spells VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run("spell_invent", "U1", "xyzzy weave", "made_up_element", 8, 6, "⟲⟐", "[]", 2, 1, 1, 1001);
  db.prepare(`INSERT INTO player_skill_levels VALUES (?,?,?,?,?,?,?,?)`)
    .run("sk1", "U1", "superhero flight", "concordia", 5, 250, 500, 1000);
  db.prepare(`INSERT INTO player_skill_levels VALUES (?,?,?,?,?,?,?,?)`)
    .run("sk2", "U1", "super strength", "concordia", 7, 450, 500, 1000);
  db.prepare(`INSERT INTO player_skill_levels VALUES (?,?,?,?,?,?,?,?)`)
    .run("sk3", "U1", "combat training", "concordia", 12, 800, 1000, 1000);
  db.prepare(`INSERT INTO player_skill_levels VALUES (?,?,?,?,?,?,?,?)`)
    .run("sk4", "U1", "smithing", "concordia", 3, 100, 500, 1000);

  router = createCharacterSheetRouter({
    db,
    requireAuth: (req, _res, next) => { req.user = { id: "U1" }; next(); },
  });
});

after(() => { db?.close(); });

// Minimal request/response shim
function invoke(path) {
  return new Promise((resolve) => {
    let status = 200, body = null;
    const req = { method: "GET", url: path, headers: {}, user: null };
    const res = {
      status(c) { status = c; return this; },
      json(b)   { body = b; resolve({ status, body }); },
    };
    router.handle(req, res, () => resolve({ status: 404, body: null }));
  });
}

describe("GET /api/character-sheet/me", () => {
  it("returns the four-section sheet shape", async () => {
    const r = await invoke("/me");
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(r.body.sheet, "sheet present");
    assert.ok("loadout" in r.body.sheet);
    assert.ok("spells" in r.body.sheet);
    assert.ok("powers" in r.body.sheet);
    assert.ok("skills" in r.body.sheet);
  });

  it("decorates loadout with weapon_class + category from taxonomy", async () => {
    const { body } = await invoke("/me");
    const right = body.sheet.loadout.rightHand;
    assert.equal(right.weapon_class, "scythe");
    assert.equal(right.category, "melee_blade_2h");
    assert.equal(right.handedness, "two");
    assert.equal(right.reach_m, 3.0);
  });

  it("decorates spells with element category + school", async () => {
    const { body } = await invoke("/me");
    const frost = body.sheet.spells.find((s) => s.id === "spell_frost");
    assert.equal(frost.element, "ice");
    assert.equal(frost.element_category, "elemental");
    // "frost spike" doesn't match any spell-school regex, but its element resolves.
    assert.ok("school" in frost);
  });

  it("flags player-invented spell elements as amorphous", async () => {
    const { body } = await invoke("/me");
    const invented = body.sheet.spells.find((s) => s.id === "spell_invent");
    // element="amorphous_element" isn't in ELEMENT_INFO; name "solar phase weave"
    // also doesn't match any element regex → flagged as amorphous (no category).
    assert.equal(invented.amorphous, true);
  });

  it("separates powers from skills via inferPowerType", async () => {
    const { body } = await invoke("/me");
    const flightPower = body.sheet.powers.find((p) => p.skill_type === "superhero flight");
    const strengthPower = body.sheet.powers.find((p) => p.skill_type === "super strength");
    assert.ok(flightPower, "flight in powers");
    assert.equal(flightPower.power, "flight");
    assert.equal(flightPower.power_category, "movement");
    assert.ok(strengthPower, "strength in powers");
    assert.equal(strengthPower.power, "super_strength");
  });

  it("bucket non-power skills by category", async () => {
    const { body } = await invoke("/me");
    const combatSkill = body.sheet.skills.find((s) => s.skill_type === "combat training");
    const smithingSkill = body.sheet.skills.find((s) => s.skill_type === "smithing");
    assert.equal(combatSkill?.skill_category, "combat");
    assert.equal(smithingSkill?.skill_category, "crafting");
  });

  it("rejects unauthenticated callers", async () => {
    const r2 = createCharacterSheetRouter({
      db,
      requireAuth: (_req, res) => res.status(401).json({ ok: false, error: "no_auth" }),
    });
    const result = await new Promise((resolve) => {
      let status = 200;
      const req = { method: "GET", url: "/me", headers: {}, user: null };
      const res = {
        status(c) { status = c; return this; },
        json(b)   { resolve({ status, body: b }); },
      };
      r2.handle(req, res, () => resolve({ status: 404, body: null }));
    });
    assert.equal(result.status, 401);
    assert.equal(result.body.ok, false);
  });
});
