// server/lib/dtu-validators/recipe-validators.js
//
// Validators for the v2.0 personal recipe DTU types. Each validator returns
// { ok: true } on pass or { ok: false, error: string } on fail. Lightweight
// shape checks — not full schema validation, since DTU substrate is flexible.
//
// Recipe types default to scope='personal' at creation (enforced at the
// route layer that calls these validators).

const CONTROL_SCHEMES = new Set([
  "bare_hands", "boxer", "karate", "firearm_pistol", "firearm_rifle",
  "blade", "magic_channel", "stealth",
]);

const TARGET_TYPES = new Set(["single", "aoe", "self"]);
const RANGES = new Set(["melee", "close", "mid", "long"]);
const BLUEPRINT_KINDS = new Set(["building", "vehicle", "weapon"]);

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/**
 * fighting_style_recipe: a sequence of combos with conditions and a stance.
 * Shape: { moves: [{ comboId, conditions? }], stance, signatureSequence?, controlScheme? }
 */
export function validateFightingStyleRecipe(data) {
  if (!isPlainObject(data)) return { ok: false, error: "data_must_be_object" };
  if (!Array.isArray(data.moves) || data.moves.length === 0) {
    return { ok: false, error: "moves_required" };
  }
  for (let i = 0; i < data.moves.length; i++) {
    const m = data.moves[i];
    if (!isPlainObject(m) || typeof m.comboId !== "string" || !m.comboId) {
      return { ok: false, error: `moves[${i}].comboId_required` };
    }
    if (m.conditions != null && !isPlainObject(m.conditions)) {
      return { ok: false, error: `moves[${i}].conditions_must_be_object` };
    }
  }
  if (typeof data.stance !== "string" || !data.stance.trim()) {
    return { ok: false, error: "stance_required" };
  }
  if (data.controlScheme != null && !CONTROL_SCHEMES.has(data.controlScheme)) {
    return { ok: false, error: "controlScheme_invalid" };
  }
  return { ok: true };
}

/**
 * spell_recipe: a formula plus resource costs, range, and target type.
 * Shape: { formula, costs: { mana?, stamina?, ap? }, range, targetType, animationClip? }
 */
export function validateSpellRecipe(data) {
  if (!isPlainObject(data)) return { ok: false, error: "data_must_be_object" };
  if (typeof data.formula !== "string" || !data.formula.trim()) {
    return { ok: false, error: "formula_required" };
  }
  if (!isPlainObject(data.costs)) return { ok: false, error: "costs_required" };
  for (const k of ["mana", "stamina", "ap"]) {
    if (data.costs[k] != null && (typeof data.costs[k] !== "number" || data.costs[k] < 0)) {
      return { ok: false, error: `costs.${k}_must_be_nonnegative_number` };
    }
  }
  if (!RANGES.has(data.range)) return { ok: false, error: "range_invalid" };
  if (!TARGET_TYPES.has(data.targetType)) return { ok: false, error: "targetType_invalid" };
  return { ok: true };
}

/**
 * blueprint: a building/vehicle/weapon blueprint with dimensions and material list.
 * Shape: { kind, dimensions: { x, y, z }, materials: [{ resource, qty }], gltfRef? }
 */
export function validateBlueprint(data) {
  if (!isPlainObject(data)) return { ok: false, error: "data_must_be_object" };
  if (!BLUEPRINT_KINDS.has(data.kind)) return { ok: false, error: "kind_invalid" };
  if (!isPlainObject(data.dimensions)) return { ok: false, error: "dimensions_required" };
  for (const axis of ["x", "y", "z"]) {
    if (typeof data.dimensions[axis] !== "number" || data.dimensions[axis] <= 0) {
      return { ok: false, error: `dimensions.${axis}_must_be_positive_number` };
    }
  }
  if (!Array.isArray(data.materials) || data.materials.length === 0) {
    return { ok: false, error: "materials_required" };
  }
  for (let i = 0; i < data.materials.length; i++) {
    const mat = data.materials[i];
    if (!isPlainObject(mat) || typeof mat.resource !== "string" || !mat.resource) {
      return { ok: false, error: `materials[${i}].resource_required` };
    }
    if (typeof mat.qty !== "number" || mat.qty <= 0) {
      return { ok: false, error: `materials[${i}].qty_must_be_positive_number` };
    }
  }
  return { ok: true };
}

/** Recipe types that default to scope='personal' on creation. */
export const PERSONAL_DEFAULT_RECIPE_TYPES = new Set([
  "fighting_style_recipe",
  "spell_recipe",
  "blueprint",
]);

/**
 * Dispatch by meta.type. Returns { ok, error? }. Unknown types are passed
 * through (ok: true) so this validator never breaks creation of non-recipe DTUs.
 */
export function validateRecipeByType(metaType, data) {
  switch (metaType) {
    case "fighting_style_recipe": return validateFightingStyleRecipe(data);
    case "spell_recipe":          return validateSpellRecipe(data);
    case "blueprint":             return validateBlueprint(data);
    default:                      return { ok: true };
  }
}
