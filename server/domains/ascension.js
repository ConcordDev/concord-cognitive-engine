// server/domains/ascension.js
//
// D30 — endgame paragon/ascension surface. Domain key: 'ascension'.
//   ascension.get         — level + points + allocations + nodes
//   ascension.spend_point — spend one paragon point into a node

import { getAscension, spendAscensionPoint } from "../lib/ascension.js";

export default function registerAscensionMacros(register) {
  register("ascension", "get", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, ...getAscension(db, userId) };
  });

  register("ascension", "spend_point", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || !input.nodeId) return { ok: false, reason: "missing_inputs" };
    return spendAscensionPoint(db, userId, input.nodeId);
  });
}
