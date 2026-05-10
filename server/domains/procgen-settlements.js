// server/domains/procgen-settlements.js
//
// Sprint B Phase 11.4 — read surface for the procgen settlement NPCs.
// The frontend renders these alongside authored NPCs once per world
// load + on lattice-quest-cycle drift events.

import {
  listSettlementNpcs,
  listSettlementNpcsForWorld,
} from "../lib/procgen-settlements.js";

export default function registerProcgenSettlementMacros(register) {
  // procgen.npcs_for_world — bulk read for the world page on load.
  register("procgen", "npcs_for_world", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.worldId) return { ok: false, reason: "missing_world_id" };
    const limit = Math.min(500, Math.max(1, Number(input.limit) || 200));
    const npcs = listSettlementNpcsForWorld(db, input.worldId, limit);
    return { ok: true, npcs, count: npcs.length };
  });

  // procgen.npcs_in_region — drilldown when the player approaches a
  // specific region.
  register("procgen", "npcs_in_region", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (!input.regionId) return { ok: false, reason: "missing_region_id" };
    const npcs = listSettlementNpcs(db, input.regionId, 50);
    return { ok: true, npcs, count: npcs.length };
  });
}
