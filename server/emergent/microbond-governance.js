/**
 * System 8: Microbond Governance Module — Citizen-Driven Bond Voting
 *
 * Enables democratic investment in public infrastructure through micro-bonds.
 * Citizens vote on proposals, pledge funds, and track milestones.
 *
 * Governance Layers: Town -> City -> County -> State -> National -> International
 *
 * Safeguards:
 *   - No single entity >5% of any bond
 *   - Spillover fund redistributes excess
 *   - Quarterly reporting mandatory
 *   - Milestone-based fund release
 *   - Dual-path simulation required before vote
 *   - Council voices evaluate every proposal
 *
 * Additive only. One file. Silent failure. All state in-memory.
 */

import crypto from "crypto";
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "id") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

function nowISO() {
  return new Date().toISOString();
}

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

// ── Constants ───────────────────────────────────────────────────────────────

export const GOVERNANCE_SCOPES = Object.freeze([
  "town",
  "city",
  "county",
  "state",
  "national",
  "international",
]);

export const VOTING_STATUSES = Object.freeze([
  "proposed",
  "open",
  "funded",
  "active",
  "completed",
  "failed",
]);

const MAX_SINGLE_ENTITY_RATIO = 0.05;   // 5% cap per entity per bond
const DEFAULT_SPILLOVER_RATE = 0.05;     // 5% excess goes to spillover
const DEFAULT_APPROVAL_THRESHOLD = 0.6;  // 60% for/total to pass
const DEFAULT_QUORUM = 1000;
const MAX_BONDS = 5000;                  // In-memory cap

// ── In-Memory State ─────────────────────────────────────────────────────────

const _bonds = new Map();           // bondId -> bond object
const _votes = new LruMap();           // bondId -> Map(voterId -> { vote, timestamp })
const _pledges = new LruMap();         // bondId -> Map(entityId -> amount)
const _spilloverFunds = new LruMap();  // scope -> accumulated spillover amount

// ── Bond Creation ───────────────────────────────────────────────────────────

/**
 * Create a new microbond proposal.
 *
 * @param {string} title - Bond title
 * @param {string} description - Bond description
 * @param {string} category - Bond category (energy, infrastructure, etc.)
 * @param {object} financial - Financial parameters
 * @param {object} governance - Governance parameters
 * @returns {object} The created bond, or { error } on failure
 */
export function createBond(title, description, category, financial, governance) {
  try {
    if (!title || typeof title !== "string") {
      return { error: "title_required" };
    }

    const fin = financial || {};
    const gov = governance || {};

    const scope = GOVERNANCE_SCOPES.includes(gov.scope) ? gov.scope : "city";
    const milestones = Array.isArray(gov.milestones)
      ? gov.milestones.map(m => ({
          description: String(m.description || ""),
          deadline: m.deadline || null,
          status: "pending",
        }))
      : [];

    const bond = {
      id: uid("bond"),
      title: String(title).slice(0, 500),
      description: String(description || "").slice(0, 5000),
      category: String(category || "general").slice(0, 100),
      financial: {
        targetAmount: Math.max(0, Number(fin.targetAmount) || 1000000),
        currentPledged: 0,
        denomination: Math.max(1, Number(fin.denomination) || 100),
        interestRate: clamp01(Number(fin.interestRate) || 0.03),
        maturityYears: Math.max(1, Math.min(100, Number(fin.maturityYears) || 10)),
        spilloverFund: clamp01(Number(fin.spilloverFund) || DEFAULT_SPILLOVER_RATE),
      },
      governance: {
        scope,
        votingStatus: "proposed",
        votesFor: 0,
        votesAgainst: 0,
        quorum: Math.max(1, Number(gov.quorum) || DEFAULT_QUORUM),
        approvalThreshold: clamp01(Number(gov.approvalThreshold) || DEFAULT_APPROVAL_THRESHOLD),
        oversight: {
          reportingInterval: gov.reportingInterval || "quarterly",
          auditRequired: gov.auditRequired !== false,
          milestones,
        },
      },
      impact: {
        humanPath: null,
        concordPath: null,
        comparisonResult: null,
        ethicalScore: null,
        longTermProjection: null,
      },
      relatedDTUs: [],
      impactDTUs: [],
      createdAt: nowISO(),
      fundedAt: null,
      completedAt: null,
    };

    // Enforce in-memory cap
    if (_bonds.size >= MAX_BONDS) {
      const oldest = _bonds.keys().next().value;
      _bonds.delete(oldest);
    }

    _bonds.set(bond.id, bond);
    _votes.set(bond.id, new Map());
    _pledges.set(bond.id, new Map());

    return bond;
  } catch {
    return { error: "create_bond_failed" };
  }
}

