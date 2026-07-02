/**
 * #12 — sanctuary/safe-zone gate on glyph_spells.cast.
 *
 * A spell cast lands in the world like an attack. The /combat/attack route
 * refuses combat in a 'safe'/'sanctuary' zone (routes/worlds.js → combatRuleFor);
 * the spell macro previously did NOT, so a fire spell succeeded in the
 * no-violence hub while a melee attack at the same spot 403'd. This drives the
 * REAL macro against a REAL world_zones sanctuary to pin the fixed gate.
 *
 * Run: node --test tests/glyph-spells-sanctuary-gate.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up136 } from "../migrations/136_player_glyph_spells.js";
import { up as up262 } from "../migrations/262_world_zones.js";
import registerGlyphSpellMacros from "../domains/glyph-spells.js";

function loadMacros() {
  const macros = new Map();
  registerGlyphSpellMacros((domain, name, fn) => macros.set(`${domain}.${name}`, fn));
  return macros;
}

function seededDb() {
  const db = new Database(":memory:");
  up136(db);
  up262(db);
  // A sanctuary centred at (0,0), radius 100.
  db.prepare(`
    INSERT INTO world_zones (id, world_id, name, kind, center_x, center_z, radius_m, rules_json)
    VALUES ('z1','w','Quiet Grove','sanctuary',0,0,100,'{}')
  `).run();
  db.prepare(`
    INSERT INTO player_glyph_spells
      (id, user_id, world_id, recipe_dtu_id, composed_glyph, component_chain,
       element, max_damage, range_m, stamina_cost, mana_cost, cooldown_s, composed_at)
    VALUES ('s1','owner','w','dtu1','⟲⊚','["g_flame_seed"]','fire',10,5,1,2,0.5,0)
  `).run();
  return db;
}

const cast = (macros, db, x, z) =>
  macros.get("glyph_spells.cast")({ db, actor: { userId: "owner" } }, { spellId: "s1", worldId: "w", x, z });

test("cast INSIDE a sanctuary is refused (zone_combat_refusal)", async () => {
  const db = seededDb();
  const r = await cast(loadMacros(), db, 0, 0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "zone_combat_refusal");
  assert.equal(r.zone?.kind, "sanctuary");
  // The gate returns before the cast creates its spell_cast_log table, so a
  // refused cast leaves no trace at all.
  const hasLog = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='spell_cast_log'").get();
  assert.equal(hasLog, undefined, "a refused cast must not even create the log table");
});

test("cast OUTSIDE the sanctuary succeeds", async () => {
  const db = seededDb();
  // (9999,9999) is far outside the radius-100 circle → world default (allowed).
  const r = await cast(loadMacros(), db, 9999, 9999);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.element, "fire");
});

test("no world_zones table → world default (cast allowed)", async () => {
  const db = new Database(":memory:");
  up136(db);
  db.prepare(`
    INSERT INTO player_glyph_spells
      (id, user_id, world_id, recipe_dtu_id, composed_glyph, component_chain,
       element, max_damage, range_m, stamina_cost, mana_cost, cooldown_s, composed_at)
    VALUES ('s1','owner','w','dtu1','⟲⊚','["g_flame_seed"]','fire',10,5,1,2,0.5,0)
  `).run();
  const r = await cast(loadMacros(), db, 0, 0);
  assert.equal(r.ok, true, "no zone table must degrade to allowed, never crash");
});
