// server/domains/kingdoms.js
//
// Sprint C / Track D — macro surface for kingdoms / decrees / takeover /
// rebellion. The RulerHUD and DecreeComposer frontend lenses read these.

import {
  listKingdomsForWorld,
  getKingdom,
  recomputeCitizenLoyalty,
  decreesActiveForRegion,
  kingdomLoyaltySummary,
} from "../lib/kingdoms.js";
import {
  proposeDecree,
  issueDecree,
  revokeDecree,
} from "../lib/kingdom-decrees.js";
import {
  takeoverByConquest,
  takeoverByInheritance,
  takeoverByElection,
  deposeRuler,
} from "../lib/kingdom-takeover.js";
import {
  evaluateRebellionRisk,
  listRebellionsForKingdom,
} from "../lib/kingdom-rebellion.js";

export default function registerKingdomsMacros(register) {
  register("kingdoms", "list", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const worldId = input.worldId;
    if (!worldId) return { ok: false, reason: "no_world" };
    return { ok: true, kingdoms: listKingdomsForWorld(db, worldId) };
  });

  register("kingdoms", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    const k = getKingdom(db, input.kingdomId);
    if (!k) return { ok: false, reason: "not_found" };
    const loyalty = kingdomLoyaltySummary(db, input.kingdomId);
    const rebellions = listRebellionsForKingdom(db, input.kingdomId);
    return { ok: true, kingdom: k, loyalty, rebellions };
  });

  register("kingdoms", "kingdom_status", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    return {
      ok: true,
      kingdom: getKingdom(db, input.kingdomId),
      loyalty: kingdomLoyaltySummary(db, input.kingdomId),
      rebellionRisk: evaluateRebellionRisk(db, input.kingdomId),
    };
  });

  register("kingdoms", "decrees_for_region", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.regionId) return { ok: false, reason: "missing_inputs" };
    return { ok: true, decrees: decreesActiveForRegion(db, input.regionId) };
  });

  register("kingdoms", "propose_decree", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId || !input.kingdomId || !input.kind) return { ok: false, reason: "missing_inputs" };
    // Player ruler check is enforced inside proposeDecree (issuedByKind +
    // ruler_id match).
    const r = proposeDecree(db, input.kingdomId, {
      kind: input.kind,
      body: input.body || {},
      issuedByKind: "player",
      issuedById: userId,
    });
    if (r?.ok && r.id) {
      issueDecree(db, r.id, { io: ctx?.app?.locals?.io });
    }
    return r;
  });

  register("kingdoms", "revoke_decree", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.decreeId) return { ok: false, reason: "missing_inputs" };
    const userId = ctx?.actor?.userId;
    return revokeDecree(db, input.decreeId, userId);
  });

  register("kingdoms", "recompute_loyalty", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    return recomputeCitizenLoyalty(db, input.kingdomId);
  });

  // Takeover paths.
  register("kingdoms", "takeover_conquest", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    return takeoverByConquest(db, userId, input.kingdomId, input.proof || {});
  });

  register("kingdoms", "takeover_inheritance", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    return takeoverByInheritance(db, userId, input.kingdomId, {
      viaSchemeId: input.viaSchemeId, heirOfNpcId: input.heirOfNpcId,
    });
  });

  register("kingdoms", "takeover_election", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    return takeoverByElection(db, userId, input.kingdomId, {
      proposalId: input.proposalId, voterTurnoutOk: input.voterTurnoutOk !== false,
    });
  });

  register("kingdoms", "depose_ruler", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db || !input.kingdomId) return { ok: false, reason: "missing_inputs" };
    return deposeRuler(db, input.kingdomId, input.reason);
  });
}
