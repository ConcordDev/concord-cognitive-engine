// server/lib/mount-gear.js
//
// Concordia Procedural Mount System Phase B3 — gear authoring + equipping.
//
// `mount_gear` is a recipe DTU kind (see lib/dtu-validators/
// mount-gear-validators.js). Author flow:
//   1) Player composes recipe in MountDesigner.tsx → `dtu.create` with
//      kind='mount_gear', meta={slot, species_compat, ...}.
//   2) Server validates via `validateMountGear` (defense-in-depth — the
//      recipe-validator surface should already reject invalid shapes).
//   3) Player equips via `equipGear(db, mountId, gearDtuId, slot)`.
//      Slot column on player_companions becomes the dtu_id.
//   4) HUD reads `computeMountStats(db, mountId)` which folds species
//      base + equipped gear modifiers into the effective stat block.
//
// Idempotency:
//   - equipGear on the same slot replaces (does NOT stack multiple of
//     the same slot).
//   - unequipGear with no gear on the slot is a no-op.

import { validateMountGear } from "./dtu-validators/mount-gear-validators.js";
import { getMountSpecies } from "./ecosystem/mount-eligibility.js";

const SLOTS = ["saddle", "bridle", "barding"];
const SLOT_COLUMNS = {
  saddle:  "saddle_dtu_id",
  bridle:  "bridle_dtu_id",
  barding: "barding_dtu_id",
};

function _readDtu(db, dtuId) {
  if (!db || !dtuId) return null;
  // Probe both modern (dtus.id, kind, meta_json) and personal_dtus shapes.
  // Prefer dtus.
  try {
    const row = db.prepare(`SELECT id, type AS kind, creator_id, data AS meta_json FROM dtus WHERE id = ?`).get(dtuId);
    if (row) return { ...row, _source: "dtus" };
  } catch { /* table may not exist on a minimal test DB */ }
  try {
    const row = db.prepare(`SELECT id, kind, creator_id, meta_json FROM personal_dtus WHERE id = ?`).get(dtuId);
    if (row) return { ...row, _source: "personal_dtus" };
  } catch { /* no personal_dtus either */ }
  return null;
}

function _parseMeta(metaJson) {
  if (!metaJson) return {};
  try { return JSON.parse(metaJson); } catch { return {}; }
}

function _readCompanion(db, mountId) {
  if (!db || !mountId) return null;
  try {
    return db.prepare(`
      SELECT id, owner_id, creature_id, name, world_id, mount_eligible,
             saddle_dtu_id, bridle_dtu_id, barding_dtu_id
      FROM player_companions WHERE id = ?
    `).get(mountId) || null;
  } catch {
    return null;
  }
}

function _speciesIdForCreature(db, creatureId) {
  if (!db || !creatureId) return null;
  try {
    const row = db.prepare(`SELECT archetype FROM world_npcs WHERE id = ?`).get(creatureId);
    if (!row) return null;
    const a = String(row.archetype || "");
    return a.startsWith("creature:") ? a.slice("creature:".length) : null;
  } catch {
    return null;
  }
}

/**
 * Equip a `mount_gear` DTU into one of saddle/bridle/barding slots.
 * Replaces any existing gear in that slot. Idempotent — equipping the
 * same DTU twice is a no-op.
 *
 * @returns {{ok: boolean, replaced?: string|null, reason?: string, errors?: string[]}}
 */