// ── Bond Retrieval ──────────────────────────────────────────────────────────

/**
 * Get a bond by ID.
 *
 * @param {string} id - Bond ID
 * @returns {object|null}
 */
export function getBond(id) {
  try {
    return _bonds.get(id) || null;
  } catch {
    return null;
  }
}

/**
 * List bonds, optionally filtered by voting status.
 *
 * @param {string} [status] - Filter by votingStatus
 * @returns {object[]}
 */
export function listBonds(status) {
  try {
    const results = [];
    for (const bond of _bonds.values()) {
      if (!status || bond.governance.votingStatus === status) {
        results.push(bond);
      }
    }
    return results;
  } catch {
    return [];
  }
}

// ── Voting ──────────────────────────────────────────────────────────────────

/**
 * Cast a vote on a bond proposal.
 *
 * @param {string} bondId - Bond to vote on
 * @param {string} voterId - Voter identifier
 * @param {string} vote - "for" or "against"
 * @returns {{ ok: boolean, error?: string, bond?: object }}
 */
export function voteBond(bondId, voterId, vote) {
  try {
    const bond = _bonds.get(bondId);
    if (!bond) return { ok: false, error: "bond_not_found" };

    if (bond.governance.votingStatus !== "open") {
      return { ok: false, error: "voting_not_open" };
    }

    if (vote !== "for" && vote !== "against") {
      return { ok: false, error: "invalid_vote" };
    }

    if (!voterId || typeof voterId !== "string") {
      return { ok: false, error: "voter_id_required" };
    }

    const bondVotes = _votes.get(bondId);
    if (!bondVotes) return { ok: false, error: "vote_store_missing" };

    // Check if voter already voted — update their vote
    const existingVote = bondVotes.get(voterId);
    if (existingVote) {
      // Remove old vote from tallies
      if (existingVote.vote === "for") bond.governance.votesFor--;
      if (existingVote.vote === "against") bond.governance.votesAgainst--;
    }

    // Record new vote
    bondVotes.set(voterId, { vote, timestamp: nowISO() });

    if (vote === "for") bond.governance.votesFor++;
    if (vote === "against") bond.governance.votesAgainst++;

    return { ok: true, bond };
  } catch {
    return { ok: false, error: "vote_failed" };
  }
}

// ── Dual-Path Simulation ────────────────────────────────────────────────────

/**
 * Run a dual-path simulation on a bond proposal.
 * Simulates human-only path vs Concordos-assisted path for the bond's
 * projected impact, then stores results in the bond's impact field.
 *
 * @param {string} bondId - Bond to simulate
 * @returns {{ ok: boolean, error?: string, impact?: object }}
 */
