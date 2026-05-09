// server/domains/mounts.js
//
// Concordia Procedural Mount System — domain surface.
//
// B1: list_species, get_species, get_gait, list_mountable, list_eligible_nearby
// B2: tame, mount, dismount, get_active_mount, history
// B3 (this commit): equip_gear, unequip_gear, compute_stats, get_equipped_gear,
//                   validate_gear_recipe (pre-author shape check)
// B4 will add: feed, groom, evolve, care_state

import {
  listMountableSpecies,
  getMountSpecies,
  getGaitProfile,
  listMountableCompanionsForOwner,
} from "../lib/ecosystem/mount-eligibility.js";
import {
  tameForMount,
  mount as mountAction,
  dismount as dismountAction,
  getActiveMountPayload,
  listMountHistory,
} from "../lib/companions-mount.js";
import {
  equipGear,
  unequipGear,
  computeMountStats,
  getEquippedGear,
} from "../lib/mount-gear.js";
import { validateMountGear, MOUNT_GEAR_SLOTS } from "../lib/dtu-validators/mount-gear-validators.js";
import {
  feedMount, groomMount, restMount, getCareState, decayCare, loyaltyForRiding,
} from "../lib/mount-care.js";
import {
  gainRideDistance, gainCombatHits, gainFlightSeconds, getEvolutionState,
} from "../lib/companions-mount-evo.js";
import {
  applyMountedOverlay, MOUNTED_MODIFIER, readMountState as readCombatMountState,
} from "../lib/mount-combat-overlay.js";
import { getFlag } from "../lib/feature-flags.js";

