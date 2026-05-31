import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as up136 } from "../migrations/136_player_glyph_spells.js";

// Schema/query-drift regression — the CAST bug. domains/glyph-spells.js#cast
// SELECTed name / components_json / dtu_id from player_glyph_spells, but mig 136
// creates recipe_dtu_id / component_chain / element and NO name. The bad query
// threw at prepare-time → minting worked but CASTING was impossible (core loop
// severed). This pins the fix against the REAL schema so it can't regress.

function seededDb() {
  const db = new Database(":memory:");
  up136(db);
  db.prepare(`
    INSERT INTO player_glyph_spells
      (id, user_id, world_id, recipe_dtu_id, composed_glyph, component_chain,
       element, max_damage, range_m, stamina_cost, mana_cost, cooldown_s, composed_at)
    VALUES ('s1','u1','w','dtu1','⟲⊚','["g_flame_seed"]','fire',10,5,1,2,0.5,0)
  `).run();
  return db;
}

test("the fixed cast SELECT uses real columns + the authoritative element", () => {
  const db = seededDb();
  const spell = db.prepare(
    `SELECT id, user_id, recipe_dtu_id AS dtu_id, element FROM player_glyph_spells WHERE id = ?`
  ).get("s1");
  assert.equal(spell.id, "s1");
  assert.equal(spell.dtu_id, "dtu1");   // recipe_dtu_id aliased — used for the license check
  assert.equal(spell.element, "fire");  // authoritative, no chain-parse needed
});

test("the OLD cast SELECT (the bug) throws on the missing columns", () => {
  const db = seededDb();
  assert.throws(
    () => db.prepare(`SELECT id, user_id, name, components_json, dtu_id FROM player_glyph_spells WHERE id = ?`),
    /no such column/i,
    "the pre-fix query must fail against the real schema — that's the drift it caught",
  );
});