export function simulateBond(bondId) {
  try {
    const bond = _bonds.get(bondId);
    if (!bond) return { ok: false, error: "bond_not_found" };

    const timeHorizon = bond.financial.maturityYears;
    const targetAmount = bond.financial.targetAmount;
    const baseRisk = clamp01(0.3 + (targetAmount / 1e9) * 0.2);

    // Human path simulation — standard parameters, no optimization
    const humanPath = simulateImpactPath({
      timeHorizon,
      baseRisk,
      redundancy: 0.3,
      assistance: "none",
      category: bond.category,
      scope: bond.governance.scope,
    });

    // Concordos path simulation — optimized parameters
    const concordPath = simulateImpactPath({
      timeHorizon,
      baseRisk,
      redundancy: 0.5,
      assistance: "concordos",
      riskReduction: 0.15,
      efficiencyBoost: 0.2,
      category: bond.category,
      scope: bond.governance.scope,
    });

    // Compare paths
    const stabilityDelta = concordPath.stabilityScore - humanPath.stabilityScore;
    const efficiencyDelta = concordPath.efficiency - humanPath.efficiency;
    const riskDelta = humanPath.riskScore - concordPath.riskScore;

    const comparisonResult = {
      betterPath: stabilityDelta > 0 ? "concordos" : stabilityDelta < 0 ? "human" : "equivalent",
      stabilityDelta: Math.round(stabilityDelta * 1000) / 1000,
      efficiencyDelta: Math.round(efficiencyDelta * 1000) / 1000,
      riskReduction: Math.round(riskDelta * 1000) / 1000,
    };

    // Ethical score: weighted average of stability, efficiency, risk mitigation
    const ethicalScore = clamp01(
      (concordPath.stabilityScore * 0.4) +
      (concordPath.efficiency * 0.3) +
      ((1 - concordPath.riskScore) * 0.3)
    );

    // Long-term projection
    const longTermProjection = {
      projectedROI: Math.round((bond.financial.interestRate * timeHorizon + efficiencyDelta * 0.5) * 1000) / 1000,
      communityBenefitScore: clamp01(ethicalScore * 0.8 + stabilityDelta * 0.2),
      sustainabilityIndex: clamp01(concordPath.stabilityScore * 0.6 + (1 - concordPath.riskScore) * 0.4),
      timeHorizon,
    };

    // Council voices evaluation
    const councilEvaluation = evaluateWithCouncil(bond, comparisonResult, ethicalScore);

    // Store results on bond
    bond.impact = {
      humanPath,
      concordPath,
      comparisonResult,
      ethicalScore: Math.round(ethicalScore * 1000) / 1000,
      longTermProjection,
      councilEvaluation,
      simulatedAt: nowISO(),
    };

    return { ok: true, impact: bond.impact };
  } catch {
    return { ok: false, error: "simulation_failed" };
  }
}

/**
 * Simulate a single impact path for a bond.
 *
 * @param {object} params - Simulation parameters
 * @returns {object} Path result with stability, risk, efficiency scores
 */
function simulateImpactPath(params) {
  const p = params || {};
  const timeHorizon = Number(p.timeHorizon || 10);
  const baseRisk = clamp01(p.baseRisk || 0.4);
  const redundancy = clamp01(p.redundancy || 0.3);
  const riskReduction = p.assistance === "concordos" ? clamp01(p.riskReduction || 0.15) : 0;
  const efficiencyBoost = p.assistance === "concordos" ? clamp01(p.efficiencyBoost || 0.1) : 0;

  const effectiveRisk = clamp01(baseRisk - riskReduction);
  const effectiveRedundancy = clamp01(redundancy + efficiencyBoost);

  let cumulativeStability = 1.0;
  let cumulativeEfficiency = 0.5;
  const projections = [];

  for (let t = 0; t < timeHorizon; t++) {
    const eventRisk = effectiveRisk * (0.8 + Math.random() * 0.4);
    const recovery = effectiveRedundancy * (p.assistance === "concordos" ? 0.7 : 1.0);
    const netImpact = eventRisk - recovery;

    cumulativeStability = clamp01(cumulativeStability - netImpact * 0.08);
    cumulativeEfficiency = clamp01(cumulativeEfficiency + (recovery - eventRisk) * 0.04);

    projections.push({
      t,
      stability: Math.round(cumulativeStability * 1000) / 1000,
      risk: Math.round(eventRisk * 1000) / 1000,
      efficiency: Math.round(cumulativeEfficiency * 1000) / 1000,
    });
  }

  return {
    assistance: p.assistance || "none",
    stabilityScore: Math.round(cumulativeStability * 1000) / 1000,
    riskScore: Math.round(effectiveRisk * 1000) / 1000,
    efficiency: Math.round(cumulativeEfficiency * 1000) / 1000,
    projections,
    timeHorizon,
  };
}

/**
 * Evaluate a bond proposal through the five council voices.
 *
 * @param {object} bond - The bond being evaluated
 * @param {object} comparison - Dual-path comparison result
 * @param {number} ethicalScore - Computed ethical score
 * @returns {object} Council evaluation with per-voice scores and verdict
 */
