// server/domains/districts.js
//
// Macro surface for player-influenced districts (governance layer alongside
// the read-only server/lib/districts.js — see docs comment there + migration
// 382/server/lib/district-governance.js for the full rationale). Registers
// under the SAME domain string as the (currently unwired) districts-timeline
// analytics domain in domains/district.js ("district") — this file only adds
// the three new macro names below and does not touch that file's macros.

import {
  proposeDistrictChange,
  castVote,
  listProposalsForDistrict,
  getProposal,
} from "../lib/district-governance.js";

export default function registerDistrictGovernanceMacros(register) {
  register("district", "propose_change", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return proposeDistrictChange(db, input.districtId, userId, input.kind, input.value, {
      durationS: input.durationS,
    });
  }, { note: "propose an identity_tag or palette_shift change to a district (gated by real world-residency minutes)" });

  register("district", "vote", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return castVote(db, input.proposalId, userId, input.vote);
  }, { note: "cast a for/against vote on a district proposal (one vote per user, enforced by a composite PRIMARY KEY)" });

  register("district", "list_proposals", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (input.proposalId) {
      const proposal = getProposal(db, input.proposalId);
      return proposal ? { ok: true, proposal } : { ok: false, reason: "not_found" };
    }
    if (!input.districtId) return { ok: false, reason: "missing_district" };
    const proposals = listProposalsForDistrict(db, input.districtId, {
      status: input.status,
      limit: input.limit,
    });
    return { ok: true, proposals, count: proposals.length };
  }, { note: "list proposals for a district (or fetch one by proposalId), each with a live vote tally" });
}
