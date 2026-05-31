// server/lib/npc-husbandry.js
//
// Wave 7c — NPC behavioral parity. The schema + rig already accept NPC owners
// (player_companions.owner_id is TEXT; world_vehicles.owner_kind has 'npc';
// the NPC economy already mints recipe DTUs); what was missing is anything that
// DRIVES those verbs for NPCs. These are the thin drivers — they point the
// EXISTING verbs at NPC owners, never a parallel system. From them the emergent
// service economy falls out: stable-hands accumulate rideable mounts, traders
// spawn carts, a parts-designer NPC mints gear others buy (royalties via the
// existing cascade).
//
// KS CONCORD_NPC_HUSBANDRY=0 → all no-ops. Best-effort + total.

import { spawnVehicle } from "./world-vehicles.js";
import { markCompanionMountableForHybrid, isTopologyRideable } from "./ecosystem/mount-eligibility.js";

function enabled() { return process.env.CONCORD_NPC_HUSBANDRY !== "0"; }
function uid(pfx) { return `${pfx}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; }

/**
 * An NPC acquires a mount. NPCs don't go through the player's patience-gated
 * taming roll — their husbandry routine acquires directly. Inserts a
 * player_companions row OWNED BY THE NPC and flags mount_eligible (species- or
 * topology-rideable). Idempotent on (owner_id, creature_id).
 */
export function npcAcquireMount(db, { npcId, creatureId, worldId = "concordia-hub", name = "Mount", topology = null, massKg = null } = {}) {
  if (!enabled()) return { ok: false, reason: "disabled" };
  if (!db || !npcId || !creatureId) return { ok: false, reason: "missing_args" };
  try {
    const existing = db.prepare(`SELECT id FROM player_companions WHERE owner_id = ? AND creature_id = ?`).get(npcId, creatureId);
    if (existing) return { ok: true, companionId: existing.id, already: true };
    const id = uid("cmp");
    db.prepare(`
      INSERT INTO player_companions (id, owner_id, creature_id, name, world_id, last_action_at)
      VALUES (?, ?, ?, ?, ?, unixepoch())
    `).run(id, npcId, creatureId, String(name).slice(0, 60), worldId);
    // Flag rideable — from the hybrid blueprint if present, else explicit topology.
    let eligible = false;
    const r = markCompanionMountableForHybrid(db, id, creatureId);
    eligible = !!r.ok;
    if (!eligible && topology && isTopologyRideable(topology, massKg)) {
      try { db.prepare(`UPDATE player_companions SET mount_eligible = 1 WHERE id = ?`).run(id); eligible = true; } catch { /* col optional */ }
    }
    return { ok: true, companionId: id, mountEligible: eligible };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * An NPC spawns a vehicle it owns (trader→cart, fisher→boat). Thin wrapper over
 * the existing spawnVehicle with ownerKind='npc' — the schema was designed for it.
 */
export function npcSpawnVehicle(db, { npcId, worldId, kind, capacity = null, fare_cc = null, position = null } = {}) {
  if (!enabled()) return { ok: false, reason: "disabled" };
  if (!db || !npcId || !worldId || !kind) return { ok: false, reason: "missing_args" };
  return spawnVehicle(db, { worldId, kind, ownerKind: "npc", ownerId: npcId, capacity, fare_cc, position });
}

/**
 * An NPC mints a mount_gear (saddle/bridle/barding) DTU as its own creation —
 * creator_id = npcId, so the royalty cascade pays the NPC when a player buys it
 * (the NPC skill-marketplace already works this way for combat recipes). Reuses
 * the canonical recipe-DTU mint shape.
 */
export function npcMintGear(db, { npcId, slot, meta = {}, name = null } = {}) {
  if (!enabled()) return { ok: false, reason: "disabled" };
  if (!db || !npcId) return { ok: false, reason: "missing_args" };
  if (!["saddle", "bridle", "barding"].includes(slot)) return { ok: false, reason: "invalid_slot" };
  const full = {
    slot,
    species_compat: meta.species_compat || [],
    weight_kg: meta.weight_kg ?? 10,
    weight_rating_kg: meta.weight_rating_kg ?? 120,
    stat_mods: meta.stat_mods || { comfort: 2 },
    material_list: meta.material_list || [{ material_id: "leather", qty: 2 }],
    style_tags: meta.style_tags || ["npc-crafted"],
  };
  try {
    const id = uid("mg");
    const title = String(name || `${slot[0].toUpperCase()}${slot.slice(1)}`).slice(0, 80);
    db.prepare(`
      INSERT INTO dtus (id, type, title, creator_id, data, skill_level, total_experience, created_at)
      VALUES (?, 'mount_gear', ?, ?, ?, 1, 0, unixepoch())
    `).run(id, title, npcId, JSON.stringify(full));
    return { ok: true, dtuId: id, slot, creatorNpc: npcId };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
