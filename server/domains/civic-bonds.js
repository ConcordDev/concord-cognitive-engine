// server/domains/civic-bonds.js
//
// Macro surface for the Civic Capital micro-bond engine (lib/civic-bonds.js).
// The /lenses/civic-bonds lens runs these through POST /api/lens/run.
// All gated behind CONCORD_CIVIC_BONDS (off → { ok:false, reason:'disabled' }).
//
//   read:  civic_bonds.list / get / spillover / scopes / ledger
//   write: create / open / vote / pledge / unpledge / fund / complete_milestone
//          / complete / fail   (require ctx.actor.userId)

import {
  civicBondsEnabled, createBond, getBond, listBonds, openBondForVoting, voteBond,
  checkQuorum, pledgeToBond, unpledge, fundBond, completeMilestone, completeBond,
  failBond, getSpillover, raidBondEscrow,
} from "../lib/civic-bonds.js";
import { isAdmin, requireActor } from "../lib/lens-authz.js";
// GOVERNANCE_SCOPES is the canonical town->city->county->state->national->
// international hierarchy (the same single conceptual source the migration
// 305 `civic_bonds.scope` column comment points at: "-- GOVERNANCE_SCOPES").
// It lives on the legacy in-memory sibling engine; reused here read-only so
// the lens's scope picker is fed by real structured data, not a free-text
// field or an invented list.
import { GOVERNANCE_SCOPES } from "../emergent/microbond-governance.js";

function gate(ctx) {
  if (!civicBondsEnabled()) return { ok: false, reason: "disabled" };
  if (!ctx?.db) return { ok: false, reason: "no_db" };
  return null;
}
// Fail-CLOSED numeric guard (mirrors server/domains/literary.js#badNumericField):
// any present numeric field that is NaN / Infinity / negative / absurd is
// rejected up front so a poisoned payload can never reach the engine. Returns
// the offending key or null. The lib also re-validates downstream (belt + braces).
function badNumericField(input, keys) {
  for (const k of keys) {
    if (input[k] === undefined || input[k] === null) continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n) || n < 0 || n > 1e9) return k;
  }
  return null;
}
function requireBondManager(ctx, bondId) {
  const auth = requireActor(ctx);
  if (!auth.ok) return auth;
  const uid = auth.actorId;

  const r = getBond(ctx.db, bondId);
  if (!r.ok) return r;
  const bond = r.bond;

  // Proposer always controls the bond lifecycle.
  if (uid === String(bond.proposer_id || "")) return { ok: true, actorId: uid, bond };

  // Global admins may intervene.
  if (isAdmin(ctx)) return { ok: true, actorId: uid, bond };

  // Realm ruler may manage bonds tied to their realm (this is also the lawful
  // path for the corruption mechanic: raid by the realm ruler).
  if (bond.realm_id) {
    const realm = ctx.db.prepare(`SELECT ruler_kind, ruler_id FROM realms WHERE id = ?`).get(bond.realm_id);
    if (realm?.ruler_kind === "player" && realm?.ruler_id === uid) {
      return { ok: true, actorId: uid, bond };
    }
  }

  // Org leader/officer may manage bonds scoped to their organization.
  if (bond.org_id) {
    const org = ctx.db.prepare(`SELECT leader_id FROM world_organizations WHERE id = ?`).get(bond.org_id);
    if (org?.leader_id === uid) return { ok: true, actorId: uid, bond };
    const member = ctx.db.prepare(`SELECT role FROM org_members WHERE org_id = ? AND user_id = ?`).get(bond.org_id, uid);
    if (member?.role === "leader" || member?.role === "officer") {
      return { ok: true, actorId: uid, bond };
    }
  }

  // NOTE: faction_id has no runtime player-role table in this schema, so a
  // faction-scoped bond can only be managed by its proposer or an admin. That
  // is a known product gap — leave for the owner to decide.
  return { ok: false, reason: "forbidden" };
}

