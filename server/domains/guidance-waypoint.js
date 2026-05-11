// server/domains/guidance-waypoint.js
//
// Sprint 9 — macro surface for the diegetic waypoint system.

import { getActiveObjective, buildHintText } from "../lib/guidance-waypoint.js";

export default function registerGuidanceWaypointMacros(register) {
  register("guidance_waypoint", "active_objective", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: true, objective: null };
    const worldId = input?.worldId || "concordia-hub";
    const objective = getActiveObjective(db, userId, worldId);
    return {
      ok: true,
      objective,
      hint: buildHintText(objective),
      worldId,
    };
  }, { note: "Returns the player's current next-objective + a hint string for the recovery button." });

  register("guidance_waypoint", "hint_for", async (_ctx, input = {}) => {
    // Stateless variant: build a hint from a passed-in objective shape.
    const { objective = null } = input || {};
    return { ok: true, hint: buildHintText(objective) };
  }, { note: "Build the hint string for a pre-fetched objective." });
}