export function equipGear(db, args) {
  if (!db) return { ok: false, reason: "no_db" };
  const { mountId, gearDtuId, slot, ownerId } = args || {};
  if (!mountId || !gearDtuId || !slot) return { ok: false, reason: "missing_args" };
  if (!SLOT_COLUMNS[slot]) return { ok: false, reason: "invalid_slot" };

  const comp = _readCompanion(db, mountId);
  if (!comp) return { ok: false, reason: "mount_not_found" };
  if (ownerId && comp.owner_id !== ownerId) return { ok: false, reason: "not_owner" };
  if (!comp.mount_eligible) return { ok: false, reason: "not_mountable" };

  const dtu = _readDtu(db, gearDtuId);
  if (!dtu) return { ok: false, reason: "gear_dtu_not_found" };
  if (dtu.kind !== "mount_gear") return { ok: false, reason: "wrong_kind" };

  const meta = _parseMeta(dtu.meta_json);
  const validate = validateMountGear({ kind: dtu.kind, meta });
  if (!validate.ok) return validate;

  if (meta.slot !== slot) return { ok: false, reason: "slot_mismatch" };

  // Optional species compat check.
  if (Array.isArray(meta.species_compat) && meta.species_compat.length > 0) {
    const speciesId = _speciesIdForCreature(db, comp.creature_id);
    if (!speciesId || !meta.species_compat.includes(speciesId)) {
      return { ok: false, reason: "species_incompatible" };
    }
  }

  const col = SLOT_COLUMNS[slot];
  const replaced = comp[col] || null;
  if (replaced === gearDtuId) return { ok: true, replaced: null }; // no-op

  try {
    db.prepare(`UPDATE player_companions SET ${col} = ? WHERE id = ?`).run(gearDtuId, mountId);
    return { ok: true, replaced };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Clear one of the slot columns. Idempotent — returns ok:true with
 * `had:false` when slot was already empty.
 */
export function unequipGear(db, args) {
  if (!db) return { ok: false, reason: "no_db" };
  const { mountId, slot, ownerId } = args || {};
  if (!mountId || !slot) return { ok: false, reason: "missing_args" };
  if (!SLOT_COLUMNS[slot]) return { ok: false, reason: "invalid_slot" };
  const comp = _readCompanion(db, mountId);
  if (!comp) return { ok: false, reason: "mount_not_found" };
  if (ownerId && comp.owner_id !== ownerId) return { ok: false, reason: "not_owner" };
  const col = SLOT_COLUMNS[slot];
  const had = !!comp[col];
  if (!had) return { ok: true, had: false };
  try {
    db.prepare(`UPDATE player_companions SET ${col} = NULL WHERE id = ?`).run(mountId);
    return { ok: true, had: true, removed: comp[col] };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Compute the effective stat block for a mount with all currently
 * equipped gear. Returns { base, modifiers, effective }.
 *
 * Folding rules:
 *   speedMps        := base × (1 + Σ slot.stat_mods.speed)        clamped [0.4×, 1.8×]
 *   baseStamina     := base × (1 + Σ slot.stat_mods.stamina)      clamped [0.4×, 1.8×]
 *   carryCapacityKg := base × (1 + Σ slot.stat_mods.carry)        clamped [0.4×, 1.8×]
 *   comfort         := Σ slot.stat_mods.comfort                   clamped [0, 30]
 *
 * Clamps preserve gameplay invariants — no piece of gear should
 * triple the carry capacity or halve the speed of a mount.
 */
export function computeMountStats(db, mountId) {
  if (!db || !mountId) return null;
  const comp = _readCompanion(db, mountId);
  if (!comp) return null;
  const speciesId = _speciesIdForCreature(db, comp.creature_id);
  const species = speciesId ? getMountSpecies(db, speciesId) : null;
  if (!species) return null;

  const base = {
    speedMps: species.baseSpeedMps,
    baseStamina: species.baseStamina,
    carryCapacityKg: species.carryCapacityKg,
  };
  const sums = { speed: 0, stamina: 0, carry: 0, comfort: 0 };
  const equipped = [];
  for (const slot of SLOTS) {
    const dtuId = comp[SLOT_COLUMNS[slot]];
    if (!dtuId) continue;
    const dtu = _readDtu(db, dtuId);
    if (!dtu) continue;
    const meta = _parseMeta(dtu.meta_json);
    const mods = meta.stat_mods || {};
    sums.speed   += Number(mods.speed   || 0);
    sums.stamina += Number(mods.stamina || 0);
    sums.carry   += Number(mods.carry   || 0);
    sums.comfort += Number(mods.comfort || 0);
    equipped.push({ slot, dtuId, weight_kg: Number(meta.weight_kg) || 0 });
  }

  const clampMul = (mul) => Math.max(0.4, Math.min(1.8, 1 + mul));
  const effective = {
    speedMps:        base.speedMps        * clampMul(sums.speed),
    baseStamina:     base.baseStamina     * clampMul(sums.stamina),
    carryCapacityKg: base.carryCapacityKg * clampMul(sums.carry),
    comfort:         Math.max(0, Math.min(30, sums.comfort)),
  };
  return {
    speciesId,
    base,
    modifiers: sums,
    effective,
    equipped,
  };
}

/**
 * Read the gear loadout for the HUD inventory view.
 */
export function getEquippedGear(db, mountId) {
  if (!db || !mountId) return null;
  const comp = _readCompanion(db, mountId);
  if (!comp) return null;
  const out = {};
  for (const slot of SLOTS) {
    const dtuId = comp[SLOT_COLUMNS[slot]];
    if (!dtuId) { out[slot] = null; continue; }
    const dtu = _readDtu(db, dtuId);
    if (!dtu) { out[slot] = { dtuId, missing: true }; continue; }
    const meta = _parseMeta(dtu.meta_json);
    out[slot] = {
      dtuId,
      slot: meta.slot,
      weight_kg: Number(meta.weight_kg) || 0,
      stat_mods: meta.stat_mods || {},
      style_tags: meta.style_tags || [],
    };
  }
  return out;
}

export const _internals = { SLOT_COLUMNS, SLOTS };
