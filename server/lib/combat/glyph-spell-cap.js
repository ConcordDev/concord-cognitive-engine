// server/lib/combat/glyph-spell-cap.js
//
// Server-authoritative damage ceiling for MINTED GLYPH SPELLS. When a
// combat:attack names a spell the caller composed (glyph-spells.js#mintSpell
// wrote a `player_glyph_spells` row with a real `max_damage`), that stored
// number — not anything the client sends — is the ceiling for the hit. This
// lets the socket combat path pass the spell's max_damage into
// clampBaseDamage(requested, skillMax) + resolvedDamageCap(skillMax), so a
// modified client can't inflate a fireball past what was actually minted.
//
// Owner-scoped: the lookup matches only rows owned by `userId`, so one user's
// spell id grants nothing to another user. Missing table / bad input / any DB
// error degrades to 0 → the caller falls back to the shared 500 hard cap
// (unchanged pre-existing behavior). Never throws.

/**
 * The stored max_damage for a caller-owned glyph spell, matched by either the
 * player_glyph_spells row id OR its recipe_dtu_id (the frontend surfaces the
 * DTU id, so both must resolve). Returns a positive finite number, else 0.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {string} skillId  the attack's declared skillId (spell id or recipe DTU id)
 * @returns {number} max_damage > 0, or 0 when not a known owned spell
 */
export function lookupGlyphSpellMaxDamage(db, userId, skillId) {
  if (!db || !userId || !skillId) return 0;
  try {
    const row = db.prepare(`
      SELECT max_damage
      FROM player_glyph_spells
      WHERE user_id = ? AND (id = ? OR recipe_dtu_id = ?)
      LIMIT 1
    `).get(String(userId), String(skillId), String(skillId));
    const md = Number(row?.max_damage);
    return Number.isFinite(md) && md > 0 ? md : 0;
  } catch {
    // missing table (minimal build) / bad input → neutral pass-through
    return 0;
  }
}
