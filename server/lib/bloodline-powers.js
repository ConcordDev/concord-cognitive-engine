// server/lib/bloodline-powers.js
//
// Concordia Phase 2 — bloodline → element power table + dilution
// gating.
//
// The 10 authored Tunyan cultures each map to one or more elemental
// preferences. The combat path consults this table in
// routes/worlds.js#/combat/attack to compute a multiplier that
// runs AFTER the anti-cheat damage cap (so a client-side bug can't
// stack with bloodline boost to bypass the cap) and AFTER the Layer
// 7.5 environmental boost (env is universal; bloodline is per-actor).
//
// Decision matrix in getBloodlineMultiplier:
//
//   Matched bloodline (skill element in BLOODLINE_ELEMENTS[bloodline]):
//     dilution < 0.30 → 1.20 (pure, full bloodline expression)
//     dilution < 0.60 → 1.00 (mildly diluted, no bonus or penalty)
//     dilution < 0.90 → 0.60 (heavily diluted, weak variant)
//     dilution ≥ 0.90 → 0.00 (faded — refused, must opt out of power)
//
//   Mismatched bloodline (off-element):
//     any dilution    → 0.85 (off-bloodline penalty, never refused)
//
//   No ancestry row OR element=none/null:
//     → 1.00 (neutral pass-through; preserves pre-Phase-2 combat)
//
// Element naming matches existing skill records + Layer 7.5
// elementalEnvBoost: fire, water, ice, lightning, bio, poison, energy,
// physical, force, heal. The 'heal' element is non-damaging — combat
// path doesn't currently invoke it but the table is kept symmetric
// for future health-skill routes.

import logger from "../logger.js";

const BLOODLINE_ELEMENTS = Object.freeze({
  sanguire:     ["fire", "lightning"],
  medici:       ["heal", "bio", "water"],
  sahm:         ["physical", "precision"],
  iron_warden:  ["physical", "force"],
  akeia:        ["water", "ice"],
  kree:         ["fire", "energy"],
  asbir:        ["lightning", "energy"],
  dinye:        ["energy", "force"],
  aekon:        ["ice", "force"],
  fluxom:       ["poison", "bio"],
});

const BLOODLINE_DESCRIPTIONS = Object.freeze({
  sanguire:     "fire-bloodline, descended from the Sangree founders",
  medici:       "healing-bloodline, from the crash-site survivors",
  sahm:         "precision-bloodline of the diaspora",
  iron_warden:  "force-bloodline of the brawler clans",
  akeia:        "water-bloodline of the matriarchy",
  kree:         "fire-energy nationalists",
  asbir:        "lightning-bloodline of the closed Bloc",
  dinye:        "energy-bloodline of the closed Bloc",
  aekon:        "ice-bloodline of the closed Bloc",
  fluxom:       "poison-bloodline of the brutal territories",
});

const MULTIPLIER_PURE_MATCH   = 1.20;
const MULTIPLIER_MILD_MATCH   = 1.00;
const MULTIPLIER_WEAK_MATCH   = 0.60;
const MULTIPLIER_MISMATCH     = 0.85;
const MULTIPLIER_NEUTRAL      = 1.00;
const DILUTION_PURE_UPPER     = 0.30;
const DILUTION_MILD_UPPER     = 0.60;
const DILUTION_WEAK_UPPER     = 0.90;

export const KNOWN_BLOODLINES = Object.freeze(Object.keys(BLOODLINE_ELEMENTS));

export function isKnownBloodline(bloodlineId) {
  return typeof bloodlineId === "string" && bloodlineId in BLOODLINE_ELEMENTS;
}

export function elementsForBloodline(bloodlineId) {
  return BLOODLINE_ELEMENTS[bloodlineId] || [];
}

export function describeBloodline(bloodlineId) {
  return BLOODLINE_DESCRIPTIONS[bloodlineId] || null;
}

/**
 * Compute the bloodline multiplier for a given (bloodline, dilution,
 * skill element) triple. Returns { multiplier, kind, refused }.
 *
 *   - multiplier: number to multiply finalDamage by
 *   - kind: 'pure_match' | 'mild_match' | 'weak_match' | 'mismatch' |
 *           'no_ancestry' | 'no_element' | 'refused_faded'
 *   - refused: true only when matched + dilution ≥ 0.90 (caller MUST
 *              reject the cast — the bloodline is too faded to channel)
 */
