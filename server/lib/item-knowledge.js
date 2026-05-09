// server/lib/item-knowledge.js
// Knowledge ≠ possession.
// Having an item lets you USE it. Understanding HOW it was made lets you CRAFT it.
// Using an item without knowledge gives reduced effectiveness (30% base × skill).
// Effectiveness grows with skill level and, for known items, with mastery_level.

import crypto from 'crypto';
import logger from '../logger.js';

// ── Knowledge skill mapping ───────────────────────────────────────────────────
// item_type → which player skill governs effectiveness
export const KNOWLEDGE_SKILL_MAP = {
  weapon:      'combat',
  armor:       'combat',
  tool:        'engineering',
  consumable:  'alchemy',
  material:    'crafting',
  schematic:   'research',
  ammo:        'combat',
  accessory:   'perception',
  currency:    null,           // currency is always 100% effective
  resource:    null,           // raw resources are always 100% effective
};

// ── Effectiveness constants ───────────────────────────────────────────────────
const BASE_NO_KNOWLEDGE  = 0.30;  // 30% with zero relevant skill and no knowledge
const BASE_WITH_KNOWLEDGE = 1.00; // 100% baseline when you know the schema
const SKILL_MAX          = 100;   // skills are 0–100
const MASTERY_BONUS_MAX  = 0.20;  // up to +20% from mastery on top of base

// ── Core API ─────────────────────────────────────────────────────────────────

/**
 * Check if a player knows how to make/fully use a specific item.
 * @returns {object|null}  player_knowledge row or null
 */
export function getKnowledge(db, playerId, schemaId) {
  if (!schemaId) return null;
  return db.prepare(
    'SELECT * FROM player_knowledge WHERE player_id = ? AND schema_id = ?'
  ).get(playerId, schemaId) ?? null;
}

export function hasKnowledge(db, playerId, schemaId) {
  return !!getKnowledge(db, playerId, schemaId);
}

/**
 * Compute 0.0–1.0 effectiveness multiplier for a player using an item.
 *
 * @param {object} db
 * @param {string} playerId
 * @param {string|null} schemaId     — null means no recipe exists (raw resource etc.)
 * @param {string} itemType          — from KNOWLEDGE_SKILL_MAP
 * @param {object} playerSkills      — { combat: 45, engineering: 20, ... } (0–100)
 * @returns {{ effectiveness: number, hasKnowledge: boolean, skillName: string|null, explanation: string }}
 */
export function getItemEffectiveness(db, playerId, schemaId, itemType, playerSkills = {}) {
  const skillName = KNOWLEDGE_SKILL_MAP[itemType] ?? null;

  // Items with no schema (raw resources, currency) are always full value
  if (!schemaId || !skillName) {
    return {
      effectiveness: 1.0,
      hasKnowledge: true,
      skillName: null,
      explanation: 'No special knowledge required.',
    };
  }

  const knowledge = getKnowledge(db, playerId, schemaId);
  const skillLevel = Math.min(SKILL_MAX, Math.max(0, playerSkills[skillName] ?? 0));
  const skillFraction = skillLevel / SKILL_MAX; // 0→1

  if (knowledge) {
    // Known item: full base + skill bonus + mastery bonus
    const mastery = Math.min(1, knowledge.mastery_level ?? 0);
    const effectiveness = Math.min(
      1.0,
      BASE_WITH_KNOWLEDGE * (0.80 + 0.20 * skillFraction) + mastery * MASTERY_BONUS_MAX,
    );
    return {
      effectiveness: Math.round(effectiveness * 100) / 100,
      hasKnowledge: true,
      skillName,
      skillLevel,
      mastery,
      explanation: `Known item. ${skillName} Lv${skillLevel} + ${Math.round(mastery * 100)}% mastery.`,
    };
  }

  // Unknown item: reduced base scaled by skill (30% → up to 80% with maxed skill)
  const effectiveness = BASE_NO_KNOWLEDGE + (0.50 * skillFraction);
  return {
    effectiveness: Math.round(effectiveness * 100) / 100,
    hasKnowledge: false,
    skillName,
    skillLevel,
    mastery: 0,
    explanation: `No blueprint. ${skillName} Lv${skillLevel} limits you to ${Math.round(effectiveness * 100)}% effectiveness. Find the schematic to unlock full potential.`,
  };
}

// ── Learning ──────────────────────────────────────────────────────────────────

/**
 * Grant a player knowledge of a schema (blueprint / recipe).
 * Source: 'crafted' | 'research' | 'schematic_found' | 'taught_by_npc' | 'achievement'
 * Returns false if already known.
 */
export function learnSchematic(db, playerId, schemaId, itemType, itemName, source) {
  if (hasKnowledge(db, playerId, schemaId)) return false;

  db.prepare(`
    INSERT INTO player_knowledge (id, player_id, schema_id, item_type, item_name, source)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), playerId, schemaId, itemType, itemName, source);

  logger.info('item-knowledge', 'learned', { playerId, schemaId, itemName, source });
  return true;
}

/**
 * Record that a player successfully crafted an item they know.
 * Grows mastery_level toward 1.0 asymptotically (each craft adds less the further you go).
 */
export function recordCraft(db, playerId, schemaId) {
  const rec = getKnowledge(db, playerId, schemaId);
  if (!rec) return false;

  const current = rec.mastery_level ?? 0;
  // Diminishing returns: gain = (1 - current) * 0.05
  const gain = (1.0 - current) * 0.05;
  const newMastery = Math.min(1.0, current + gain);

  db.prepare(`
    UPDATE player_knowledge
    SET mastery_level = ?, times_crafted = times_crafted + 1
    WHERE player_id = ? AND schema_id = ?
  `).run(newMastery, playerId, schemaId);

  return true;
}

/**
 * When a player picks up a schematic item (from loot or trade), auto-learn it.
 * Returns { learned: boolean, schemaId, itemName }
 */
export function tryLearnFromLoot(db, playerId, lootItem) {
  const { schemaId, name, type } = lootItem;
  if (!schemaId) return { learned: false };

  const learned = learnSchematic(db, playerId, schemaId, type ?? 'item', name ?? 'Unknown', 'schematic_found');
  return { learned, schemaId, itemName: name };
}

/**
 * Get all known schematics for a player.
 */
export function listPlayerKnowledge(db, playerId) {
  return db.prepare(
    'SELECT * FROM player_knowledge WHERE player_id = ? ORDER BY learned_at DESC'
  ).all(playerId);
}

/**
 * NPC teaches a player — happens after a positive interaction / quest completion.
 */
export function npcTeachesPlayer(db, npcId, playerId, schemaId, itemType, itemName) {
  const source = `taught_by_npc:${npcId}`;
  return learnSchematic(db, playerId, schemaId, itemType, itemName, source);
}

// ── UI helpers ────────────────────────────────────────────────────────────────

/**
 * Return a short UI label for an item effectiveness result.
 * e.g.  "Expert (94%)"  |  "Untrained (47%) — find the schematic"
 */
export function effectivenessLabel({ effectiveness, hasKnowledge: known }) {
  const pct = Math.round(effectiveness * 100);
  if (pct >= 95) return `Expert (${pct}%)`;
  if (pct >= 80) return `Proficient (${pct}%)`;
  if (pct >= 60) return `Competent (${pct}%)`;
  if (pct >= 40) return `Untrained (${pct}%)${!known ? ' — find the schematic' : ''}`;
  return `Novice (${pct}%)${!known ? ' — find the schematic' : ''}`;
}
