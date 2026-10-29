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
// - The store is bounded: pending proposals expire after a TTL, an
//   identical pending proposal is returned instead of duplicated, pending
//   counts are capped (globally and per emergent), and old terminal
//   records are pruned past a retention size.
//
// Storage follows the STATE.lensArtifacts convention: a Map on STATE,
// serialized by the state save/restore wiring in server.js.

export const GOVERNANCE_ROLES = new Set(["owner", "admin", "founder", "sovereign"]);

export const PROPOSAL_LIMITS = Object.freeze({
  maxPending: 500,
  maxPendingPerEmergent: 25,
  pendingTtlMs: 7 * 24 * 60 * 60 * 1000,
  maxStored: 2000,
});

const TERMINAL = new Set(["rejected", "applied", "expired"]);

function _createdMs(p) {
  const t = Date.parse(p?.createdAt);
  return Number.isFinite(t) ? t : 0;
}

function _dedupeKey(p) {
  let params = "";
  try { params = JSON.stringify(p.params ?? {}); } catch { params = String(p.params); }
  return `${p.emergentId}|${p.artifactId}|${p.action}|${params}`;
}

/**
 * Expire stale pending proposals and drop the oldest terminal records
 * past PROPOSAL_LIMITS.maxStored. Returns { expired, pruned }.
 */
export function pruneLensProposals(STATE, now = Date.now()) {
  const store = ensureProposalStore(STATE);
  let expired = 0;
  for (const p of store.values()) {
    if (p.status === "pending" && now - _createdMs(p) > PROPOSAL_LIMITS.pendingTtlMs) {
      p.status = "expired";
      p.decidedAt = new Date(now).toISOString();
      expired++;
    }
  }
  let pruned = 0;
  if (store.size > PROPOSAL_LIMITS.maxStored) {
    const terminal = Array.from(store.values())
      .filter((p) => TERMINAL.has(p.status))
      .sort((a, b) => _createdMs(a) - _createdMs(b));
    for (const p of terminal) {
      if (store.size <= PROPOSAL_LIMITS.maxStored) break;
      store.delete(p.id);
      pruned++;
    }
  }
  return { expired, pruned };
}

/** An emergent or internal (server-process) actor — never a human decider. */
export function isEmergentActor({ userId, internal } = {}) {
  return internal === true || String(userId || "").startsWith("emergent:");
}

let _seq = 0;

export function ensureProposalStore(STATE) {
  if (!(STATE?.emergentLensProposals instanceof Map)) {
    if (!STATE || typeof STATE !== "object") return new Map();
    STATE.emergentLensProposals = new Map();
  }
  return STATE.emergentLensProposals;
}

/**
 * Queue a proposal. Returns { ok:true, proposal, deduped? } or
 * { ok:false, error } when a pending cap is reached.
 */
export function createLensProposal(STATE, proposal = {}, { now = Date.now() } = {}) {
  const store = ensureProposalStore(STATE);
  pruneLensProposals(STATE, now);
  const key = _dedupeKey(proposal);
  let pending = 0;
  let pendingForEmergent = 0;
  for (const p of store.values()) {
    if (p.status !== "pending") continue;
    if (_dedupeKey(p) === key) return { ok: true, proposal: p, deduped: true };
    pending++;
    if (p.emergentId === proposal.emergentId) pendingForEmergent++;
  }
  if (pending >= PROPOSAL_LIMITS.maxPending) {
    return { ok: false, error: "proposal_queue_full", limit: PROPOSAL_LIMITS.maxPending };
  }
  if (pendingForEmergent >= PROPOSAL_LIMITS.maxPendingPerEmergent) {
    return { ok: false, error: "emergent_pending_cap", limit: PROPOSAL_LIMITS.maxPendingPerEmergent };
  }
  const id = `elp_${now.toString(36)}_${(++_seq).toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
  const record = {
    ...proposal,
    id,
    type: proposal.type || "lens_action",
    status: "pending",
    createdAt: proposal.createdAt || new Date(now).toISOString(),
    decidedBy: null,
    decidedByRole: null,
    decidedAt: null,
    appliedAt: null,
    applyResult: null,
    applyError: null,
  };
  store.set(id, record);
  return { ok: true, proposal: record };
}

export function getLensProposal(STATE, proposalId) {
  return ensureProposalStore(STATE).get(proposalId) || null;
}

export function listLensProposals(STATE, { status } = {}) {
  pruneLensProposals(STATE);
  const all = Array.from(ensureProposalStore(STATE).values());
  const filtered = status ? all.filter((p) => p.status === status) : all;
  return filtered.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export function decideLensProposal(STATE, proposalId, { decision, decidedBy = null, decidedByRole = null, internal = false } = {}) {
  // Checked before the role: emergent execution elevates its ctx to
  // role "owner", so the role alone cannot tell a human from an emergent.
  if (isEmergentActor({ userId: decidedBy, internal })) {
    return { ok: false, error: "emergent_cannot_decide" };
  }
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
  PROPOSAL_LIMITS,
  ensureProposalStore,
  pruneLensProposals,
  isEmergentActor,
  createLensProposal,
  getLensProposal,
  listLensProposals,
  decideLensProposal,
  recordProposalApplication,
};
