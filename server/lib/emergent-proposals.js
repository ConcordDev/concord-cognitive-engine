// server/lib/emergent-proposals.js
//
// The governance half of the emergent lens-action gate (Q40 / audit A#24).
//
// executeEmergentLensAction (emergent/lens-integration.js) has always
// refused to let an emergent agent execute a MUTATING lens action itself:
// it returns a proposal and waits for governance. Until now the proposal
// went nowhere — returned to the caller, never persisted, never queued,
// never decided, never applied (the only trace was a metrics counter that
// was never incremented). This module is the missing store + lifecycle:
//
//   pending ──decide(governance role)──▶ approved ──apply──▶ applied
//      │                                  │
//      └──decide──▶ rejected (terminal)   └──apply──▶ apply_failed (retriable)
//
// Rules, by design:
// - A proposal applies ONLY from "approved" (or retried from
//   "apply_failed"). Nothing applies from "pending", ever.
// - Decisions are immutable: a decided proposal cannot be re-decided.
// - Only human governance roles may decide (owner / admin / founder /
//   sovereign). An emergent actor can never decide any proposal —
//   including its own.
// - Denials are result objects, never throws, matching the codebase style.
//
// Storage follows the STATE.lensArtifacts convention: a Map on STATE,
// serialized by the state save/restore wiring in server.js.

export const GOVERNANCE_ROLES = new Set(["owner", "admin", "founder", "sovereign"]);

let _seq = 0;

export function ensureProposalStore(STATE) {
  if (!(STATE?.emergentLensProposals instanceof Map)) {
    if (!STATE || typeof STATE !== "object") return new Map();
    STATE.emergentLensProposals = new Map();
  }
  return STATE.emergentLensProposals;
}

export function createLensProposal(STATE, proposal = {}) {
  const store = ensureProposalStore(STATE);
  const id = `elp_${Date.now().toString(36)}_${(++_seq).toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const record = {
    ...proposal,
    id,
    type: proposal.type || "lens_action",
    status: "pending",
    createdAt: proposal.createdAt || new Date().toISOString(),
    decidedBy: null,
    decidedByRole: null,
    decidedAt: null,
    appliedAt: null,
    applyResult: null,
    applyError: null,
  };
  store.set(id, record);
  return record;
}

export function getLensProposal(STATE, proposalId) {
  return ensureProposalStore(STATE).get(proposalId) || null;
}

export function listLensProposals(STATE, { status } = {}) {
  const all = Array.from(ensureProposalStore(STATE).values());
  const filtered = status ? all.filter((p) => p.status === status) : all;
  return filtered.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function decideLensProposal(STATE, proposalId, { decision, decidedBy = null, decidedByRole = null } = {}) {
  if (!GOVERNANCE_ROLES.has(decidedByRole)) {
    return { ok: false, error: "not_governance_role" };
  }
  if (decision !== "approved" && decision !== "rejected") {
    return { ok: false, error: "invalid_decision" };
  }
  const proposal = getLensProposal(STATE, proposalId);
  if (!proposal) return { ok: false, error: "proposal_not_found" };
  if (proposal.status !== "pending") {
    return { ok: false, error: "already_decided", status: proposal.status };
  }
  proposal.status = decision;
  proposal.decidedBy = decidedBy;
  proposal.decidedByRole = decidedByRole;
  proposal.decidedAt = new Date().toISOString();
  return { ok: true, proposal };
}

export function recordProposalApplication(STATE, proposalId, { ok, result = null, error = null } = {}) {
  const proposal = getLensProposal(STATE, proposalId);
  if (!proposal) return { ok: false, error: "proposal_not_found" };
  if (proposal.status !== "approved" && proposal.status !== "apply_failed") {
    return { ok: false, error: "proposal_not_applicable", status: proposal.status };
  }
  proposal.status = ok ? "applied" : "apply_failed";
  proposal.appliedAt = new Date().toISOString();
  proposal.applyResult = ok ? result : proposal.applyResult;
  proposal.applyError = ok ? null : String(error || "apply_failed");
  return { ok: true, proposal };
}

export default {
  GOVERNANCE_ROLES,
  ensureProposalStore,
  createLensProposal,
  getLensProposal,
  listLensProposals,
  decideLensProposal,
  recordProposalApplication,
};
