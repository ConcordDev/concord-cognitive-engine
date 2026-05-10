// server/domains/buildings.js
//
// Sprint C / Track B4 — building.repair macro.

import { repairBuilding } from "../lib/world-buildings-repair.js";

export default function registerBuildingsMacros(register) {
  register("buildings", "repair", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || !input.buildingId) return { ok: false, reason: "missing_inputs" };
    return repairBuilding(db, userId, input.buildingId, { fraction: input.fraction });
  });
}