export default function registerCivicBondsMacros(register) {
  // ── reads ──────────────────────────────────────────────────────────────
  register("civic_bonds", "list", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    return { ok: true, bonds: listBonds(ctx.db, { worldId: input.worldId, realmId: input.realmId, status: input.status }) };
  }, { note: "list civic bonds (public read)" });

  register("civic_bonds", "get", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const r = getBond(ctx.db, input.bondId);
    if (!r.ok) return r;
    return { ok: true, ...r, quorum: checkQuorum(ctx.db, input.bondId) };
  }, { note: "bond detail + pledges + milestones + quorum (public read)" });

  register("civic_bonds", "spillover", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    return { ok: true, amount: getSpillover(ctx.db, input.scope || "city", input.worldId) };
  }, { note: "restricted spillover fund by scope+world (public read)" });

  // The natural per-scope selector for the spillover query above: the fixed
  // town->city->county->state->national->international governance hierarchy
  // (GOVERNANCE_SCOPES), not an arbitrary client-typed string.
  register("civic_bonds", "scopes", async (ctx) => {
    const g = gate(ctx); if (g) return g;
    return { ok: true, scopes: GOVERNANCE_SCOPES };
  }, { note: "the valid GOVERNANCE_SCOPES tiers, for the spillover scope picker (public read)" });

  // The public ledger = the bond's full pledge + payout audit trail (transparency).
  register("civic_bonds", "ledger", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const r = getBond(ctx.db, input.bondId);
    if (!r.ok) return r;
    return { ok: true, bondId: input.bondId, pledges: r.pledges, milestones: r.milestones };
  }, { note: "public ledger: every pledge + milestone (public read)" });

  // ── writes (auth) ──────────────────────────────────────────────────────
  register("civic_bonds", "create", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const auth = requireActor(ctx); if (!auth.ok) return auth; const uid = auth.actorId;
    const bad = badNumericField(input, ["targetAmount", "denomination", "returnRate", "quorum", "approvalThreshold"]);
    if (bad) return { ok: false, reason: "bad_numeric_field", field: bad };
    return createBond(ctx.db, { ...input, proposerId: uid });
  }, { note: "open a bond drive (ruler/leader/officer)" });

  register("civic_bonds", "open", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const auth = requireActor(ctx); if (!auth.ok) return auth; const uid = auth.actorId;
    const mgr = requireBondManager(ctx, input.bondId); if (!mgr.ok) return mgr;
    return openBondForVoting(ctx.db, input.bondId, uid);
  }, { note: "move a bond to voting" });

  register("civic_bonds", "vote", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const auth = requireActor(ctx); if (!auth.ok) return auth; const uid = auth.actorId;
    return voteBond(ctx.db, input.bondId, uid, input.vote);
  }, { note: "cast one vote (idempotent per voter)" });

  register("civic_bonds", "pledge", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const auth = requireActor(ctx); if (!auth.ok) return auth; const uid = auth.actorId;
    const bad = badNumericField(input, ["amount"]);
    if (bad) return { ok: false, reason: "bad_numeric_field", field: bad };
    return pledgeToBond(ctx.db, input.bondId, { entityKind: "player", entityId: uid, amount: input.amount });
  }, { note: "pledge sparks (escrowed, 5% cap, denomination-stepped)" });

  register("civic_bonds", "unpledge", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const auth = requireActor(ctx); if (!auth.ok) return auth; const uid = auth.actorId;
    return unpledge(ctx.db, input.bondId, { entityKind: "player", entityId: uid });
  }, { note: "refund your unfilled escrow (while voting/funding)" });

  register("civic_bonds", "fund", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const auth = requireActor(ctx); if (!auth.ok) return auth; const uid = auth.actorId;
    const mgr = requireBondManager(ctx, input.bondId); if (!mgr.ok) return mgr;
    return fundBond(ctx.db, input.bondId, uid);
  }, { note: "fund a bond — enforces the 110% pre-funding gate" });

  register("civic_bonds", "complete_milestone", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const auth = requireActor(ctx); if (!auth.ok) return auth; const uid = auth.actorId;
    const mgr = requireBondManager(ctx, input.bondId); if (!mgr.ok) return mgr;
    const bad = badNumericField(input, ["idx"]);
    if (bad) return { ok: false, reason: "bad_numeric_field", field: bad };
    return completeMilestone(ctx.db, input.bondId, input.idx);
  }, { note: "mark a milestone complete" });

  register("civic_bonds", "complete", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const auth = requireActor(ctx); if (!auth.ok) return auth; const uid = auth.actorId;
    const mgr = requireBondManager(ctx, input.bondId); if (!mgr.ok) return mgr;
    return completeBond(ctx.db, input.bondId);
  }, { note: "closeout: pay capped returns + spillover" });

  register("civic_bonds", "fail", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const auth = requireActor(ctx); if (!auth.ok) return auth; const uid = auth.actorId;
    const mgr = requireBondManager(ctx, input.bondId); if (!mgr.ok) return mgr;
    return failBond(ctx.db, input.bondId, input.reason);
  }, { note: "fail the bond: refund unspent escrow" });

  // The corrupt option — raid the restricted escrow into the treasury. Lawful
  // rulers never call this; doing so collapses legitimacy + raises refusal_debt.
  register("civic_bonds", "raid", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const auth = requireActor(ctx); if (!auth.ok) return auth; const uid = auth.actorId;
    const mgr = requireBondManager(ctx, input.bondId); if (!mgr.ok) return mgr;
    return raidBondEscrow(ctx.db, input.bondId, uid);
  }, { note: "CORRUPT: divert escrow to treasury (legitimacy + refusal_debt fallout)" });
}

/**
 * INC-SWEEP F1 — bridge every civic_bonds macro into LENS_ACTIONS.
 *
 * `/api/lens/run` prefers LENS_ACTIONS over MACROS. COMMON_ACTIONS in server.js
 * registers a generic artifact `vote` for every ALL_LENS_DOMAINS entry (including
 * civic_bonds) that does `Number(params.vote)` → NaN/`score:null` + increments
 * `artifact.data.voteCount`. That shadowed `voteBond` and left tallies at 0.
 *
 * Called from domains/index.js *before* COMMON_ACTIONS so the
 * `if (!LENS_ACTIONS.has(key))` guard skips the generic vote for this domain.
 * Signature mirrors registerLensAction: (ctx, artifact, params) → domain fn(ctx, params).
 *
 * INC-SWEEP batch 012 made the systemic fix (COMMON_ACTIONS skip when MACROS
 * owns the pair + resolveDualRegistry prefers MACROS over common fill-ins).
 * This bridge is kept as belt-and-suspenders so civic_bonds verbs stay
 * first-class LENS_ACTIONS even if the common-keys set is cleared.
 */
export function registerCivicBondsLensActions(registerLensAction) {
  registerCivicBondsMacros((domain, name, fn) => {
    registerLensAction(domain, name, async (ctx, _artifact, params = {}) => fn(ctx, params || {}));
  });
}
