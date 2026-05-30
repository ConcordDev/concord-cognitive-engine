// server/lib/cross-world-potency.js
//
// Universal Move System — Pillar 2 (availability) + Pillar 3 (cross-world potency).
//
// Pillar 3: a move records the world it was made in (meta.nativeWorld, stamped by
// move-descriptor.js). Carried to another world its potency =
//   targetAffinity + (1 − targetAffinity) × masteryFactor(skillLevel)
// — full in your native/friendly world; in a foreign world it sags toward that
// world's affinity for the move's domain, and skill level claws it back (a Master
// skill travels anywhere; a novice collapses toward the foreign floor).
//
// Pillar 2: a world that lore-forbids a power can't host it at all (a no-magic
// crime world rejects spells; a no-tech world rejects cyber abilities).
//
// Pure functions, reuse skill-domains' NEUTRAL_AFFINITY. Kill-switch
// CONCORD_CROSS_WORLD_POTENCY=0 → potency always 1.0 (disabled).

import { NEUTRAL_AFFINITY, isKnownDomain } from "./skill-domains.js";

// Master level at which a skill travels at full potency anywhere. Tunable.
const MASTER_LEVEL = Number(process.env.CONCORD_POTENCY_MASTER_LEVEL || 200);

// skill_kind → the affinity domain it reads (and the power class for availability).
export const SKILL_KIND_DOMAIN = {
  fighting_style: "martial_arts",
  spell: "magic",
  biopower: "bio_powers",
  cyber_ability: "tech",
  psionic: "magic",
  tech_gadget: "tech",
  mundane: "athletics",
};

// Power classes gated by a world's lore levers (rule_modulators).
const MAGIC_DOMAINS = new Set(["magic", "bio_powers"]);
const TECH_DOMAINS = new Set(["tech", "hacking", "engineering", "weapons_modern", "weapon_attachments"]);

/** Parse a world's rule_modulators (string or object) into a plain object. */
export function parseModulators(world) {
  if (!world) return {};
  const rm = world.rule_modulators ?? world.ruleModulators ?? world;
  if (typeof rm === "string") { try { return JSON.parse(rm) || {}; } catch { return {}; } }
  return rm && typeof rm === "object" ? rm : {};
}

/** 0..1 — how fully a skill of `level` carries its potency abroad. */
export function masteryFactor(level) {
  const lv = Math.max(0, Number(level) || 0);
  return Math.max(0, Math.min(1, lv / MASTER_LEVEL));
}

/** A world's affinity (0..~1) for a domain — its rule_modulators.skill_affinity
 *  else the neutral 0.7 floor. */
export function worldAffinity(world, domain) {
  const mod = parseModulators(world);
  const tbl = mod.skill_affinity || mod.skillAffinity || null;
  if (tbl && typeof tbl[domain] === "number") return tbl[domain];
  return NEUTRAL_AFFINITY[domain] ?? 0.7;
}

/** Resolve the affinity domain for a move from explicit domain or skill_kind. */
function resolveDomain({ domain, skillKind } = {}) {
  if (domain && isKnownDomain(domain)) return domain;
  return SKILL_KIND_DOMAIN[skillKind] || "athletics";
}

/**
 * Pillar 2 — can this move's power class even exist in `world`?
 * magic_level 0 forbids magic/bio; tech_level 0 forbids tech/cyber. Returns
 * { available, reason }.
 */
export function isAvailableIn(world, { domain, skillKind } = {}) {
  const dom = resolveDomain({ domain, skillKind });
  const mod = parseModulators(world);
  const magicLevel = mod.magic_level ?? mod.magicLevel;
  const techLevel = mod.tech_level ?? mod.techLevel;
  if (MAGIC_DOMAINS.has(dom) && magicLevel === 0) {
    return { available: false, reason: "world forbids magic (magic_level 0)" };
  }
  if (TECH_DOMAINS.has(dom) && techLevel === 0) {
    return { available: false, reason: "world forbids tech (tech_level 0)" };
  }
  return { available: true, reason: null };
}

/**
 * Pillar 3 — potency multiplier (0..1) for a move used in `targetWorld`.
 * @param {object} p
 * @param {number} p.skillLevel
 * @param {string} [p.domain] / @param {string} [p.skillKind]
 * @param {string} p.nativeWorldId   meta.nativeWorld (where the move was made)
 * @param {string} p.targetWorldId   the world it's being used in
 * @param {object} [p.targetWorld]   the target world row (for rule_modulators)
 * @returns {number} potency multiplier in [floor, 1]
 */
export function crossWorldPotency({ skillLevel, domain, skillKind, nativeWorldId, targetWorldId, targetWorld } = {}) {
  if (process.env.CONCORD_CROSS_WORLD_POTENCY === "0") return 1.0;
  // Native (or unknown native) → full potency at home.
  if (nativeWorldId != null && targetWorldId != null && nativeWorldId === targetWorldId) return 1.0;
  const dom = resolveDomain({ domain, skillKind });
  const affinity = Math.max(0, Math.min(1, worldAffinity(targetWorld, dom)));
  const mf = masteryFactor(skillLevel);
  const potency = affinity + (1 - affinity) * mf;
  return Math.max(0, Math.min(1, potency));
}
