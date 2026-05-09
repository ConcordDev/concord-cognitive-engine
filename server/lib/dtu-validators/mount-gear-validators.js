// server/lib/dtu-validators/mount-gear-validators.js
//
// Validation for `kind='mount_gear'` DTUs (Concordia Mount System B3).
//
// Shape:
//   {
//     id: string,
//     kind: 'mount_gear',
//     creator_id: string,
//     meta: {
//       slot:           'saddle' | 'bridle' | 'barding',
//       species_compat: string[]            // species_id whitelist; empty = any
//       weight_kg:      number > 0,
//       weight_rating_kg: number > 0,       // max load gear can support
//       stat_mods: {
//         speed?:    number ∈ [-0.5, 0.5],   // multiplier delta vs 1.0
//         stamina?:  number ∈ [-0.5, 0.5],
//         carry?:    number ∈ [-0.5, 0.5],
//         comfort?:  number ∈ [0, 10],
//       },
//       material_list: [{ material_id: string, qty: number > 0 }, ...],
//       style_tags:    string[],            // 0..16, freeform aesthetic tags
//     }
//   }
//
// Bounds chosen so a single piece of gear cannot more than ±50% any of
// speed/stamina/carry. Fully-kitted (saddle + bridle + barding) caps
// effectively ±150% but `computeMountStats` clamps the final fold to
// keep stats sensible.

const SLOTS = new Set(["saddle", "bridle", "barding"]);
const STAT_MOD_FIELDS = new Set(["speed", "stamina", "carry", "comfort"]);
const STAT_MOD_LIMITS = {
  speed:   { min: -0.5, max: 0.5 },
  stamina: { min: -0.5, max: 0.5 },
  carry:   { min: -0.5, max: 0.5 },
  comfort: { min: 0,    max: 10  },
};

export function validateMountGear(dtu) {
  if (!dtu || typeof dtu !== "object") return { ok: false, reason: "invalid_dtu" };
  if (dtu.kind !== "mount_gear") return { ok: false, reason: "wrong_kind" };
  const meta = dtu.meta || {};
  const errors = [];

  if (!SLOTS.has(meta.slot)) errors.push(`slot must be one of ${[...SLOTS].join(", ")}`);

  if (!Array.isArray(meta.species_compat)) {
    errors.push("species_compat must be an array of species_id strings");
  } else {
    for (const s of meta.species_compat) {
      if (typeof s !== "string" || !s) {
        errors.push("species_compat entries must be non-empty strings");
        break;
      }
    }
  }

  const weightKg = Number(meta.weight_kg);
  if (!Number.isFinite(weightKg) || weightKg <= 0) errors.push("weight_kg must be > 0");

  const weightRating = Number(meta.weight_rating_kg);
  if (!Number.isFinite(weightRating) || weightRating <= 0) errors.push("weight_rating_kg must be > 0");

  if (meta.stat_mods != null) {
    if (typeof meta.stat_mods !== "object") {
      errors.push("stat_mods must be an object");
    } else {
      for (const [k, v] of Object.entries(meta.stat_mods)) {
        if (!STAT_MOD_FIELDS.has(k)) {
          errors.push(`unknown stat_mod field: ${k}`);
          continue;
        }
        const n = Number(v);
        if (!Number.isFinite(n)) {
          errors.push(`stat_mods.${k} must be a number`);
          continue;
        }
        const bounds = STAT_MOD_LIMITS[k];
        if (n < bounds.min || n > bounds.max) {
          errors.push(`stat_mods.${k} out of bounds [${bounds.min}, ${bounds.max}]: ${n}`);
        }
      }
    }
  }

  if (!Array.isArray(meta.material_list)) {
    errors.push("material_list must be an array");
  } else {
    for (const m of meta.material_list) {
      if (!m || typeof m.material_id !== "string" || !m.material_id) {
        errors.push("material_list entries need material_id");
        break;
      }
      const q = Number(m.qty);
      if (!Number.isFinite(q) || q <= 0) {
        errors.push("material_list entries need qty > 0");
        break;
      }
    }
  }

  if (meta.style_tags != null) {
    if (!Array.isArray(meta.style_tags)) {
      errors.push("style_tags must be an array");
    } else if (meta.style_tags.length > 16) {
      errors.push("style_tags max 16");
    }
  }

  if (errors.length) return { ok: false, reason: "validation_failed", errors };
  return { ok: true };
}

export const MOUNT_GEAR_SLOTS = SLOTS;
export const MOUNT_GEAR_STAT_LIMITS = STAT_MOD_LIMITS;
