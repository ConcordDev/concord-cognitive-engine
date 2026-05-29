// scripts/author/validate-gate.mjs
//
// The validate-gate for the offline content-authoring pipeline. Nothing the
// pipeline generates is written unless it passes here. The validators MIRROR
// server/lib/content-seeder.js (the seed-time source of truth) so the pipeline
// is standalone — it doesn't boot the engine's heavy import chain. Kept in sync
// with content-seeder.js; a parity test pins agreement.
//
// Each validator returns { ok, reason }. gateBatch filters a candidate array into
// { valid, rejected } and additionally enforces unique ids within the batch.

const isObj = (o) => o && typeof o === "object" && !Array.isArray(o);

export function validateNpc(o) {
  if (!isObj(o)) return { ok: false, reason: "not_object" };
  if (typeof o.id !== "string" || !o.id) return { ok: false, reason: "missing_id" };
  if (typeof o.name !== "string" || !o.name) return { ok: false, reason: "missing_name" };
  if (o.faction_id != null && typeof o.faction_id !== "string") return { ok: false, reason: "invalid_faction_id" };
  if (o.narrative_context !== undefined && !isObj(o.narrative_context)) return { ok: false, reason: "invalid_narrative_context" };
  return { ok: true };
}

export function validateFaction(o) {
  if (!isObj(o)) return { ok: false, reason: "not_object" };
  if (typeof o.id !== "string" || !o.id) return { ok: false, reason: "missing_id" };
  if (typeof o.name !== "string" || !o.name) return { ok: false, reason: "missing_name" };
  if (o.visual !== undefined) {
    if (!isObj(o.visual)) return { ok: false, reason: "invalid_visual_shape" };
    for (const k of ["primary_color", "secondary_color", "accent_color"]) {
      if (typeof o.visual[k] !== "string" || !/^#[0-9a-fA-F]{6}$/.test(o.visual[k])) {
        return { ok: false, reason: `invalid_visual_${k}` };
      }
    }
  }
  return { ok: true };
}

export function validateQuest(o) {
  if (!isObj(o)) return { ok: false, reason: "not_object" };
  if (typeof o.id !== "string" || !o.id) return { ok: false, reason: "missing_id" };
  if (typeof o.title !== "string" || !o.title) return { ok: false, reason: "missing_title" };
  if (o.objectives !== undefined) {
    if (!Array.isArray(o.objectives)) return { ok: false, reason: "objectives_not_array" };
    for (const ob of o.objectives) {
      if (typeof ob?.id !== "string" || !ob.id) return { ok: false, reason: "objective_missing_id" };
      if (typeof ob?.type !== "string" || !ob.type) return { ok: false, reason: "objective_missing_type" };
    }
  }
  return { ok: true };
}

export function validateLoreEvent(o) {
  if (!isObj(o)) return { ok: false, reason: "not_object" };
  if (typeof o.id !== "string" || !o.id) return { ok: false, reason: "missing_id" };
  if (typeof o.title !== "string" || !o.title) return { ok: false, reason: "missing_title" };
  return { ok: true };
}

// Creatures aren't validated by content-seeder, but the spawner needs a stable
// shape — pin the minimum here.
export function validateCreature(o) {
  if (!isObj(o)) return { ok: false, reason: "not_object" };
  if (typeof o.id !== "string" || !o.id) return { ok: false, reason: "missing_id" };
  if (typeof o.species_id !== "string" || !o.species_id) return { ok: false, reason: "missing_species_id" };
  return { ok: true };
}

export const VALIDATORS = Object.freeze({
  npc: validateNpc, faction: validateFaction, quest: validateQuest,
  lore: validateLoreEvent, creature: validateCreature,
});

/**
 * Gate a candidate batch for a content type. Drops invalid records and any whose
 * id duplicates an existing id (existingIds) or an earlier batch member.
 * @returns {{ valid: object[], rejected: {item, reason}[] }}
 */
export function gateBatch(type, candidates, existingIds = new Set()) {
  const validate = VALIDATORS[type];
  if (!validate) throw new Error(`unknown content type: ${type}`);
  const valid = [];
  const rejected = [];
  const seen = new Set(existingIds);
  for (const item of candidates || []) {
    const v = validate(item);
    if (!v.ok) { rejected.push({ item, reason: v.reason }); continue; }
    if (seen.has(item.id)) { rejected.push({ item, reason: "duplicate_id" }); continue; }
    seen.add(item.id);
    valid.push(item);
  }
  return { valid, rejected };
}