function evaluateWithCouncil(bond, comparison, ethicalScore) {
  try {
    const voices = {};

    // The Skeptic — looks for weak evidence and gaps
    const skepticScore = clamp01(
      0.5 - (bond.financial.targetAmount > 1e8 ? 0.15 : 0) +
      (comparison.riskReduction > 0.05 ? 0.1 : -0.1) +
      (bond.governance.oversight.auditRequired ? 0.1 : -0.15) +
      (bond.governance.oversight.milestones.length > 0 ? 0.1 : -0.1)
    );
    voices.skeptic = {
      label: "The Skeptic",
      score: Math.round(skepticScore * 1000) / 1000,
      vote: skepticScore > 0.6 ? "accept" : skepticScore < 0.4 ? "reject" : "needs_more_data",
      concern: bond.financial.targetAmount > 1e8
        ? "Large target amount requires extraordinary evidence of feasibility"
        : "Risk mitigation appears adequate",
    };

    // The Socratic — probes assumptions
    const socraticScore = clamp01(
      0.5 +
      (bond.impact.humanPath && bond.impact.concordPath ? 0.15 : -0.2) +
      (comparison.stabilityDelta > 0 ? 0.05 : -0.05) +
      (bond.governance.approvalThreshold >= 0.6 ? 0.05 : -0.1)
    );
    voices.socratic = {
      label: "The Socratic",
      score: Math.round(socraticScore * 1000) / 1000,
      vote: socraticScore > 0.6 ? "accept" : socraticScore < 0.4 ? "reject" : "needs_more_data",
      concern: "What assumptions underlie the projected ROI? Has scope creep been addressed?",
    };

    // The Opposer — stress-tests for failure modes
    const opposerScore = clamp01(
      0.4 +
      (comparison.riskReduction > 0.1 ? 0.15 : 0) +
      (bond.governance.oversight.milestones.length >= 3 ? 0.1 : -0.05) +
      (ethicalScore > 0.6 ? 0.1 : -0.1)
    );
    voices.opposer = {
      label: "The Opposer",
      score: Math.round(opposerScore * 1000) / 1000,
      vote: opposerScore > 0.6 ? "accept" : opposerScore < 0.4 ? "reject" : "needs_more_data",
      concern: "What happens if the project fails at 50% completion? How are pledges protected?",
    };

    // The Idealist — long-term flourishing
    const idealistScore = clamp01(
      0.5 +
      (ethicalScore - 0.5) * 0.4 +
      (comparison.betterPath === "concordos" ? 0.1 : 0) +
      (bond.category === "energy" || bond.category === "education" || bond.category === "healthcare" ? 0.1 : 0)
    );
    voices.idealist = {
      label: "The Idealist",
      score: Math.round(idealistScore * 1000) / 1000,
      vote: idealistScore > 0.6 ? "accept" : idealistScore < 0.4 ? "reject" : "needs_more_data",
      concern: "Does this bond serve long-term community flourishing and intergenerational equity?",
    };

    // The Pragmatist — feasibility and actionable constraints
    const pragmatistScore = clamp01(
      0.5 +
      (bond.governance.oversight.milestones.length > 0 ? 0.1 : -0.15) +
      (bond.financial.denomination <= 500 ? 0.1 : -0.05) +
      (bond.financial.maturityYears <= 20 ? 0.05 : -0.1) +
      (bond.governance.quorum <= 5000 ? 0.05 : -0.05)
    );
    voices.pragmatist = {
      label: "The Pragmatist",
      score: Math.round(pragmatistScore * 1000) / 1000,
      vote: pragmatistScore > 0.6 ? "accept" : pragmatistScore < 0.4 ? "reject" : "needs_more_data",
      concern: "Are the denomination and quorum achievable for the target community size?",
    };

    // Aggregate verdict
    const scores = Object.values(voices).map(v => v.score);
    const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length;
    const allVotes = Object.values(voices).map(v => v.vote);
    const unanimous = allVotes.every(v => v === allVotes[0]);

    return {
      voices,
      confidence: Math.round(avgScore * 1000) / 1000,
      verdictAction: avgScore > 0.6 ? "accept" : avgScore < 0.4 ? "reject" : "needs_more_data",
      unanimous,
    };
  } catch {
    return { voices: {}, confidence: 0, verdictAction: "needs_more_data", unanimous: false };
  }
}

// ── Milestone Management ────────────────────────────────────────────────────

/**
 * Mark a milestone as completed.
 *
 * @param {string} bondId - Bond ID
 * @param {number} milestoneIndex - Index of the milestone to complete
 * @returns {{ ok: boolean, error?: string, milestone?: object }}
 */
