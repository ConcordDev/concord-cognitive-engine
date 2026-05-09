// server/domains/mounts.js
//
// Concordia Procedural Mount System — domain surface.
//
// B1: list_species, get_species, get_gait, list_mountable, list_eligible_nearby
// B2 (this commit): tame, mount, dismount, get_active_mount, mount_history
// B3 will add: author_gear, equip_gear, unequip_gear, compute_stats
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
}
