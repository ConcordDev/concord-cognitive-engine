// server/domains/player-corpse.js
//
// Theme deferred (game-feel pass): macros for the shadow-corpse
// substrate. Authors / runtime callers fire `playerCorpse.drop` on
// player death; clients call `playerCorpse.active` to discover their
// recoverable corpse and `playerCorpse.recover` to reclaim coins.

import {
  dropCorpseOnDeath,
  activeCorpsesFor,
  recoverCorpse,
  RECOVER_RADIUS_M,
} from "../lib/player-corpse.js";

export default function registerPlayerCorpseMacros(register) {
  register("playerCorpse", "drop", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    // Server-side callers (combat-kill path) supply userId; auth-required
    // for client paths so a malicious client can't drop arbitrary corpses
    // for someone else.
    const userId = input.userId || ctx?.actor?.userId || null;
    if (!userId) return { ok: false, reason: "auth_required" };
    return dropCorpseOnDeath(db, { ...input, userId });
  }, { note: "drop a recoverable corpse on player death" });

  register("playerCorpse", "active", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || null;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    return {
      ok: true,
      corpses: activeCorpsesFor(db, { userId, worldId: input.worldId }),
      recoverRadiusM: RECOVER_RADIUS_M,
    };
  }, { note: "list the caller's active corpses in a world" });

  register("playerCorpse", "recover", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId || null;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: false, reason: "auth_required" };
    return recoverCorpse(db, {
      userId,
      corpseId: input.corpseId,
      position: input.position,
    });
  }, { note: "recover coins from an active corpse within RECOVER_RADIUS_M" });
}
