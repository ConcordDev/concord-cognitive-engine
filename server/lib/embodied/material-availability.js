// server/lib/embodied/material-availability.js
//
// Per-world material availability — distinct from skill_affinity.
//
// The old skill_affinity model conflated three concerns:
//   (1) how the world's metaphysical substrate modulates a skill (magic in
//       fantasy = 1.0, in cyber = 0.10)
//   (2) whether the consumables a skill needs exist there (ballistic_ammo
//       in tunya is rare; magical_reagents in cyber are trace)
//   (3) target resistance (a bio-powered hero is harder to shoot than a
//       Tunyan civilian)
//
// Concern (1) stays in `skill_affinity`. This module owns (2): the
// per-world map keyed by consumable kind. A gun fires the same in every
// world — but in tunya / fantasy / sovereign-ruins ammo is rare loot, so
// players running a gun build there must hunt for cartridges.
//
// Concern (3) is handled at the combat-damage path by reading the
// target's bio-power / bloodline / actor_physique resistance maps.
//
// Default availability if not declared:
//   ballistic_ammo:    1.0   (assume plentiful — only worlds that
//                              explicitly opt-out are gated)
//   magical_reagents:  0.5
//   tech_parts:        0.5
//   bloodline_fuel:    0.5
//
// Skills are mapped to their required material kind via SKILL_MATERIAL.
// A skill without an entry is treated as material-independent (e.g.
// athletics, diplomacy, stealth — these always work).

import { getWorldMeta } from "../cross-world-effectiveness.js";

const DEFAULT_AVAILABILITY = Object.freeze({
  ballistic_ammo:   1.0,
  magical_reagents: 0.5,
  tech_parts:       0.5,
  bloodline_fuel:   0.5,
});

const SKILL_MATERIAL = Object.freeze({
  gun:                "ballistic_ammo",
  weapons_modern:     "ballistic_ammo",
  weapon_attachments: "ballistic_ammo",
  magic:              "magical_reagents",
  alchemy:            "magical_reagents",
  hacking:            "tech_parts",
  tech:               "tech_parts",
  engineering:        "tech_parts",
  bio_powers:         "bloodline_fuel",
  fire_bloodline:     "bloodline_fuel",
  ice_bloodline:      "bloodline_fuel",
});

/**
 * Read the per-world availability for a single material kind.
 * Returns 1.0 when the world hasn't declared anything (forward-compatible).
 */
export function availabilityForMaterial(worldId, materialKind) {
  const meta = getWorldMeta(worldId);
  const map = (meta?.material_availability && typeof meta.material_availability === "object")
    ? meta.material_availability
    : null;
  if (!map) return DEFAULT_AVAILABILITY[materialKind] ?? 1.0;
  const v = map[materialKind];
  return typeof v === "number" ? v : DEFAULT_AVAILABILITY[materialKind] ?? 1.0;
}

/**
 * Lookup the material kind a skill needs. Returns null when the skill is
 * material-independent.
 */
export function materialForSkill(skillKey) {
  if (!skillKey) return null;
  return SKILL_MATERIAL[skillKey] ?? null;
}

/**
 * Combined helper: given (worldId, skillKey), return the material kind and
 * its availability for the world. `materialKind=null` means the skill is
 * material-independent — caller should NOT block based on availability.
 */
export function materialAvailabilityForSkillInWorld(worldId, skillKey) {
  const materialKind = materialForSkill(skillKey);
  if (!materialKind) return { ok: true, materialKind: null, availability: 1.0 };
  const availability = availabilityForMaterial(worldId, materialKind);
  return { ok: true, materialKind, availability };
}

/**
 * Classify availability into a four-tier label so HUD code can render
 * a consistent badge. Thresholds are deliberate:
 *
 *   "abundant"   >= 0.70   — no friction; no badge needed
 *   "moderate"   >= 0.40   — flavor only
 *   "scarce"     >= 0.15   — show SCARCE badge
 *   "depleted"   <  0.15   — show DEPLETED badge ("NO AMMO" for ballistic)
 */
export function classifyAvailability(value) {
  if (typeof value !== "number") return "abundant";
  if (value >= 0.70) return "abundant";
  if (value >= 0.40) return "moderate";
  if (value >= 0.15) return "scarce";
  return "depleted";
}

export const MATERIAL_KINDS = Object.freeze(["ballistic_ammo", "magical_reagents", "tech_parts", "bloodline_fuel"]);
export const SKILL_MATERIAL_MAP = SKILL_MATERIAL;
