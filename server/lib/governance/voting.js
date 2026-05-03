// server/lib/governance/voting.js
// Constitutional voting with Refusal Algebra trinary weight encoding.
// Vote types map to base-6 glyphs: Pivot (creation), Bridge (neutral), Refusal (opposition).

import { decimalToRefusalGlyphs } from "../refusal-algebra/index.js";

// Trinary vote structure: -1, 0, +1 expressed as creation/bridge/refusal
const VOTE_WEIGHTS = Object.freeze({
  creation: 1,   // Pivot ⟲ — constructive affirmation
  bridge:   0,   // Bridge ⊚ — neutral / abstain
  refusal:  -1,  // Refusal ⟐ — structural opposition
});

const VOTE_GLYPHS = Object.freeze({
  creation: "⟲",
  bridge:   "⊚",
  refusal:  "⟐",
});

/**
 * Cast a constitutional vote, returning structured metadata including the
 * base-6 glyph representation of the vote weight.
 *
 * @param {string} proposalId
 * @param {string} userId
 * @param {'creation'|'bridge'|'refusal'} voteType
 * @returns {{ proposalId: string, userId: string, weight: number, glyph: string, base6Weight: string, castAt: number }}
 */
export function castVote(proposalId, userId, voteType) {
  if (!Object.prototype.hasOwnProperty.call(VOTE_WEIGHTS, voteType)) {
    throw new Error(`Invalid vote type: "${voteType}". Must be creation, bridge, or refusal.`);
  }

  const weight = VOTE_WEIGHTS[voteType];
  // Encode absolute weight in base-6 (weight is -1, 0, or 1; all within single glyph)
  const base6Weight = decimalToRefusalGlyphs(Math.abs(weight));

  return {
    proposalId,
    userId,
    weight,
    glyph: VOTE_GLYPHS[voteType],
    base6Weight,
    castAt: Date.now(),
  };
}

/**
 * Tally votes and return the aggregate result.
 *
 * @param {Array<{weight: number}>} votes
 * @returns {{ total: number, base6Total: string, passed: boolean, quorumMet: boolean, breakdown: {creation: number, bridge: number, refusal: number} }}
 */
export function tallyVotes(votes, opts = {}) {
  const { passingThreshold = 0, quorum = 0 } = opts;

  const breakdown = { creation: 0, bridge: 0, refusal: 0 };
  let total = 0;

  for (const v of votes) {
    total += v.weight ?? 0;
    if (v.weight > 0) breakdown.creation++;
    else if (v.weight === 0) breakdown.bridge++;
    else breakdown.refusal++;
  }

  const quorumMet = votes.length >= quorum;
  const passed = quorumMet && total > passingThreshold;

  return {
    total,
    base6Total: decimalToRefusalGlyphs(Math.abs(total)),
    passed,
    quorumMet,
    breakdown,
    voteCount: votes.length,
  };
}
