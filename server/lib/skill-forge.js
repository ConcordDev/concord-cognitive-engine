// server/lib/skill-forge.js
//
// WAVE L1 — the dead-simple skill on-ramp (the playtester fix: "creating moves
// shouldn't be complicated"). The advanced GlyphSpellComposer (2–5 glyph compose)
// stays for power users; this is the starter flow surfaced through the Concord
// Link Forge tab: pick an ELEMENT + an INTENT (strike/bolt/ward/dash) + a name →
// the forge selects the two starter glyphs and mints a usable spell_recipe via
// the existing glyph-spells engine. No new spell math — pure selection + reuse.
// Behind CONCORD_SKILL_FORGE.

import { seedDefaultGlyphLibrary, mintSpell } from "./glyph-spells.js";

export function skillForgeEnabled() { return process.env.CONCORD_SKILL_FORGE === "1"; }

// element → its primary starter glyph (seeded DEFAULT_GLYPH_LIBRARY ids).
const ELEMENT_GLYPH = {
  fire: "g_flame_seed", ice: "g_frost_seal", water: "g_river_step", lightning: "g_lightning_arc",
  bio: "g_loam_breath", energy: "g_focus_lens", physical: "g_stone_anchor", psychic: "g_silent_step",
  refusal: "g_refusal_mark",
};
// intent/shape → the second glyph that gives the move its form.
const INTENT_GLYPH = {
  strike: "g_stone_anchor", // grounded melee
  bolt: "g_focus_lens",     // focused ranged
  ward: "g_frost_seal",     // defensive
  dash: "g_river_step",     // mobility
};
const FALLBACK_SECOND = "g_focus_lens";

export const ELEMENTS = Object.freeze(Object.keys(ELEMENT_GLYPH));
export const INTENTS = Object.freeze(Object.keys(INTENT_GLYPH));

/**
 * Forge a starter skill from an element + intent. Idempotently ensures the glyph
 * library exists, picks the two starter glyphs, and mints through glyph-spells.
 * @returns the mintSpell result ({ ok, spellId?, name?, ... }) or { ok:false, reason }.
 */
export function quickForge(db, { userId, worldId, element, intent, name } = {}) {
  if (!db || !userId || !worldId) return { ok: false, reason: "missing_inputs" };
  try { seedDefaultGlyphLibrary(db); } catch { /* library best-effort */ }

  const el = ELEMENT_GLYPH[element] ? element : "fire";
  const it = INTENT_GLYPH[intent] ? intent : "bolt";
  const primary = ELEMENT_GLYPH[el];
  let second = INTENT_GLYPH[it];
  // glyph-spells needs ≥2 DISTINCT components; if element-primary == intent-glyph,
  // swap the second for a distinct fallback so the minimum is met.
  if (second === primary) second = (FALLBACK_SECOND === primary ? "g_stone_anchor" : FALLBACK_SECOND);
  const componentIds = [primary, second];

  const spellName = (name && String(name).trim()) || `${el[0].toUpperCase()}${el.slice(1)} ${it}`;
  return mintSpell(db, { userId, worldId, componentIds, name: spellName });
}