export function completeMilestone(bondId, milestoneIndex) {
  try {
    const bond = _bonds.get(bondId);
    if (!bond) return { ok: false, error: "bond_not_found" };

    if (bond.governance.votingStatus !== "active" && bond.governance.votingStatus !== "funded") {
      return { ok: false, error: "bond_not_active" };
    }

    const milestones = bond.governance.oversight.milestones;
    const idx = Number(milestoneIndex);

    if (idx < 0 || idx >= milestones.length || !Number.isInteger(idx)) {
      return { ok: false, error: "invalid_milestone_index" };
    }

    if (milestones[idx].status === "completed") {
      return { ok: false, error: "milestone_already_completed" };
    }

    milestones[idx].status = "completed";
    milestones[idx].completedAt = nowISO();

    // Generate impact DTU reference for completed milestone
    const dtuRef = uid("dtu");
    bond.impactDTUs.push({
      id: dtuRef,
      type: "milestone_completion",
      milestoneIndex: idx,
      description: milestones[idx].description,
      timestamp: nowISO(),
    });

    return { ok: true, milestone: milestones[idx] };
  } catch {
    return { ok: false, error: "complete_milestone_failed" };
  }
}

// ── Quorum & Funding ────────────────────────────────────────────────────────

/**
 * Check whether a bond has met its quorum and approval threshold.
 *
 * @param {string} bondId - Bond ID
 * @returns {{ ok: boolean, quorumMet: boolean, approved: boolean, details?: object, error?: string }}
 */
export function checkQuorum(bondId) {
  try {
    const bond = _bonds.get(bondId);
    if (!bond) return { ok: false, error: "bond_not_found" };

    const totalVotes = bond.governance.votesFor + bond.governance.votesAgainst;
    const quorumMet = totalVotes >= bond.governance.quorum;

    const approvalRatio = totalVotes > 0
      ? bond.governance.votesFor / totalVotes
      : 0;
    const approved = quorumMet && approvalRatio >= bond.governance.approvalThreshold;

    // Check if dual-path simulation has been run
    const simulationComplete = bond.impact.humanPath !== null && bond.impact.concordPath !== null;

    return {
      ok: true,
      quorumMet,
      approved,
      simulationComplete,
      details: {
        votesFor: bond.governance.votesFor,
        votesAgainst: bond.governance.votesAgainst,
        totalVotes,
        quorum: bond.governance.quorum,
        approvalRatio: Math.round(approvalRatio * 1000) / 1000,
        approvalThreshold: bond.governance.approvalThreshold,
      },
    };
  } catch {
    return { ok: false, error: "quorum_check_failed" };
  }
}

/**
 * Transition a bond to "funded" status.
 * Requires: quorum met, approval threshold met, dual-path simulation complete.
 *
 * @param {string} bondId - Bond ID
 * @returns {{ ok: boolean, error?: string, bond?: object }}
 */
export function fundBond(bondId) {
  try {
    const bond = _bonds.get(bondId);
    if (!bond) return { ok: false, error: "bond_not_found" };

    if (bond.governance.votingStatus !== "open") {
      return { ok: false, error: "bond_not_open" };
    }

    // Must have dual-path simulation completed
    if (!bond.impact.humanPath || !bond.impact.concordPath) {
      return { ok: false, error: "simulation_required_before_funding" };
    }

    // Check quorum and approval
    const quorumResult = checkQuorum(bondId);
    if (!quorumResult.ok || !quorumResult.approved) {
      return { ok: false, error: "quorum_or_approval_not_met", details: quorumResult.details };
    }

    bond.governance.votingStatus = "funded";
    bond.fundedAt = nowISO();

    // Allocate spillover from pledges
    const spilloverRate = bond.financial.spilloverFund;
    const pledgeMap = _pledges.get(bondId);
    if (pledgeMap) {
      let totalPledged = 0;
      for (const amount of pledgeMap.values()) {
        totalPledged += amount;
      }

      if (totalPledged > bond.financial.targetAmount) {
        const excess = totalPledged - bond.financial.targetAmount;
        const spilloverAmount = excess * spilloverRate;
        const scope = bond.governance.scope;
        const current = _spilloverFunds.get(scope) || 0;
        _spilloverFunds.set(scope, current + spilloverAmount);
        bond.financial.currentPledged = bond.financial.targetAmount;
      } else {
        bond.financial.currentPledged = totalPledged;
      }
    }

    return { ok: true, bond };
  } catch {
    return { ok: false, error: "fund_bond_failed" };
  }
}

// ── Pledging (with 5% cap safeguard) ────────────────────────────────────────