export function getBloodlineMultiplier(bloodlineId, dilution, skillElement) {
  if (!skillElement || skillElement === "none") {
    return { multiplier: MULTIPLIER_NEUTRAL, kind: "no_element", refused: false };
  }
  if (!isKnownBloodline(bloodlineId)) {
    return { multiplier: MULTIPLIER_NEUTRAL, kind: "no_ancestry", refused: false };
  }
  const d = Math.max(0, Math.min(1, Number(dilution) || 0));
  const matches = BLOODLINE_ELEMENTS[bloodlineId].includes(skillElement);
  if (!matches) {
    return { multiplier: MULTIPLIER_MISMATCH, kind: "mismatch", refused: false };
  }
  // Matched cases by dilution.
  if (d < DILUTION_PURE_UPPER)  return { multiplier: MULTIPLIER_PURE_MATCH, kind: "pure_match", refused: false };
  if (d < DILUTION_MILD_UPPER)  return { multiplier: MULTIPLIER_MILD_MATCH, kind: "mild_match", refused: false };
  if (d < DILUTION_WEAK_UPPER)  return { multiplier: MULTIPLIER_WEAK_MATCH, kind: "weak_match", refused: false };
  return { multiplier: 0, kind: "refused_faded", refused: true };
}

/** Read a user's ancestry row, or null if not established. */
export function getUserAncestry(db, userId) {
  if (!db || !userId) return null;
  try {
    return db.prepare(`
      SELECT user_id, primary_bloodline, dilution, chosen_at
      FROM user_ancestry WHERE user_id = ?
    `).get(userId) || null;
  } catch {
    return null;
  }
}

/** Read an NPC's ancestry row, or null if not established. */
export function getNpcAncestry(db, npcId) {
  if (!db || !npcId) return null;
  try {
    return db.prepare(`
      SELECT npc_id, primary_bloodline, dilution, established_at
      FROM npc_ancestry WHERE npc_id = ?
    `).get(npcId) || null;
  } catch {
    return null;
  }
}

/**
 * Set / update a user's ancestry. Idempotent on user_id. Used by:
 *   - character-creation flow (player chooses bloodline)
 *   - migration/legacy import (Phase 12 dynasty cascade)
 *   - bloodline.choose macro (this PR's surface)
 */
export function setUserAncestry(db, userId, bloodline, dilution = 0.5) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  if (!isKnownBloodline(bloodline)) return { ok: false, reason: "unknown_bloodline" };
  const d = Math.max(0, Math.min(1, Number(dilution) || 0));
  try {
    db.prepare(`
      INSERT INTO user_ancestry (user_id, primary_bloodline, dilution)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE
        SET primary_bloodline = excluded.primary_bloodline, dilution = excluded.dilution
    `).run(userId, bloodline, d);
    return { ok: true, action: "set", userId, bloodline, dilution: d };
  } catch (err) {
    try { logger.warn?.("user_ancestry_set_failed", { userId, error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: "insert_failed" };
  }
}

/** Set / update an NPC's ancestry. Idempotent on npc_id. */
export function setNpcAncestry(db, npcId, bloodline, dilution = 1.0) {
  if (!db || !npcId) return { ok: false, reason: "missing_inputs" };
  if (!isKnownBloodline(bloodline)) return { ok: false, reason: "unknown_bloodline" };
  const d = Math.max(0, Math.min(1, Number(dilution) || 0));
  try {
    db.prepare(`
      INSERT INTO npc_ancestry (npc_id, primary_bloodline, dilution)
      VALUES (?, ?, ?)
      ON CONFLICT(npc_id) DO UPDATE
        SET primary_bloodline = excluded.primary_bloodline, dilution = excluded.dilution
    `).run(npcId, bloodline, d);
    return { ok: true, action: "set", npcId, bloodline, dilution: d };
  } catch (err) {
    try { logger.warn?.("npc_ancestry_set_failed", { npcId, error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: "insert_failed" };
  }
}

/** Combat-path entry point. Wraps the ancestry read + multiplier compute. */
export function attackerMultiplier(db, userId, skillElement) {
  const anc = getUserAncestry(db, userId);
  if (!anc) {
    return { multiplier: MULTIPLIER_NEUTRAL, kind: "no_ancestry", refused: false };
  }
  return getBloodlineMultiplier(anc.primary_bloodline, anc.dilution, skillElement);
}

export const BLOODLINE_CONSTANTS = Object.freeze({
  BLOODLINE_ELEMENTS,
  MULTIPLIER_PURE_MATCH,
  MULTIPLIER_MILD_MATCH,
  MULTIPLIER_WEAK_MATCH,
  MULTIPLIER_MISMATCH,
  MULTIPLIER_NEUTRAL,
  DILUTION_PURE_UPPER,
  DILUTION_MILD_UPPER,
  DILUTION_WEAK_UPPER,
});
