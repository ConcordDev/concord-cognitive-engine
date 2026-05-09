// server/domains/land-claims.js
//
// Phase 5a — macro surface for claims.

import {
  claimLand,
  inviteToClaim,
  topUpBond,
  claimAt,
  canActIn,
  listClaimsForUser,
} from "../lib/land-claims.js";

export default function registerLandClaimsMacros(register) {
  register("land_claims", "claim", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return claimLand(db, {
      userId,
      worldId: input.worldId,
      x: input.x, z: input.z,
      radiusM: input.radiusM,
    });
  }, { note: "claim a circular plot" });

  register("land_claims", "invite", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return inviteToClaim(db, {
      claimId: input.claimId,
      userId: input.userId,
      role: input.role,
      invitedBy: ctx?.actor?.userId,
    });
  }, { note: "invite a co-owner / guest / tax_collector" });

  register("land_claims", "topup", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return topUpBond(db, {
      claimId: input.claimId,
      userId: ctx?.actor?.userId,
      amount: input.amount,
    });
  }, { note: "top up a claim's maintenance bond" });

  register("land_claims", "claim_at", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const c = claimAt(db, input.worldId, input.x, input.z);
    return { ok: true, claim: c || null };
  }, { note: "find the claim covering a point (or null)" });

  register("land_claims", "can_act_in", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const ok = canActIn(db, input.worldId, input.x, input.z, ctx?.actor?.userId, input.action || "build");
    return { ok: true, allowed: ok };
  }, { note: "permission check for a point + action" });

  register("land_claims", "list_for_user", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return { ok: true, claims: listClaimsForUser(db, userId) };
  }, { note: "list user's claims (owned + invited)" });
}