export default function registerMountMacros(register) {
  // mount.list_species — full mount_species table for the lens picker.
  register("mounts", "list_species", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, species: listMountableSpecies(db) };
  }, { note: "all mountable species + base stats + gait profile id" });

  // mount.get_species — single species lookup.
  register("mounts", "get_species", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.speciesId) return { ok: false, reason: "missing_species_id" };
    const sp = getMountSpecies(db, input.speciesId);
    if (!sp) return { ok: false, reason: "unknown_species" };
    return { ok: true, species: sp };
  }, { note: "single species record + parsed JSON columns" });

  // mount.get_gait — gait profile (walk/trot/gallop) for the quadruped
  // gait synthesizer on the client.
  register("mounts", "get_gait", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.speciesId) return { ok: false, reason: "missing_species_id" };
    const g = getGaitProfile(db, input.speciesId);
    if (!g) return { ok: false, reason: "unknown_species" };
    return { ok: true, gait: g };
  }, { note: "walk/trot/gallop phase offsets + turn radius" });

  // mount.list_mountable — caller's mount-eligible companions.
  register("mounts", "list_mountable", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const worldId = input.worldId || null;
    return { ok: true, companions: listMountableCompanionsForOwner(db, userId, worldId) };
  }, { note: "caller's player_companions rows with mount_eligible=1" });

  // mount.list_eligible_nearby — proximity scan over world_npcs filtered
  // to mountable species. Used by the MountDesigner's "what's around me"
  // pane in B3.
  register("mounts", "list_eligible_nearby", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.worldId) return { ok: false, reason: "missing_world_id" };
    const x = Number(input.x);
    const z = Number(input.z);
    const radius = Math.max(1, Math.min(input.radius || 50, 500));
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return { ok: false, reason: "missing_coords" };
    }
    try {
      // world_npcs.archetype is `creature:${species_id}` (see fauna-spawner).
      // Strip the prefix and JOIN against mount_species. SQLite doesn't have
      // distance(); compute squared-distance in SQL with a tight bbox prefilter.
      const rows = db.prepare(`
        SELECT n.id, n.archetype, n.x, n.y, n.z, n.world_id, n.is_dead,
               substr(n.archetype, 10) AS species_id
        FROM world_npcs n
        INNER JOIN mount_species s ON s.species_id = substr(n.archetype, 10)
        WHERE n.world_id = ?
          AND n.is_dead = 0
          AND n.archetype LIKE 'creature:%'
          AND n.x BETWEEN ? AND ?
          AND n.z BETWEEN ? AND ?
        LIMIT 200
      `).all(input.worldId, x - radius, x + radius, z - radius, z + radius);
      const r2 = radius * radius;
      const nearby = rows
        .map(r => {
          const dx = r.x - x;
          const dz = r.z - z;
          return { ...r, distance: Math.sqrt(dx * dx + dz * dz), distanceSq: dx * dx + dz * dz };
        })
        .filter(r => r.distanceSq <= r2)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 50);
      return { ok: true, count: nearby.length, nearby };
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }, { note: "mountable creatures within radius around (x, z) in a world" });

  // ---------- B2: taming + riding ----------

  // mounts.tame — wraps companions.attemptTame with mount-eligibility flip.
  // Returns { ok, companionId, mountEligible, speciesId, successProbability }.
  register("mounts", "tame", async (ctx, input = {}) => {
    if (!getFlag("FF_MOUNTS_RIDING", 1)) return { ok: false, reason: "feature_disabled" };
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.creatureId) return { ok: false, reason: "missing_creature_id" };
    return tameForMount(db, {
      ownerId: userId,
      creatureId: input.creatureId,
      creatureName: input.creatureName,
      worldId: input.worldId,
      lureItem: input.lureItem,
      tameSkill: input.tameSkill,
    });
  }, { note: "tame a creature; if mountable, flip mount_eligible=1" });

  // mounts.mount — open mounted_instances ledger row + return seat offset.
  // Server validates ownership + eligibility + one-active-per-world.
  register("mounts", "mount", async (ctx, input = {}) => {
    if (!getFlag("FF_MOUNTS_RIDING", 1)) return { ok: false, reason: "feature_disabled" };
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.companionId) return { ok: false, reason: "missing_companion_id" };
    return mountAction(db, {
      riderId: userId,
      companionId: input.companionId,
      worldId: input.worldId,
    });
  }, { note: "open a mounted_instances row, return seat offset + species" });

  // mounts.dismount — idempotent close on the rider's active instance.
  register("mounts", "dismount", async (ctx, input = {}) => {
    if (!getFlag("FF_MOUNTS_RIDING", 1)) return { ok: false, reason: "feature_disabled" };
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return dismountAction(db, userId, input.worldId || "concordia-hub");
  }, { note: "close the rider's active mounted_instance (idempotent)" });

  // mounts.get_active_mount — full payload (instance + companion + species
  // + gait + seat offset) for the MountedHUD on connect / reconnect.
  register("mounts", "get_active_mount", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const payload = getActiveMountPayload(db, userId, input.worldId || "concordia-hub");
    if (!payload) return { ok: true, mounted: false };
    return { ok: true, mounted: true, ...payload };
  }, { note: "rider's active mount payload (HUD bootstrap)" });

  // mounts.history — closed mounted_instances rows for the caller.
  register("mounts", "history", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, history: listMountHistory(db, userId, {
      worldId: input.worldId || null,
      limit: Math.max(1, Math.min(input.limit || 50, 200)),
    }) };
  }, { note: "rider's closed mount instances (recent-first)" });

  // ---------- B3: gear authoring + equipping ----------

  // mounts.validate_gear_recipe — pre-author validation. Plugin / UI can
  // call this before submitting `dtu.create` to surface validation errors
  // without writing a row. Read-only, no auth needed.
  register("mounts", "validate_gear_recipe", async (_ctx, input = {}) => {
    if (!getFlag("FF_MOUNT_GEAR", 1)) return { ok: false, reason: "feature_disabled" };
    if (!input.recipe || typeof input.recipe !== "object") {
      return { ok: false, reason: "missing_recipe" };
    }
    const recipe = { kind: "mount_gear", meta: input.recipe.meta || input.recipe };
    return validateMountGear(recipe);
  }, { note: "validate a mount_gear recipe shape pre-author" });

  // mounts.equip_gear — equip a previously-authored gear DTU into one of
  // saddle/bridle/barding slots on a mount the caller owns.
  register("mounts", "equip_gear", async (ctx, input = {}) => {
    if (!getFlag("FF_MOUNT_GEAR", 1)) return { ok: false, reason: "feature_disabled" };
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.mountId || !input.gearDtuId || !input.slot) {
      return { ok: false, reason: "missing_args" };
    }
    return equipGear(db, {
      mountId: input.mountId,
      gearDtuId: input.gearDtuId,
      slot: input.slot,
      ownerId: userId,
    });
  }, { note: "equip a mount_gear DTU into one of {saddle, bridle, barding}" });

  // mounts.unequip_gear — clear a slot. Idempotent.
  register("mounts", "unequip_gear", async (ctx, input = {}) => {
    if (!getFlag("FF_MOUNT_GEAR", 1)) return { ok: false, reason: "feature_disabled" };
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.mountId || !input.slot) return { ok: false, reason: "missing_args" };
    return unequipGear(db, { mountId: input.mountId, slot: input.slot, ownerId: userId });
  }, { note: "clear a slot (idempotent)" });

  // mounts.compute_stats — fold base + equipped gear into the effective
  // stat block. Used by the MountedHUD speedometer + carry indicator.
  register("mounts", "compute_stats", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.mountId) return { ok: false, reason: "missing_mount_id" };
    // Cheap ownership check — read companion's owner.
    const owner = db.prepare(`SELECT owner_id FROM player_companions WHERE id = ?`).get(input.mountId);
    if (!owner) return { ok: false, reason: "mount_not_found" };
    if (owner.owner_id !== userId) return { ok: false, reason: "not_owner" };
    const stats = computeMountStats(db, input.mountId);
    if (!stats) return { ok: false, reason: "compute_failed" };
    return { ok: true, ...stats };
  }, { note: "fold base species stats + equipped gear modifiers" });

  // mounts.get_equipped_gear — slot map for the MountDesigner panel.
  register("mounts", "get_equipped_gear", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.mountId) return { ok: false, reason: "missing_mount_id" };
    const owner = db.prepare(`SELECT owner_id FROM player_companions WHERE id = ?`).get(input.mountId);
    if (!owner) return { ok: false, reason: "mount_not_found" };
    if (owner.owner_id !== userId) return { ok: false, reason: "not_owner" };
    const gear = getEquippedGear(db, input.mountId);
    return { ok: true, slots: [...MOUNT_GEAR_SLOTS], gear };
  }, { note: "currently-equipped gear loadout for a mount" });

  // ---------- B4: care, evolution, mounted-combat overlay ----------

  function _ownsMount(db, userId, mountId) {
    const r = db.prepare(`SELECT owner_id FROM player_companions WHERE id = ?`).get(mountId);
    return !!r && r.owner_id === userId;
  }

  // mounts.feed — drop hunger, lift loyalty. 5-min anti-spam window.
  register("mounts", "feed", async (ctx, input = {}) => {
    if (!getFlag("FF_MOUNT_CARE", 1)) return { ok: false, reason: "feature_disabled" };
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.mountId) return { ok: false, reason: "missing_mount_id" };
    return feedMount(db, { companionId: input.mountId, ownerId: userId, foodItemId: input.foodItemId });
  }, { note: "feed mount (drops hunger, raises loyalty)" });

  register("mounts", "groom", async (ctx, input = {}) => {
    if (!getFlag("FF_MOUNT_CARE", 1)) return { ok: false, reason: "feature_disabled" };
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.mountId) return { ok: false, reason: "missing_mount_id" };
    return groomMount(db, { companionId: input.mountId, ownerId: userId });
  }, { note: "groom mount (raises loyalty)" });

  register("mounts", "rest", async (ctx, input = {}) => {
    if (!getFlag("FF_MOUNT_CARE", 1)) return { ok: false, reason: "feature_disabled" };
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.mountId) return { ok: false, reason: "missing_mount_id" };
    return restMount(db, { companionId: input.mountId, ownerId: userId });
  }, { note: "rest mount (refills stamina)" });

  // mounts.care_state — HUD indicator (lazy decay applied on read).
  register("mounts", "care_state", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.mountId) return { ok: false, reason: "missing_mount_id" };
    if (!_ownsMount(db, userId, input.mountId)) return { ok: false, reason: "not_owner" };
    // Lazy decay — heartbeat is a backstop, the read path is the
    // authoritative pull (see CLAUDE.md: heartbeat MAY trigger but
    // MUST NOT be sole source).
    decayCare(db, input.mountId);
    const cs = getCareState(db, input.mountId);
    if (!cs) return { ok: false, reason: "compute_failed" };
    return { ok: true, ...cs };
  }, { note: "current care state + lazy decay + ride gate" });

  // mounts.evolution_state — HUD evolution indicator.
  register("mounts", "evolution_state", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.mountId) return { ok: false, reason: "missing_mount_id" };
    if (!_ownsMount(db, userId, input.mountId)) return { ok: false, reason: "not_owner" };
    const e = getEvolutionState(db, input.mountId);
    if (!e) return { ok: false, reason: "mount_not_found" };
    return { ok: true, ...e };
  }, { note: "skill XP + evolution tier snapshot" });

  // mounts.gain_xp — owner-side XP record. Game systems call this
  // after a ride / combat hit / flight tick. Bounded magnitude per call
  // (caller is expected to pass post-tick aggregates, not per-frame).
  register("mounts", "gain_xp", async (ctx, input = {}) => {
    if (!getFlag("FF_MOUNT_EVO", 1)) return { ok: false, reason: "feature_disabled" };
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    if (!input.mountId || !input.kind || !Number.isFinite(Number(input.amount))) {
      return { ok: false, reason: "missing_args" };
    }
    if (!_ownsMount(db, userId, input.mountId)) return { ok: false, reason: "not_owner" };
    const amount = Math.max(0, Math.min(Number(input.amount), 5000));
    if (input.kind === "ride")    return gainRideDistance(db, input.mountId, amount);
    if (input.kind === "combat")  return gainCombatHits(db, input.mountId, amount);
    if (input.kind === "flight")  return gainFlightSeconds(db, input.mountId, amount);
    return { ok: false, reason: "invalid_kind" };
  }, { note: "record ride / combat / flight XP for the mount" });

  // mounts.combat_overlay — HUD lookup. Returns the effective combat
  // profile after applying the mounted_modifier overlay for the
  // archetype the rider is currently on. Read-only — does NOT toggle
  // the overlay; toggling happens in the mount/dismount path.
  register("mounts", "combat_overlay", async (ctx, input = {}) => {
    if (!getFlag("FF_MOUNT_COMBAT", 1)) return { ok: false, reason: "feature_disabled" };
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.archetype) return { ok: false, reason: "missing_archetype" };
    const overlay = MOUNTED_MODIFIER[input.archetype] || MOUNTED_MODIFIER.generic;
    const userId = ctx?.actor?.userId || ctx?.userId;
    let combatState = null;
    if (userId) combatState = readCombatMountState(db, "player", userId);
    return { ok: true, archetype: input.archetype, overlay, combatState };
  }, { note: "MOUNTED_MODIFIER overlay table for an archetype" });

  // mounts.applied_profile — apply the overlay to a base profile.
  // Pure compute — useful for the HUD to show effective gas/recovery
  // numbers without re-implementing the math client-side.
  register("mounts", "applied_profile", async (ctx, input = {}) => {
    if (!getFlag("FF_MOUNT_COMBAT", 1)) return { ok: false, reason: "feature_disabled" };
    if (!input.profile || typeof input.profile !== "object") return { ok: false, reason: "missing_profile" };
    if (!input.archetype) return { ok: false, reason: "missing_archetype" };
    const out = applyMountedOverlay(input.profile, input.archetype);
    return { ok: true, profile: out };
  }, { note: "apply MOUNTED_MODIFIER to a base profile" });
}
