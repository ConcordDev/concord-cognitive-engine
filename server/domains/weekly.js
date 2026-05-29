// server/domains/weekly.js
//
// D2 — weekly meta objective surface. Domain key: 'weekly'.
//   weekly.objectives — this week's chain for the caller (auto-seeds)
//   weekly.claim      — claim a completed objective's reward CC (idempotent)

import { getWeeklyObjectives, ensureWeek, claimObjectiveReward, currentWeekKey } from "../lib/weekly-objectives.js";

export default function registerWeeklyMacros(register) {
  register("weekly", "objectives", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "no_user" };
    const objectives = ensureWeek(db, userId);
    return { ok: true, weekKey: currentWeekKey(), objectives: objectives.length ? objectives : getWeeklyObjectives(db, userId) };
  });

  register("weekly", "claim", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId || !input.objectiveId) return { ok: false, reason: "missing_inputs" };
    return claimObjectiveReward(db, userId, String(input.objectiveId));
  });
}
