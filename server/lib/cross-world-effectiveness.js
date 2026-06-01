// server/lib/cross-world-effectiveness.js
// Cross-world skill effectiveness calculator.
//
// Per the canonical spec: skills learned in one world are less effective
// in misaligned worlds. A wizard's magic in a cyber world works partially
// (less ambient magic to channel); a hacker in a fantasy world has nothing
// to hack. As skill level rises, the floor rises — a master retains
// partial effectiveness anywhere; a novice doesn't.
//
// Formula:
//   floor      = 0.10 + 0.40 × min(1, level / maxLevel)
//                 (level 1 → 0.10, level maxLevel → 0.50)
//   affinity   = world.skill_affinity[domain] ?? world.skill_affinity.default ?? 0.7
//   multiplier = max(floor, affinity)
//   effective  = base × multiplier
//
// The world registry is populated by the content-seeder from each world's
// meta.json. Worlds the seeder hasn't seen yet fall through to NEUTRAL.

import { NEUTRAL_AFFINITY } from "./skill-domains.js";
import { LruMap, LruSet } from "./lru-map.js";

const _worldRegistry = new LruMap();

/**
 * Resolve a world's per-domain affinity (0..1+), handling BOTH world-meta shapes:
 *   • skill_affinity            : { <domain>: 0.95, default: 0.4 }     (authored worlds / content meta.json)
 *   • skill_effectiveness_rules : { <domain>: { multiplier: 0.95 }, default: { multiplier: 1.0 } }
 *                                                                       (Foundry / world-seed worlds)
 * #14 fix: the reader previously only looked at skill_affinity, so a world that
 * defined only skill_effectiveness_rules silently fell through to NEUTRAL and its
 * cross-world potency was ignored. Now either shape resolves; skill_affinity wins
 * when both are present (authored intent is canonical). Returns null if neither
 * shape carries the domain or a default (caller applies the NEUTRAL fallback).
 */
export function resolveAffinity(meta, domain) {
  const aff = meta?.skill_affinity;
  if (aff && (aff[domain] != null || aff.default != null)) {
    return aff[domain] ?? aff.default;
  }
  const rules = meta?.skill_effectiveness_rules;
  if (rules) {
    const rule = rules[domain] ?? rules.default;
    const mult = (rule && typeof rule === "object") ? rule.multiplier : rule;
    if (mult != null && Number.isFinite(Number(mult))) return Number(mult);
  }
  return null;
}

/**
 * Register a world's metadata. Called by the content-seeder for each
 * meta.json discovered under content/world/.
 */
export function registerWorldMeta(meta) {
  if (!meta?.world_id) return;
  _worldRegistry.set(meta.world_id, meta);
  // Register every alias as a pointer to the same meta object so legacy
  // ids resolve to the canonical world. Used during the
  // 'concordia' → 'concordia-hub' transition (migration 098).
  if (Array.isArray(meta.world_id_aliases)) {
    for (const alias of meta.world_id_aliases) {
      if (typeof alias === "string" && alias && alias !== meta.world_id) {
        _worldRegistry.set(alias, meta);
      }
    }
  }
}

export function getWorldMeta(worldId) {
  return _worldRegistry.get(worldId) ?? null;
}

export function listKnownWorlds() {
  return Array.from(_worldRegistry.keys());
}

/**
 * Compute the effective scaling multiplier for a given skill in a given
 * world. Pure function — no side effects.
 *
 * @param {object} args
 * @param {string} args.domain      skill domain (see SKILL_DOMAINS)
 * @param {string} args.worldId     destination world
 * @param {number} [args.level]     current skill level (default 1)
 * @param {number} [args.maxLevel]  game-wide max skill level (default 100)
 * @returns {number} multiplier in [0..1+]
 */
export function effectivenessMultiplier({ domain, worldId, level = 1, maxLevel = 100 }) {
  const meta = _worldRegistry.get(worldId);
  const affinity = resolveAffinity(meta, domain)
    ?? NEUTRAL_AFFINITY[domain]
    ?? 0.7;

  const lvlFraction = Math.max(0, Math.min(1, level / Math.max(1, maxLevel)));
  const floor = 0.10 + 0.40 * lvlFraction;
  return Math.max(floor, affinity);
}

/**
 * Convenience: scale a base value (damage, success chance, etc.) by the
 * cross-world multiplier.
 */
export function scaleByEffectiveness(baseValue, args) {
  return baseValue * effectivenessMultiplier(args);
}

/**
 * Diagnostic: explain the multiplier for a given (skill, world, level)
 * triple. Useful for quest dialogue ("your magic is weakened here") and
 * for the upcoming HUD readout.
 */
export function explainEffectiveness({ domain, worldId, level = 1, maxLevel = 100 }) {
  const meta = _worldRegistry.get(worldId);
  const affinity = resolveAffinity(meta, domain)
    ?? NEUTRAL_AFFINITY[domain]
    ?? 0.7;
  const lvlFraction = Math.max(0, Math.min(1, level / Math.max(1, maxLevel)));
  const floor = 0.10 + 0.40 * lvlFraction;
  const multiplier = Math.max(floor, affinity);
  const dominant = floor > affinity ? "level_floor" : "world_affinity";
  return {
    domain,
    worldId,
    level,
    affinity,
    floor,
    multiplier,
    dominant,
    note: dominant === "level_floor"
      ? `Your skill level (${level}/${maxLevel}) carries you partly even though ${worldId} doesn't favor ${domain}.`
      : `${worldId} ${affinity >= 0.9 ? "is highly favorable to" : affinity >= 0.5 ? "supports" : affinity >= 0.2 ? "weakly tolerates" : "actively dampens"} ${domain}.`,
  };
}
