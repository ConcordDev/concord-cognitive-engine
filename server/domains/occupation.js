// server/domains/occupation.js
//
// Living Society — Phase 9: player occupation macro. A shift runs the SAME NPC
// labor loop, pays the Phase-3 edge wage, and grants archetype-specific XP.

import { workShift, OCCUPATION_ROLES } from "../lib/player-occupation.js";

export default function registerOccupationMacros(register) {
  register("occupation", "roles", async () => ({ ok: true, roles: OCCUPATION_ROLES }), { note: "playable occupation roles" });

  register("occupation", "work_shift", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return workShift(db, {
      userId,
      worldId: input.worldId || "concordia-hub",
      role: input.role,
      pos: input.pos || { x: input.x, z: input.z },
      worldType: input.worldType || "standard",
    });
  }, { note: "run a player work shift on the NPC labor loop", destructive: true });
}
