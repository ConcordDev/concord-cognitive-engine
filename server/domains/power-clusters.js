// server/domains/power-clusters.js — power-upgrade collectibles (SR4/Crackdown
// data-cluster loop). list / claim / progress. See lib/power-clusters.js.

import {
  listClustersForWorld,
  claimCluster,
  getClusterProgress,
} from "../lib/power-clusters.js";

export default function registerPowerClusterMacros(register) {
  register("power-clusters", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || null;
    const { worldId, x, z, radius, unclaimedOnly } = input || {};
    if (!db || !worldId) return { ok: false, reason: "missing_worldId", clusters: [] };
    return listClustersForWorld(db, worldId, userId, { x, z, radius, unclaimedOnly });
  }, { note: "List a world's power-upgrade nodes with a per-player claimed flag." });

  register("power-clusters", "claim", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    // The unauthenticated lens-run path builds actor.userId === "anon", so a bare
    // truthiness check lets logged-out callers claim under one shared anon user and
    // pollute progression — require a real authenticated user.
    if (!db || !userId || userId === "anon") return { ok: false, reason: "auth_required" };
    const { worldId, clusterId, x, z } = input || {};
    if (!worldId || !clusterId) return { ok: false, reason: "missing_inputs" };
    return claimCluster(db, worldId, userId, clusterId, { x, z });
  }, { note: "Claim a power node you're standing on; awards progression toward its power." });

  register("power-clusters", "progress", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || userId === "anon") return { ok: false, reason: "auth_required" };
    return getClusterProgress(db, userId, input?.worldId || null);
  }, { note: "Per-power claimed/total summary for the player." });
}
