// server/domains/wind.js
//
// Concordia Phase 7 — wind / flight macros.

import { windAtViaSignals, WIND_CONSTANTS } from "../lib/embodied/wind-currents.js";

export default function registerWindMacros(register) {
  register("wind", "at", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = String(input?.worldId || "").trim();
    const x = Number(input?.x), z = Number(input?.z);
    if (!worldId || !Number.isFinite(x) || !Number.isFinite(z)) return { ok: false, reason: "missing_inputs" };
    const r = await windAtViaSignals(db, worldId, { x, z });
    return { ok: true, ...r };
  });

  register("wind", "constants", async () => {
    return { ok: true, constants: WIND_CONSTANTS };
  });
}
