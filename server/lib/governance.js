// server/lib/governance.js
//
// Voting surface for constitutional constants. The constants themselves
// are not changed by this module — they're constants in code. What this
// module does is record proposals + votes + tallies so an operator can
// see clearly: "the federation has voted to lower the platform fee
// from 5% to 3%; merge a code change to that effect when you're ready."
//
// The governance row is the AUDIT TRAIL. The code change is the
// implementation. Keeping them separate prevents surprise constitutional
// drift via env var or DB tampering — every change requires both a
// vote and a deploy.

import crypto from "node:crypto";
import logger from "../logger.js";

const MIN_QUORUM = 3;
const MAX_QUORUM = 100;
const MIN_THRESHOLD = 0.5;
const MAX_THRESHOLD = 0.95;
const DEFAULT_DURATION_S = 7 * 86400; // 7 days

// Allow-list of constants the governance surface can record proposals for.
// Adding a path here doesn't expose the constant to live mutation — it just
// permits the proposal to be recorded.
export const GOVERNED_CONSTANTS = Object.freeze([
  "marketplace.platform_fee_rate",
  "marketplace.creator_share",
  "marketplace.royalty_share",
  "marketplace.treasury_share",
  "royalty.initial_rate",
  "royalty.halving",
  "royalty.floor",
  "royalty.max_rate",
  "royalty.max_cascade_depth",
  "withdrawals.hold_hours",
]);

export function openProposal(db, opts) {
  if (!db) return { ok: false, reason: "no_db" };
  const { title, summary, proposerId, constantPath, currentValue, proposedValue, rationale, quorum, thresholdPct, durationS } = opts || {};
  if (!title || !summary || !proposerId || !constantPath || currentValue == null || proposedValue == null) {
    return { ok: false, reason: "missing_inputs" };
  }
  if (!GOVERNED_CONSTANTS.includes(constantPath)) {
    return { ok: false, reason: "constant_not_governed", path: constantPath };
  }

  const q = Math.max(MIN_QUORUM, Math.min(MAX_QUORUM, Number(quorum) || 5));
  const t = Math.max(MIN_THRESHOLD, Math.min(MAX_THRESHOLD, Number(thresholdPct) || 0.66));
  const dur = Math.max(60, Math.min(30 * 86400, Number(durationS) || DEFAULT_DURATION_S));

  const id = `gp_${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare(`
      INSERT INTO governance_proposals
        (id, title, summary, proposer_id, constant_path,
         current_value, proposed_value, rationale,
         status, quorum, threshold_pct, opened_at, closes_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)
    `).run(id, title, summary, proposerId, constantPath,
           String(currentValue), String(proposedValue), rationale || null,
           q, t, now, now + dur);
    return { ok: true, proposalId: id, closesAt: now + dur };
  } catch (err) {
    try { logger.warn?.("governance", "open_proposal_failed", { error: err?.message }); }
    catch { /* ignore */ }
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function castVote(db, { proposalId, voterId, vote }) {
  if (!db || !proposalId || !voterId || !vote) return { ok: false, reason: "missing_inputs" };
  if (!["yes", "no", "abstain"].includes(vote)) return { ok: false, reason: "bad_vote" };

  const proposal = db.prepare(`SELECT status, closes_at FROM governance_proposals WHERE id = ?`).get(proposalId);
  if (!proposal) return { ok: false, reason: "proposal_not_found" };
  if (proposal.status !== "open") return { ok: false, reason: "proposal_closed" };
  if (proposal.closes_at < Math.floor(Date.now() / 1000)) {
    return { ok: false, reason: "voting_window_closed" };
  }

  try {
    db.prepare(`
      INSERT INTO governance_votes (proposal_id, voter_id, vote, cast_at)
      VALUES (?, ?, ?, unixepoch())
      ON CONFLICT(proposal_id, voter_id) DO UPDATE SET
        vote = excluded.vote, cast_at = excluded.cast_at
    `).run(proposalId, voterId, vote);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function tallyProposal(db, proposalId) {
  if (!db || !proposalId) return null;
  const proposal = db.prepare(`SELECT * FROM governance_proposals WHERE id = ?`).get(proposalId);
  if (!proposal) return null;

  const votes = db.prepare(`SELECT vote, COUNT(*) AS n FROM governance_votes WHERE proposal_id = ? GROUP BY vote`).all(proposalId);
  const counts = { yes: 0, no: 0, abstain: 0 };
  for (const v of votes) counts[v.vote] = v.n || 0;
  const totalCast = counts.yes + counts.no + counts.abstain;
  const totalDecisive = counts.yes + counts.no;
  const yesPct = totalDecisive > 0 ? counts.yes / totalDecisive : 0;
  const quorumMet = totalCast >= proposal.quorum;
  const passes = quorumMet && yesPct >= proposal.threshold_pct;

  return {
    proposal,
    counts,
    totalCast,
    yesPct: Math.round(yesPct * 1000) / 1000,
    quorumMet,
    passes,
  };
}

/**
 * Resolve a proposal: if quorum + threshold met → 'passed'; if past
 * close window without that, 'rejected'. Idempotent.
 */
export function resolveIfDue(db, proposalId) {
  const tally = tallyProposal(db, proposalId);
  if (!tally) return { ok: false, reason: "not_found" };
  const p = tally.proposal;
  if (p.status !== "open") return { ok: true, action: "noop", reason: "already_closed" };

  const now = Math.floor(Date.now() / 1000);
  const expired = p.closes_at < now;

  let newStatus = null;
  if (tally.passes) newStatus = "passed";
  else if (expired) newStatus = "rejected";

  if (!newStatus) return { ok: true, action: "still_open", tally };

  try {
    db.prepare(`UPDATE governance_proposals SET status = ?, closed_at = unixepoch() WHERE id = ? AND status = 'open'`)
      .run(newStatus, proposalId);
    return { ok: true, action: newStatus, tally };
  } catch (err) {
    return { ok: false, reason: "update_failed", error: err?.message };
  }
}

export function listOpenProposals(db, limit = 50) {
  if (!db) return [];
  try {
    return db.prepare(`
      SELECT * FROM governance_proposals
      WHERE status = 'open' AND closes_at > unixepoch()
      ORDER BY opened_at DESC LIMIT ?
    `).all(limit);
  } catch { return []; }
}

export function listAllProposals(db, limit = 100) {
  if (!db) return [];
  try {
    return db.prepare(`SELECT * FROM governance_proposals ORDER BY opened_at DESC LIMIT ?`).all(limit);
  } catch { return []; }
}
