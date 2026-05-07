// server/lib/skill-domains.js
// Canonical skill domain registry for cross-world effectiveness.
//
// Each skill domain represents a category of capability (magic,
// swordsmanship, hacking, bio_powers, etc.). Each world declares a
// skill_affinity table mapping domain → multiplier (0..1+) that scales
// how effective skills in that domain are within that world.
//
// Effectiveness formula at a callsite:
//   effective = base × max(level_floor, world.affinity[domain])
// where level_floor rises with skill level (a master wizard retains
// some power even in a tech-only world; a novice wizard there is
// almost useless).
//
// Adding a new domain: append to SKILL_DOMAINS, add to each world's
// meta.json skill_affinity, and tag any new skill that belongs to it.

export const SKILL_DOMAINS = Object.freeze([
  // Combat — close range
  "swordsmanship",
  "martial_arts",
  "athletics",
  // Combat — ranged modern
  "gun",
  "weapons_modern",
  "weapon_attachments",
  // Combat — ranged historical
  "archery",
  // Combat — exotic
  "magic",
  "bio_powers",
  // Stealth / espionage
  "stealth",
  "lockpicking",
  "infiltration",
  "observation",        // counter-stealth: spot hidden actors
  "perception",         // general awareness; stacks with observation
  "governance",         // kingdom founding + decree enactment
  // Tech
  "hacking",
  "tech",
  "engineering",
  // Social
  "diplomacy",
  "deception",
  "leadership",
  // Crafting / utility
  "crafting",
  "alchemy",
  "driving",
  "piloting",
]);

const DOMAIN_SET = new Set(SKILL_DOMAINS);

export function isKnownDomain(d) {
  return DOMAIN_SET.has(d);
}

/**
 * Default skill affinity table — used as a fallback when a world's
 * meta doesn't declare its own. Roughly neutral: 0.7 across the board.
 * Concordia (the hub) explicitly carries this so it doesn't penalize
 * anyone returning to base.
 */
export const NEUTRAL_AFFINITY = Object.freeze(
  Object.fromEntries(SKILL_DOMAINS.map((d) => [d, 0.7])),
);
