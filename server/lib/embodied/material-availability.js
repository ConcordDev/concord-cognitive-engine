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
import { computeRegionalScarcity } from "../npc-economy.js";

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

// ── Live scarcity blend ─────────────────────────────────────────────────────
//
// `availabilityForMaterial` above is a STATIC floor authored per-world in
// meta.json — it never moves no matter how much ammo/reagent/parts/fuel
// gameplay actually burns through. Meanwhile `npc-economy.js` already has a
// genuinely live, tested regional-scarcity engine
// (`computeRegionalScarcity(db, worldId, resourceKind)`) that folds a
// rolling 1h window of `economy_flows` rows (gather/craft_output = supply,
// craft_input/consume = demand) into a scarcity number in
// [MIN_SCARCITY, MAX_SCARCITY] = [-0.5, 1.0].
//
// The four material kinds here are NOT added to npc-economy.js's
// RAW_RESOURCES/FINISHED_GOODS taxonomy. That registry is scoped to the
// civilian labor/craft chain — it drives ARCHETYPE_GATHER_TARGETS and
// ARCHETYPE_CRAFT_RECIPES, i.e. which archetypes actually go gather/craft a
// resource during their routine. Materials here are combat/skill
// consumables (ammo, reagents, tech parts, bloodline fuel), not something
// any NPC archetype gathers or crafts — folding them into that taxonomy
// would misrepresent them as civilian-economy goods for no functional gain.
// `computeRegionalScarcity` has no DB-level enum constraint on
// `resource_kind` (see migration 131 — it's a plain TEXT column), so it
// already works unmodified for any string, including these four. This
// module is the "thin adjacent map": MATERIAL_KINDS below IS the
// resource-kind vocabulary used when reading/writing `economy_flows` rows
// for materials, kept local to this file rather than merged into
// npc-economy.js's craft-chain registry.
//
// Blend rule: when `computeRegionalScarcity` returns exactly 0 (no flow
// rows in the window — the true "nothing has happened yet" case, since an
// empty window naturally computes to 0/(0+0+1) = 0), the live number
// collapses to the static floor with no rounding drift, so a
// never-touched world/material returns byte-identical output to the old
// pure-static function (zero HUD regression). Once flow data exists,
// scarcity linearly discounts (positive = net consumption, shrinks
// availability toward 0) or boosts (negative = net production/glut, grows
// availability up to the natural [0,1] ceiling) the static floor. This
// reuses computeRegionalScarcity's own rolling window as the recovery
// mechanism — once flows age out of the window, scarcity relaxes back
// toward 0 and availability relaxes back toward the static floor. No new
// recovery curve is invented here.
export function liveAvailabilityForMaterial(db, worldId, materialKind) {
  const staticFloor = availabilityForMaterial(worldId, materialKind);
  if (!db || !worldId || !materialKind) return staticFloor;
  let scarcity = 0;
  try {
    scarcity = computeRegionalScarcity(db, worldId, materialKind);
  } catch {
    return staticFloor;
  }
  if (!Number.isFinite(scarcity) || scarcity === 0) return staticFloor;
  const blended = staticFloor * (1 - scarcity);
  return Math.max(0, Math.min(1, blended));
}

/**
 * Combined helper: given (worldId, skillKey), return the material kind and
 * its availability for the world. `materialKind=null` means the skill is
 * material-independent — caller should NOT block based on availability.
 *
 * Pass `db` to fold in live regional-scarcity data (economy_flows-derived);
 * omitted, this returns the static meta.json floor exactly as before.
 */
export function materialAvailabilityForSkillInWorld(worldId, skillKey, db = null) {
  const materialKind = materialForSkill(skillKey);
  if (!materialKind) return { ok: true, materialKind: null, availability: 1.0 };
  const availability = db
    ? liveAvailabilityForMaterial(db, worldId, materialKind)
    : availabilityForMaterial(worldId, materialKind);
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
