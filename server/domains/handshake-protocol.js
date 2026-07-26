// server/domains/handshake-protocol.js
//
// Macro surface for lib/handshake-protocol.js — the concord-link-frontier
// bespoke mechanic (see that file's header for the full lore citations).
// This domain never reimplements the mechanic; it only adapts the real ctx
// (actor/db) into the lib function's own parameter shape.

import { witnessHandshake, getTrustMarksBalance } from "../lib/handshake-protocol.js";

export default function registerHandshakeProtocolMacros(register) {
  register("handshake", "witness", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return witnessHandshake(db, {
      userId,
      fromWorld: input.fromWorld,
      fromNpcId: input.fromNpcId,
      toWorld: input.toWorld,
      toNpcId: input.toNpcId,
      trustMarksToSpend: input.trustMarksToSpend,
    });
  }, { note: "spend trust_marks to witness (boost) a cross-world resonance edge from a concord-link-frontier NPC" });

  register("handshake", "trust_marks_balance", async (ctx) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };
    return { ok: true, balance: getTrustMarksBalance(db, userId) };
  }, { note: "honest trust_marks balance for the calling user (0 when they hold none)" });
}
