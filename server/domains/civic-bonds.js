// server/domains/civic-bonds.js
//
// Macro surface for the Civic Capital micro-bond engine (lib/civic-bonds.js).
// The /lenses/civic-bonds lens runs these through POST /api/lens/run.
// All gated behind CONCORD_CIVIC_BONDS (off → { ok:false, reason:'disabled' }).
//
//   read:  civic_bonds.list / get / spillover / ledger
//   write: create / open / vote / pledge / unpledge / fund / complete_milestone
//          / complete / fail   (require ctx.actor.userId)

import {
  civicBondsEnabled, createBond, getBond, listBonds, openBondForVoting, voteBond,
  checkQuorum, pledgeToBond, unpledge, fundBond, completeMilestone, completeBond,
  failBond, getSpillover, raidBondEscrow,
} from "../lib/civic-bonds.js";

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
function authed(ctx) {
  const uid = ctx?.actor?.userId;
  return uid ? String(uid) : null;
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
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    const bad = badNumericField(input, ["targetAmount", "denomination", "returnRate", "quorum", "approvalThreshold"]);
    if (bad) return { ok: false, reason: "bad_numeric_field", field: bad };
    return createBond(ctx.db, { ...input, proposerId: uid });
  }, { note: "open a bond drive (ruler/leader/officer)" });

  register("civic_bonds", "open", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return openBondForVoting(ctx.db, input.bondId, uid);
  }, { note: "move a bond to voting" });

  register("civic_bonds", "vote", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return voteBond(ctx.db, input.bondId, uid, input.vote);
  }, { note: "cast one vote (idempotent per voter)" });

  register("civic_bonds", "pledge", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    const bad = badNumericField(input, ["amount"]);
    if (bad) return { ok: false, reason: "bad_numeric_field", field: bad };
    return pledgeToBond(ctx.db, input.bondId, { entityKind: "player", entityId: uid, amount: input.amount });
  }, { note: "pledge sparks (escrowed, 5% cap, denomination-stepped)" });

  register("civic_bonds", "unpledge", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return unpledge(ctx.db, input.bondId, { entityKind: "player", entityId: uid });
  }, { note: "refund your unfilled escrow (while voting/funding)" });

  register("civic_bonds", "fund", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return fundBond(ctx.db, input.bondId, uid);
  }, { note: "fund a bond — enforces the 110% pre-funding gate" });

  register("civic_bonds", "complete_milestone", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    const bad = badNumericField(input, ["idx"]);
    if (bad) return { ok: false, reason: "bad_numeric_field", field: bad };
    return completeMilestone(ctx.db, input.bondId, input.idx);
  }, { note: "mark a milestone complete" });

  register("civic_bonds", "complete", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return completeBond(ctx.db, input.bondId);
  }, { note: "closeout: pay capped returns + spillover" });

  register("civic_bonds", "fail", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return failBond(ctx.db, input.bondId, input.reason);
  }, { note: "fail the bond: refund unspent escrow" });

  // The corrupt option — raid the restricted escrow into the treasury. Lawful
  // rulers never call this; doing so collapses legitimacy + raises refusal_debt.
  register("civic_bonds", "raid", async (ctx, input = {}) => {
    const g = gate(ctx); if (g) return g;
    const uid = authed(ctx); if (!uid) return { ok: false, reason: "auth_required" };
    return raidBondEscrow(ctx.db, input.bondId, uid);
  }, { note: "CORRUPT: divert escrow to treasury (legitimacy + refusal_debt fallout)" });
}
