// server/domains/oxygen.js
//
// Sprint C / Track C4 — oxygen tick + reset macros for the
// UnderwaterPostFX HUD.

import { tickOxygen, resetOxygen, getOxygen } from "../lib/embodied/oxygen.js";

export default function registerOxygenMacros(register) {
  register("oxygen", "tick", async (ctx, input = {}) => {
  try {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || !input.worldId) return { ok: false, reason: "missing_inputs" };
    const depth = Number(input.depth) || 0;
    return tickOxygen(db, userId, input.worldId, depth);
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  register("oxygen", "reset", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || !input.worldId) return { ok: false, reason: "missing_inputs" };
    return resetOxygen(db, userId, input.worldId);
  });

  register("oxygen", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || !input.worldId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, oxygen: getOxygen(db, userId, input.worldId) };
  });
}
