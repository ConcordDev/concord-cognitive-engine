// server/domains/progression.js — real creator-progression summary for the
// ProgressionPanel (citations/royalties/domains/badges/unlocks/milestones from
// live data). See lib/creator-progression.js.

import { getCreatorProgression } from "../lib/creator-progression.js";

export default function registerProgressionMacros(register) {
  register("progression", "creator_summary", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const { profile, milestones, unlocks } = getCreatorProgression(db, userId);
    return { ok: true, profile, milestones, unlocks };
  }, { note: "Creator reputation: citations/royalties/domains/badges/unlocks/milestones from live data." });
}
