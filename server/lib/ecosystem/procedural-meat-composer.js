// server/lib/ecosystem/procedural-meat-composer.js
//
// Living Society — Phase 0.5: derive a corpse's drops from the (possibly
// hybrid) creature, instead of a hardcoded loot table.
//
// The bug this fixes: `loot-tables.js#rollLoot(species_id)` returns [] for any
// species_id with no table entry — and a hybrid's id is never a key, so a
// hybrid corpse dropped NOTHING. Here we compose named, propertied drops from
// the creature's blueprint + material profile so a hybrid always yields meat
// that reads coherently and carries inherited effects.

import crypto from "node:crypto";
import {
  profileFor,
  deriveProfileFromBlueprint,
  composeMaterialName,
} from "./material-profiles.js";

function seedByte(str, n = 0) { return crypto.createHash("sha1").update(String(str)).digest()[n % 20]; }

/**
 * Compose drops for a corpse from its blueprint/lineage.
 *
 * @param {object} opts
 * @param {object} [opts.blueprint]  — the creature blueprint (mass, skills, description, origin)
 * @param {object} [opts.lineage]    — { parent_a, parent_b, generation, stability, material_profile? }
 * @param {string} [opts.speciesId]  — fallback id when no blueprint
 * @param {number} [opts.qualityMultiplier]
 * @param {object} [opts.db]
 * @returns {Array<{ item, item_name, quantity, quality, properties }>}
 */
export function composeDrops({ blueprint = null, lineage = null, speciesId = null, qualityMultiplier = 1.0, db = null } = {}) {
  const q = Math.max(0.5, Math.min(2.0, Number(qualityMultiplier) || 1.0));

  // Resolve the material profile: a hybrid carries a blended profile on its
  // lineage; otherwise derive from the blueprint; otherwise the species catalog.
  let profile = null;
  if (lineage?.material_profile) {
    try { profile = typeof lineage.material_profile === "string" ? JSON.parse(lineage.material_profile) : lineage.material_profile; }
    catch { profile = null; }
  }
  if (!profile && blueprint) profile = deriveProfileFromBlueprint(blueprint, "raw-meat");
  if (!profile) profile = profileFor(`${speciesId || "raw-meat"}-meat`, { db }) || profileFor("raw-meat", { db });

  // Name: hybrid → composed coherent name; plain procedural → blueprint desc.
  let meatName;
  if (lineage) {
    meatName = composeMaterialName(profile, profile, {
      seedKey: `${lineage.parent_a}|${lineage.parent_b}`,
      fallback: blueprint?.description,
    });
  } else if (blueprint?.description) {
    meatName = `${String(blueprint.description).split(" ")[0]} cut`;
  } else {
    meatName = "raw meat";
  }

  // Quantity scales with mass + quality. Always ≥ 1 (the empty-loot fix).
  const mass = Number(blueprint?.massKg) || 20;
  const meatQty = Math.max(1, Math.round((1 + Math.floor(mass / 40)) * q));
  const tier = profile.rarity_tier || 1;
  const rarity = ["common", "common", "uncommon", "rare", "epic", "legendary"][Math.min(5, tier)];

  const drops = [];
  const itemId = "raw-meat";
  drops.push({
    item: itemId,
    item_name: meatName,
    quantity: meatQty,
    quality: rarity,
    properties: {
      potency: profile.potency,
      affinity: profile.affinity,
      stability: profile.stability,
      rarity_tier: tier,
      effect_tags: profile.effect_tags || [],
      source: lineage ? "hybrid" : "creature",
    },
  });

  // A heavier / more-skilled creature also yields a secondary part
  // (pelt/bone) — deterministic on the blueprint id.
  const skills = Array.isArray(blueprint?.skillIds) ? blueprint.skillIds.length : 0;
  if (mass > 45 || skills >= 3) {
    const secondary = mass > 80 ? "bone" : "pelt";
    const secProfile = profileFor(secondary, { db });
    drops.push({
      item: secondary,
      item_name: secondary,
      quantity: Math.max(1, Math.round(1 * q)),
      quality: ["common", "common", "uncommon", "rare", "epic", "legendary"][Math.min(5, secProfile.rarity_tier || 1)],
      properties: {
        potency: secProfile.potency, affinity: secProfile.affinity,
        stability: secProfile.stability, rarity_tier: secProfile.rarity_tier,
        effect_tags: secProfile.effect_tags || [], source: lineage ? "hybrid" : "creature",
      },
    });
  }
  return drops;
}

/**
 * Is this corpse a hybrid? (has lineage or blueprint with crossbreed/fusion origin)
 */
export function isHybridCorpse(corpse) {
  if (!corpse) return false;
  if (corpse.lineage_json) return true;
  try {
    const bp = corpse.blueprint_json ? JSON.parse(corpse.blueprint_json) : null;
    return bp?.origin === "crossbreed" || bp?.origin === "fusion";
  } catch { return false; }
}
