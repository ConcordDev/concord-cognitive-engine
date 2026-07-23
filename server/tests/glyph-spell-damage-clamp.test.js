/**
 * REQUIRED — server-authoritative glyph-spell damage clamp (PR #868 Residual 2).
 *
 * A minted glyph spell writes a real `max_damage` into player_glyph_spells.
 * The socket `combat:attack` path looks that number up (owner-scoped, by pgs id
 * OR recipe_dtu_id) and passes it into clampBaseDamage(requested, skillMax) +
 * resolvedDamageCap(skillMax). This pins that an inflated client baseDamage is
 * capped at the ACTUAL minted max_damage, that the lookup is owner-scoped, and
 * that a missing table / unknown id degrades to the shared hard cap.
 *
 * Run: node --test tests/glyph-spell-damage-clamp.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate136 } from "../migrations/136_player_glyph_spells.js";
import { seedDefaultGlyphLibrary, mintSpell } from "../lib/glyph-spells.js";
import { lookupGlyphSpellMaxDamage } from "../lib/combat/glyph-spell-cap.js";
import {
  clampBaseDamage,
  resolvedDamageCap,
  COMBAT_DAMAGE_HARD_CAP,
  COMBAT_DAMAGE_CRIT_MULT,
} from "../lib/combat-limits.js";

function freshDb() {
  const db = new Database(":memory:");
  migrate136(db);
  // Minimal dtus table matching mintSpell's INSERT column list.
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, type TEXT, title TEXT, creator_id TEXT,
      data TEXT, skill_level INTEGER, total_experience INTEGER, created_at INTEGER
    );
  `);
  seedDefaultGlyphLibrary(db);
  return db;
}

function mintOne(db, userId) {
  // flame_seed + ember_breath → a real composed max_damage > 0.
  const res = mintSpell(db, {
    userId, worldId: "concordia-hub",
    componentIds: ["g_flame_seed", "g_ember_breath"],
    name: "test fireball",
  });
  assert.equal(res.ok, true, `mintSpell failed: ${JSON.stringify(res)}`);
  const stored = db.prepare(`SELECT max_damage, recipe_dtu_id FROM player_glyph_spells WHERE id = ?`).get(res.spellId);
  assert.ok(Number(stored.max_damage) > 0, "minted spell has a positive max_damage");
  return { spellId: res.spellId, recipeId: res.recipeId, maxDamage: Number(stored.max_damage) };
}

describe("glyph-spell damage clamp", () => {
  it("caps an inflated client baseDamage at the minted max_damage", () => {
    const db = freshDb();
    const { recipeId, maxDamage } = mintOne(db, "user_a");
    const lookup = lookupGlyphSpellMaxDamage(db, "user_a", recipeId);
    assert.equal(lookup, maxDamage);
    // Inflated 9999 → clamped to the real minted ceiling.
    assert.equal(clampBaseDamage(9999, lookup), maxDamage);
    // Resolved (post-crit) cap is max_damage × crit mult, not the 500 hard cap.
    assert.equal(resolvedDamageCap(lookup), maxDamage * COMBAT_DAMAGE_CRIT_MULT);
    assert.ok(maxDamage * COMBAT_DAMAGE_CRIT_MULT < COMBAT_DAMAGE_HARD_CAP);
  });

  it("resolves by BOTH the pgs id and the recipe_dtu_id", () => {
    const db = freshDb();
    const { spellId, recipeId, maxDamage } = mintOne(db, "user_a");
    assert.equal(lookupGlyphSpellMaxDamage(db, "user_a", spellId), maxDamage);
    assert.equal(lookupGlyphSpellMaxDamage(db, "user_a", recipeId), maxDamage);
  });

  it("is owner-scoped — another user's spell grants nothing → hard cap", () => {
    const db = freshDb();
    const { recipeId } = mintOne(db, "user_a");
    // user_b names user_a's spell id: no owned row → 0 → hard cap applies.
    assert.equal(lookupGlyphSpellMaxDamage(db, "user_b", recipeId), 0);
    assert.equal(clampBaseDamage(9999, 0), COMBAT_DAMAGE_HARD_CAP);
    assert.equal(resolvedDamageCap(0), COMBAT_DAMAGE_HARD_CAP);
  });

  it("returns 0 for an unknown id (→ falls back to the hard cap)", () => {
    const db = freshDb();
    mintOne(db, "user_a");
    assert.equal(lookupGlyphSpellMaxDamage(db, "user_a", "nope-not-a-spell"), 0);
    assert.equal(clampBaseDamage(9999, 0), COMBAT_DAMAGE_HARD_CAP);
  });

  it("never throws on a DB without the player_glyph_spells table", () => {
    const bare = new Database(":memory:");
    assert.equal(lookupGlyphSpellMaxDamage(bare, "user_a", "anything"), 0);
    // and bad inputs
    assert.equal(lookupGlyphSpellMaxDamage(null, "u", "s"), 0);
    assert.equal(lookupGlyphSpellMaxDamage(bare, "", ""), 0);
  });
});
