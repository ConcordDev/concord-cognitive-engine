// server/domains/talents.js
//
// F2.3 — player talent allocation surface. Domain key: 'talents'.
//   talents.get         — points + allocations + the tree (for the character lens)
//   talents.spend_point — spend one point into a node (validates prereqs/max/points)

import { getTalents, spendTalentPoint } from "../lib/talents.js";

export default function registerTalentsMacros(register) {
  register("talents", "get", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, ...getTalents(db, userId) };
  });

  register("talents", "spend_point", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || !input.talentId) return { ok: false, reason: "missing_inputs" };
    return spendTalentPoint(db, userId, input.talentId);
  });
}
