/**
 * #13 — cross-world env coupling on glyph_spells.cast potency.
 *
 * A spell's potency must follow the DESTINATION world's live environment the
 * same way the combat route does (routes/worlds.js applies elementalEnvBoost to
 * skill damage). Before the fix the cast wrote env FEEDBACK but never read the
 * env BOOST, so an ice spell hit identically in a frozen world and a scorching
 * one. This seeds real thermal signals in two worlds and pins that the same ice
 * spell is amplified in the cold and damped in the heat.
 *
 * Run: node --test tests/glyph-spells-env-coupling.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import { recordSignal } from "../lib/embodied/signals.js";
import registerGlyphSpellMacros from "../domains/glyph-spells.js";

function loadMacros() {
  const macros = new Map();
  registerGlyphSpellMacros((domain, name, fn) => macros.set(`${domain}.${name}`, fn));
  return macros;
}

async function dbForWorld(worldId, tempC) {
  const db = new Database(":memory:");
  await runMigrations(db);
  db.prepare(`
    INSERT INTO player_glyph_spells
      (id, user_id, world_id, recipe_dtu_id, composed_glyph, component_chain,
       element, max_damage, range_m, stamina_cost, mana_cost, cooldown_s, composed_at)
    VALUES ('s1','owner',?,'dtu1','⟐⊚','["g_frost_seal"]','ice',10,5,1,2,0.5,0)
  `).run(worldId);
  // Seed an absolute thermal baseline at the cast cell (source 'sensor').
  recordSignal(db, {
    worldId, x: 0, z: 0,
    channel: "thermal_os.ambient_temp",
    value: tempC, source: "sensor", ttlSeconds: 3600,
  });
  return db;
}

const cast = (macros, db, worldId) =>
  macros.get("glyph_spells.cast")({ db, actor: { userId: "owner" } }, { spellId: "s1", worldId, x: 0, z: 0, magnitude: 1 });

test("ice spell is amplified (1.5x) in a frozen world", async () => {
  const db = await dbForWorld("frost-realm", -5);
  const r = await cast(loadMacros(), db, "frost-realm");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.envBoost, 1.5, "ice at t<2 → elementalEnvBoost 1.5x");
});

test("ice spell is damped (0.5x) in a scorching world", async () => {
  const db = await dbForWorld("ember-waste", 35);
  const r = await cast(loadMacros(), db, "ember-waste");
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.envBoost, 0.5, "ice at t>28 → elementalEnvBoost 0.5x");
});

test("effective magnitude composes crossWorld x env boost", async () => {
  const db = await dbForWorld("frost-realm", -5);
  const r = await cast(loadMacros(), db, "frost-realm");
  // magnitude === requestedMagnitude × crossWorldMultiplier × envBoost
  const expected = r.requestedMagnitude * r.crossWorldMultiplier * r.envBoost;
  assert.ok(Math.abs(r.magnitude - expected) < 1e-6, `magnitude ${r.magnitude} != ${expected}`);
});

test("no signal baseline → env boost degrades to 1.0 (world not penalised)", async () => {
  const db = new Database(":memory:");
  await runMigrations(db);
  db.prepare(`
    INSERT INTO player_glyph_spells
      (id, user_id, world_id, recipe_dtu_id, composed_glyph, component_chain,
       element, max_damage, range_m, stamina_cost, mana_cost, cooldown_s, composed_at)
    VALUES ('s1','owner','bare','dtu1','⟐⊚','["g_frost_seal"]','ice',10,5,1,2,0.5,0)
  `).run();
  const r = await cast(loadMacros(), db, "bare");
  assert.equal(r.ok, true);
  assert.equal(r.envBoost, 1.0);
});