/**
 * Pledge funds to a bond. Enforces the 5% single-entity cap.
 *
 * @param {string} bondId - Bond ID
 * @param {string} entityId - Pledging entity
 * @param {number} amount - Amount to pledge
 * @returns {{ ok: boolean, error?: string, totalPledged?: number }}
 */
export function pledgeToBond(bondId, entityId, amount) {
  try {
    const bond = _bonds.get(bondId);
    if (!bond) return { ok: false, error: "bond_not_found" };

    if (bond.governance.votingStatus !== "open" && bond.governance.votingStatus !== "funded") {
      return { ok: false, error: "bond_not_accepting_pledges" };
    }

    if (!entityId || typeof entityId !== "string") {
      return { ok: false, error: "entity_id_required" };
    }

    const pledgeAmount = Math.max(0, Number(amount) || 0);
    if (pledgeAmount <= 0) {
      return { ok: false, error: "invalid_amount" };
    }

    // Must be in denomination increments
    if (pledgeAmount % bond.financial.denomination !== 0) {
      return { ok: false, error: "amount_must_be_denomination_multiple", denomination: bond.financial.denomination };
    }

    const pledgeMap = _pledges.get(bondId) || new Map();
    _pledges.set(bondId, pledgeMap);

    const existingPledge = pledgeMap.get(entityId) || 0;
    const newTotal = existingPledge + pledgeAmount;

    // Enforce 5% single-entity cap
    const maxAllowed = bond.financial.targetAmount * MAX_SINGLE_ENTITY_RATIO;
    if (newTotal > maxAllowed) {
      return {
        ok: false,
        error: "exceeds_single_entity_cap",
        maxAllowed,
        currentPledge: existingPledge,
        requested: pledgeAmount,
      };
    }

    pledgeMap.set(entityId, newTotal);

    // Recalculate total pledged
    let totalPledged = 0;
    for (const amt of pledgeMap.values()) {
      totalPledged += amt;
    }
    bond.financial.currentPledged = totalPledged;

    return { ok: true, totalPledged, entityPledge: newTotal };
  } catch {
    return { ok: false, error: "pledge_failed" };
  }
}

// ── Bond Lifecycle ──────────────────────────────────────────────────────────

/**
 * Open a proposed bond for voting.
 * Validates that the bond has been simulated (dual-path required before vote).
 *
 * @param {string} bondId - Bond ID
 * @returns {{ ok: boolean, error?: string, bond?: object }}
 */
export function openBondForVoting(bondId) {
  try {
    const bond = _bonds.get(bondId);
    if (!bond) return { ok: false, error: "bond_not_found" };

    if (bond.governance.votingStatus !== "proposed") {
      return { ok: false, error: "bond_not_in_proposed_status" };
    }

    // Dual-path simulation must be complete before opening for vote
    if (!bond.impact.humanPath || !bond.impact.concordPath) {
      return { ok: false, error: "dual_path_simulation_required_before_voting" };
    }

    bond.governance.votingStatus = "open";

    return { ok: true, bond };
  } catch {
    return { ok: false, error: "open_bond_failed" };
  }
}

/**
 * Activate a funded bond — begin project execution.
 *
 * @param {string} bondId - Bond ID
 * @returns {{ ok: boolean, error?: string, bond?: object }}
 */
export function activateBond(bondId) {
  try {
    const bond = _bonds.get(bondId);
    if (!bond) return { ok: false, error: "bond_not_found" };

    if (bond.governance.votingStatus !== "funded") {
      return { ok: false, error: "bond_must_be_funded_first" };
    }

    bond.governance.votingStatus = "active";

    return { ok: true, bond };
  } catch {
    return { ok: false, error: "activate_bond_failed" };
  }
}

/**
 * Mark a bond as completed.
 * All milestones must be completed. Remaining spillover is allocated.
 *
 * @param {string} bondId - Bond ID
 * @returns {{ ok: boolean, error?: string, bond?: object }}
 */
export function completeBond(bondId) {
  try {
    const bond = _bonds.get(bondId);
    if (!bond) return { ok: false, error: "bond_not_found" };

    if (bond.governance.votingStatus !== "active" && bond.governance.votingStatus !== "funded") {
      return { ok: false, error: "bond_not_active" };
    }

    // Check all milestones are completed
    const milestones = bond.governance.oversight.milestones;
    const incomplete = milestones.filter(m => m.status !== "completed");
    if (incomplete.length > 0) {
      return {
        ok: false,
        error: "incomplete_milestones",
        remaining: incomplete.length,
        total: milestones.length,
      };
    }

    bond.governance.votingStatus = "completed";
    bond.completedAt = nowISO();

    // Final spillover allocation
    const scope = bond.governance.scope;
    const spilloverRate = bond.financial.spilloverFund;
    const spilloverContribution = bond.financial.currentPledged * spilloverRate;
    const current = _spilloverFunds.get(scope) || 0;
    _spilloverFunds.set(scope, current + spilloverContribution);

    return { ok: true, bond };
  } catch {
    return { ok: false, error: "complete_bond_failed" };
  }
}

