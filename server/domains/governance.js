// server/domains/governance.js
//
// Macro surface for proposing + voting on constitutional constants.

import {
  openProposal,
  castVote,
  tallyProposal,
  resolveIfDue,
  listOpenProposals,
  listAllProposals,
  GOVERNED_CONSTANTS,
} from "../lib/governance.js";

export default function registerGovernanceMacros(register) {
  register("governance", "open_proposal", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const proposerId = ctx?.actor?.userId;
    if (!proposerId) return { ok: false, reason: "no_actor" };
    return openProposal(db, {
      title: input.title,
      summary: input.summary,
      proposerId,
      constantPath: input.constantPath,
      currentValue: input.currentValue,
      proposedValue: input.proposedValue,
      rationale: input.rationale,
      quorum: input.quorum,
      thresholdPct: input.thresholdPct,
      durationS: input.durationS,
    });
  }, { note: "open a proposal to amend a governed constant" });

  register("governance", "cast_vote", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const voterId = ctx?.actor?.userId;
    if (!voterId) return { ok: false, reason: "no_actor" };
    return castVote(db, {
      proposalId: input.proposalId,
      voterId,
      vote: input.vote,
    });
  }, { note: "cast yes/no/abstain on a proposal" });

  register("governance", "tally", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const t = tallyProposal(db, input.proposalId);
    return t ? { ok: true, ...t } : { ok: false, reason: "not_found" };
  }, { note: "current tally for a proposal" });

  register("governance", "resolve", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return resolveIfDue(db, input.proposalId);
  }, { note: "resolve a proposal if quorum/threshold met or window expired" });

  register("governance", "list_open", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, proposals: listOpenProposals(db) };
  }, { note: "list currently-open proposals" });

  register("governance", "list_all", async (ctx, _input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    return { ok: true, proposals: listAllProposals(db) };
  }, { note: "list all proposals (open + closed)" });

  register("governance", "list_governed_constants", async (_ctx, _input = {}) => {
    return { ok: true, constants: [...GOVERNED_CONSTANTS] };
  }, { note: "list which constants can be proposed against" });
}
