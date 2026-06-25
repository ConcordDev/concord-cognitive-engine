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
import { projectImpact, simulateProposal, getSimulation } from "../lib/governance-sim.js";

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

  // #41 Governance Proposal Simulator — project a proposal's policy impact on a
  // reference scenario BEFORE voting ("if this passes → X changes by Y"). Pure
  // projection on a snapshot; no live constant changes.
  register("governance", "simulate", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    if (input.proposalId) return simulateProposal(db, input.proposalId);
    // Ad-hoc projection without a stored proposal.
    return projectImpact(input.constantPath, input.currentValue, input.proposedValue);
  }, { note: "project a proposal's policy impact on a reference scenario (#41)" });

  register("governance", "simulation", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const sim = getSimulation(db, input.proposalId);
    return sim ? { ok: true, ...sim } : { ok: false, reason: "not_simulated" };
  }, { note: "read a proposal's cached impact projection (#41)" });
}
