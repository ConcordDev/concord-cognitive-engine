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

  // kingdoms.my_realm — used by the in-world RulerHUD. Returns the
  // first realm where ruler_kind='player' AND ruler_id=actor.userId,
  // bundled with loyalty + rebellion risk + active decrees +
  // pending-threat (rebellion-leader) list. Null if player rules
  // nothing.
  register("kingdoms", "my_realm", async (ctx) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db) return { ok: false, reason: "no_db" };
    if (!userId) return { ok: true, realm: null };
    let realm;
    try {
      realm = db.prepare(`
        SELECT id, name, world_id, capital_settlement_id, faction_id,
               ruler_kind, ruler_id, legitimacy, treasury, tax_rate,
               founded_at, next_decree_at, updated_at
        FROM realms WHERE ruler_kind = 'player' AND ruler_id = ?
        ORDER BY founded_at ASC LIMIT 1
      `).get(userId);
    } catch { return { ok: true, realm: null }; }
    if (!realm) return { ok: true, realm: null };

    let loyalty = null, rebellionRisk = null, activeDecrees = [], rebellions = [];
    try { loyalty = kingdomLoyaltySummary(db, realm.id); } catch { /* noop */ }
    try { rebellionRisk = evaluateRebellionRisk(db, realm.id); } catch { /* noop */ }
    try {
      activeDecrees = db.prepare(`
        SELECT id, kind, body_json, issued_at, expires_at, popularity_delta
        FROM realm_decrees WHERE kingdom_id = ? AND effect_state = 'active'
        ORDER BY issued_at DESC LIMIT 10
      `).all(realm.id);
    } catch { /* noop */ }
    try { rebellions = listRebellionsForKingdom(db, realm.id); } catch { /* noop */ }

    return { ok: true, realm, loyalty, rebellionRisk, activeDecrees, rebellions };
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