/**
 * Mark a bond as failed.
 *
 * @param {string} bondId - Bond ID
 * @returns {{ ok: boolean, error?: string, bond?: object }}
 */
export function failBond(bondId) {
  try {
    const bond = _bonds.get(bondId);
    if (!bond) return { ok: false, error: "bond_not_found" };

    bond.governance.votingStatus = "failed";

    return { ok: true, bond };
  } catch {
    return { ok: false, error: "fail_bond_failed" };
  }
}

// ── Spillover Fund ──────────────────────────────────────────────────────────

/**
 * Get the accumulated spillover fund for a governance scope.
 *
 * @param {string} scope - Governance scope (town, city, county, state, national, international)
 * @returns {{ ok: boolean, scope: string, amount: number }}
 */
export function getSpilloverFund(scope) {
  try {
    const validScope = GOVERNANCE_SCOPES.includes(scope) ? scope : "city";
    const amount = _spilloverFunds.get(validScope) || 0;
    return { ok: true, scope: validScope, amount: Math.round(amount * 100) / 100 };
  } catch {
    return { ok: true, scope: scope || "city", amount: 0 };
  }
}

/**
 * Get spillover funds across all scopes.
 *
 * @returns {object} Map of scope -> amount
 */
export function getAllSpilloverFunds() {
  try {
    const result = {};
    for (const scope of GOVERNANCE_SCOPES) {
      result[scope] = Math.round((_spilloverFunds.get(scope) || 0) * 100) / 100;
    }
    return result;
  } catch {
    return {};
  }
}

// ── Metrics ─────────────────────────────────────────────────────────────────

/**
 * Get aggregate metrics across all bonds.
 *
 * @returns {object} Bond system metrics
 */
export function getBondMetrics() {
  try {
    let totalBonds = 0;
    let totalPledged = 0;
    let totalTarget = 0;
    let totalVotes = 0;
    const statusCounts = {};
    const scopeCounts = {};
    const categoryCounts = {};
    let completedCount = 0;
    let failedCount = 0;
    let simulatedCount = 0;
    let avgEthicalScore = 0;
    let ethicalCount = 0;

    for (const bond of _bonds.values()) {
      totalBonds++;
      totalPledged += bond.financial.currentPledged;
      totalTarget += bond.financial.targetAmount;
      totalVotes += bond.governance.votesFor + bond.governance.votesAgainst;

      const status = bond.governance.votingStatus;
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      const scope = bond.governance.scope;
      scopeCounts[scope] = (scopeCounts[scope] || 0) + 1;

      const cat = bond.category;
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;

      if (status === "completed") completedCount++;
      if (status === "failed") failedCount++;

      if (bond.impact.humanPath !== null) simulatedCount++;
      if (bond.impact.ethicalScore !== null) {
        avgEthicalScore += bond.impact.ethicalScore;
        ethicalCount++;
      }
    }

    // Spillover totals
    let totalSpillover = 0;
    for (const amount of _spilloverFunds.values()) {
      totalSpillover += amount;
    }

    return {
      totalBonds,
      totalPledged: Math.round(totalPledged * 100) / 100,
      totalTarget: Math.round(totalTarget * 100) / 100,
      fundingRatio: totalTarget > 0 ? Math.round((totalPledged / totalTarget) * 1000) / 1000 : 0,
      totalVotes,
      statusCounts,
      scopeCounts,
      categoryCounts,
      completedCount,
      failedCount,
      simulatedCount,
      avgEthicalScore: ethicalCount > 0
        ? Math.round((avgEthicalScore / ethicalCount) * 1000) / 1000
        : null,
      totalSpillover: Math.round(totalSpillover * 100) / 100,
      spilloverByScope: getAllSpilloverFunds(),
    };
  } catch {
    return { totalBonds: 0, error: "metrics_failed" };
  }
}
