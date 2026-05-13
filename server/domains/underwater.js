// server/domains/underwater.js
//
// Concordia Phase 8 — underwater content macros.

import {
  listFeaturesInWorld,
  featuresNearPlayer,
  listSpecies,
  decideAttackOnPlayer,
  spawnFeature,
} from "../lib/underwater-content.js";

export default function registerUnderwaterMacros(register) {
  register("underwater", "list_features", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = String(input?.worldId || "").trim();
    if (!worldId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, features: listFeaturesInWorld(db, worldId) };
  });

  register("underwater", "near_player", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = String(input?.worldId || "").trim();
    const x = Number(input?.x), z = Number(input?.z);
    const depth_m = Number(input?.depth_m) || 0;
    const scanRadius = Number(input?.scanRadiusM) || 60;
    if (!worldId || !Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: "missing_inputs" };
    return { ok: true, features: featuresNearPlayer(db, worldId, x, z, depth_m, scanRadius) };
  });

  register("underwater", "list_species", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, species: listSpecies(db) };
  });

  /**
   * underwater.tick_threat — caller (dive-pos handler) passes in
   * current player position + depth and gets either an attack
   * description or no_attacker. Caller is responsible for invoking
   * pain.js#recordPain if the result includes painIntensity.
   */
  register("underwater", "tick_threat", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const worldId = String(input?.worldId || "").trim();
    const x = Number(input?.x), z = Number(input?.z);
    const depth_m = Number(input?.depth_m) || 0;
    if (!worldId || !Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: "missing_inputs" };
    return decideAttackOnPlayer(db, {
      worldId, userId, position: { x, z }, depth_m,
    });
  });

  register("underwater", "spawn_feature", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return spawnFeature(db, {
      id: input?.id,
      worldId: input?.worldId,
      kind: input?.kind,
      name: input?.name,
      pos_x: Number(input?.pos_x),
      pos_z: Number(input?.pos_z),
      depth_min_m: Number(input?.depth_min_m) || 0,
      depth_max_m: Number(input?.depth_max_m) || 30,
      radius_m: Number(input?.radius_m) || 50,
      aggression: Number(input?.aggression) || 0,
      lore_json: input?.lore_json,
    });
  });
}
