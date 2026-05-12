/**
 * Conflict Resolution — Three-Tier Dispute Escalation System
 *
 * When two entities fundamentally disagree — about direction, territory,
 * resources, priorities — there is no escalation path within DTU governance.
 * This module builds one.
 *
 * Three tiers:
 *   Tier 1: Peer Mediation — neutral entity mediates, both parties accept/reject
 *   Tier 2: Council Arbitration — 3 arbitrators vote, majority rules
 *   Tier 3: Sovereign Adjudication — final binding ruling, creates precedent DTU
 *
 * Consequences:
 *   - Trust impact on losing party and conflict cost for all
 *   - Credibility penalty for frivolous filings
 *   - Cooling period (100 ticks) between repeat disputes
 *   - Precedent DTUs for future reference
 *
 * Additive only. One file. Silent failure. No existing logic changes.
 */

import crypto from "crypto";
import logger from '../logger.js';
import { LruMap, LruSet } from "../lib/lru-map.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "disp") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }

function getSTATE() {
  return globalThis._concordSTATE || globalThis.STATE || {};
}

// ── Constants ───────────────────────────────────────────────────────────────

export const DISPUTE_TYPES = Object.freeze({
  TERRITORIAL:     "territorial",
  RESOURCE:        "resource",
  DIRECTIONAL:     "directional",
  METHODOLOGICAL:  "methodological",
  PRIORITY:        "priority",
  INTERPERSONAL:   "interpersonal",
});

export const RESOLUTION_TYPES = Object.freeze({
  SIDE_A:      "side_a",
  SIDE_B:      "side_b",
  COMPROMISE:  "compromise",
  DISMISSED:   "dismissed",
  PRECEDENT:   "precedent",
  DISSOLVED:   "dissolved",
});

const DISPUTE_STATUSES = Object.freeze({
  FILED:          "filed",
  MEDIATION:      "mediation",
  ARBITRATION:    "arbitration",
  ADJUDICATION:   "adjudication",
  RESOLVED:       "resolved",
  DISMISSED:      "dismissed",
});

const VALID_DISPUTE_TYPES = new Set(Object.values(DISPUTE_TYPES));
const VALID_RESOLUTION_TYPES = new Set(Object.values(RESOLUTION_TYPES));

const MEDIATION_TICK_LIMIT = 50;
const ARBITRATION_APPEAL_TICKS = 20;
const COOLING_PERIOD_TICKS = 100;

const TRUST_LOSS_LOSER = 0.03;
const TRUST_LOSS_CONFLICT_COST = 0.01;
const CREDIBILITY_PENALTY_FRIVOLOUS = 0.02;

const MAX_DISPUTES = 10000;
const MAX_PRECEDENTS = 5000;

// ── In-Memory State ─────────────────────────────────────────────────────────

const _disputes = new LruMap();          // disputeId -> dispute record
const _disputesByEntity = new Map();  // entityId -> Set<disputeId>
const _disputesByStatus = new Map();  // status -> Set<disputeId>
const _precedents = new LruMap();        // precedentId -> precedent record
const _coolingPeriods = new Map();    // "entityA|entityB" -> { until, resolvedAt, disputeId }
const _proposedResolutions = new Map(); // disputeId -> { resolution, proposedBy, acceptedBy: Set }
const _arbitrationVotes = new Map();  // disputeId -> Map(arbitratorId -> { vote, rationale })

const _metrics = {
  totalFiled: 0,
  totalResolved: 0,
  totalDismissed: 0,
  totalEscalations: 0,
  byType: {},
  byTier: { 1: 0, 2: 0, 3: 0 },
  byResolution: {},
  avgResolutionTier: 0,
};

// ── Index Helpers ───────────────────────────────────────────────────────────

function addToSetIndex(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

function removeFromSetIndex(map, key, value) {
  const s = map.get(key);
  if (s) {
    s.delete(value);
    if (s.size === 0) map.delete(key);
  }
}

function coolingKey(entityA, entityB) {
  return [entityA, entityB].sort().join("|");
}

function addTimelineEntry(dispute, action, actor, details) {
  dispute.timeline.push({
    action,
    actor: actor || "system",
    timestamp: nowISO(),
    details: details || null,
  });
}

function capMapSize(map, max) {
  if (map.size > max) {
    const keys = Array.from(map.keys());
    const toRemove = keys.slice(0, map.size - max);
    for (const k of toRemove) map.delete(k);
  }
}

// ── Tick Simulation ─────────────────────────────────────────────────────────
// Ticks are tracked from global STATE if available; fallback to Date math.

function getCurrentTick() {
  try {
    const STATE = getSTATE();
    if (STATE.__emergent && typeof STATE.__emergent._currentTick === "number") {
      return STATE.__emergent._currentTick;
    }
    if (typeof STATE._tick === "number") return STATE._tick;
  } catch (_e) { logger.debug('emergent:conflict-resolution', 'silent', { error: _e?.message }); }
  // Fallback: derive tick from epoch seconds (1 tick ~= 1 second)
  return Math.floor(Date.now() / 1000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. FILE A DISPUTE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * File a new dispute between two entities.
 *
 * @param {string} type - One of DISPUTE_TYPES
 * @param {string} filedBy - Entity ID of the filer (party A)
 * @param {string} filedAgainst - Entity ID of the respondent (party B)
 * @param {string} title - Short dispute title
 * @param {string} description - Detailed description
 * @param {string[]} [evidence] - Supporting DTU IDs, session references, etc.
 * @returns {{ ok: boolean, dispute?: object, error?: string }}
 */
export function fileDispute(type, filedBy, filedAgainst, title, description, evidence) {
  try {
    if (!type || !VALID_DISPUTE_TYPES.has(type)) {
      return { ok: false, error: "invalid_dispute_type", allowed: Object.values(DISPUTE_TYPES) };
    }
    if (!filedBy || !filedAgainst || typeof filedBy !== "string" || typeof filedAgainst !== "string") {
      return { ok: false, error: "both_parties_required" };
    }
    if (filedBy === filedAgainst) {
      return { ok: false, error: "cannot_file_against_self" };
    }
    if (!title || typeof title !== "string") {
      return { ok: false, error: "title_required" };
    }

    // Check cooling period
    const cooling = checkCoolingPeriod(filedBy, filedAgainst);
    if (cooling && cooling.active) {
      return { ok: false, error: "cooling_period_active", until: cooling.until, remainingTicks: cooling.remainingTicks };
    }

    // Cap total disputes in memory
    capMapSize(_disputes, MAX_DISPUTES);

    const disputeId = uid("disp");
    const now = nowISO();
    const tick = getCurrentTick();

    const dispute = {
      disputeId,
      type,
      status: DISPUTE_STATUSES.FILED,
      filedBy,
      filedAgainst,
      title: String(title).slice(0, 300),
      description: String(description || "").slice(0, 5000),
      evidence: Array.isArray(evidence) ? evidence.slice(0, 50).map(e => String(e)) : [],
      counterEvidence: [],
      currentTier: 1,
      mediatorId: null,
      arbitrators: [],
      resolution: null,
      timeline: [],
      escalatedAt: [],
      filedAt: now,
      filedAtTick: tick,
      resolvedAt: null,
      resolvedAtTick: null,
    };

    addTimelineEntry(dispute, "filed", filedBy, { type, title });

    // Store and index
    _disputes.set(disputeId, dispute);
    addToSetIndex(_disputesByEntity, filedBy, disputeId);
    addToSetIndex(_disputesByEntity, filedAgainst, disputeId);
    addToSetIndex(_disputesByStatus, DISPUTE_STATUSES.FILED, disputeId);

    // Metrics
    _metrics.totalFiled++;
    _metrics.byType[type] = (_metrics.byType[type] || 0) + 1;

    return { ok: true, dispute: { ...dispute } };
  } catch (_) {
    return { ok: false, error: "file_dispute_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 2. QUERY DISPUTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get a dispute by ID.
 *
 * @param {string} disputeId
 * @returns {{ ok: boolean, dispute?: object, error?: string }}
 */
export function getDispute(disputeId) {
  try {
    const dispute = _disputes.get(disputeId);
    if (!dispute) return { ok: false, error: "dispute_not_found" };
    return { ok: true, dispute: { ...dispute } };
  } catch (_) {
    return { ok: false, error: "get_dispute_failed" };
  }
}

/**
 * List disputes with optional filters.
 *
 * @param {object} [filters]
 * @param {string} [filters.status] - Filter by status
 * @param {string} [filters.type] - Filter by dispute type
 * @param {string} [filters.entityId] - Filter by involved entity
 * @param {number} [filters.tier] - Filter by current tier
 * @param {number} [filters.limit=50] - Max results
 * @param {number} [filters.offset=0] - Skip results
 * @returns {{ ok: boolean, disputes: object[], total: number }}
 */
export function listDisputes(filters) {
  try {
    const f = filters || {};
    let results;

    // Use index if filtering by entity
    if (f.entityId) {
      const ids = _disputesByEntity.get(f.entityId);
      results = ids ? Array.from(ids).map(id => _disputes.get(id)).filter(Boolean) : [];
    } else if (f.status) {
      const ids = _disputesByStatus.get(f.status);
      results = ids ? Array.from(ids).map(id => _disputes.get(id)).filter(Boolean) : [];
    } else {
      results = Array.from(_disputes.values());
    }

    // Apply additional filters
    if (f.status && f.entityId) {
      results = results.filter(d => d.status === f.status);
    }
    if (f.type) {
      results = results.filter(d => d.type === f.type);
    }
    if (f.tier !== undefined) {
      results = results.filter(d => d.currentTier === f.tier);
    }

    // Sort by most recent first
    results.sort((a, b) => (b.filedAt || "").localeCompare(a.filedAt || ""));

    const total = results.length;
    const limit = Math.min(Math.max(f.limit || 50, 1), 200);
    const offset = Math.max(f.offset || 0, 0);
    results = results.slice(offset, offset + limit);

    return { ok: true, disputes: results.map(d => ({ ...d })), total };
  } catch (_) {
    return { ok: true, disputes: [], total: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 3. TIER 1 — PEER MEDIATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Auto-assign the best mediator for a Tier 1 dispute.
 * Selects the entity with the highest average trust with both parties,
 * who holds a different role from either party.
 *
 * @param {string} disputeId
 * @returns {{ ok: boolean, mediatorId?: string, error?: string }}
 */
export function assignMediator(disputeId) {
  try {
    const dispute = _disputes.get(disputeId);
    if (!dispute) return { ok: false, error: "dispute_not_found" };
    if (dispute.currentTier !== 1) return { ok: false, error: "not_tier_1" };
    if (dispute.mediatorId) return { ok: false, error: "mediator_already_assigned" };

    const STATE = getSTATE();
    const es = STATE.__emergent;
    if (!es || !es.emergents) {
      return { ok: false, error: "no_emergent_state" };
    }

    const partyA = es.emergents.get(dispute.filedBy);
    const partyB = es.emergents.get(dispute.filedAgainst);
    const partyRoles = new Set();
    if (partyA) partyRoles.add(partyA.role);
    if (partyB) partyRoles.add(partyB.role);

    // Gather candidate mediators: active entities not involved in dispute
    let bestCandidate = null;
    let bestScore = -1;

    for (const [eid, emergent] of es.emergents) {
      if (eid === dispute.filedBy || eid === dispute.filedAgainst) continue;
      if (!emergent.active) continue;
      // Different role from both parties preferred
      if (partyRoles.has(emergent.role)) continue;

      // Calculate trust score with both parties
      const trustScore = getMutualTrustScore(STATE, eid, dispute.filedBy, dispute.filedAgainst);
      if (trustScore > bestScore) {
        bestScore = trustScore;
        bestCandidate = eid;
      }
    }

    // Fallback: if no different-role candidate, pick any non-party entity
    if (!bestCandidate) {
      for (const [eid, emergent] of es.emergents) {
        if (eid === dispute.filedBy || eid === dispute.filedAgainst) continue;
        if (!emergent.active) continue;

        const trustScore = getMutualTrustScore(STATE, eid, dispute.filedBy, dispute.filedAgainst);
        if (trustScore > bestScore) {
          bestScore = trustScore;
          bestCandidate = eid;
        }
      }
    }

    if (!bestCandidate) {
      return { ok: false, error: "no_eligible_mediator" };
    }

    dispute.mediatorId = bestCandidate;
    updateDisputeStatus(dispute, DISPUTE_STATUSES.MEDIATION);
    addTimelineEntry(dispute, "mediator_assigned", "system", {
      mediatorId: bestCandidate,
      trustScore: bestScore,
    });

    return { ok: true, mediatorId: bestCandidate, trustScore: bestScore };
  } catch (_) {
    return { ok: false, error: "assign_mediator_failed" };
  }
}

/**
 * Calculate a combined trust score between a candidate and two parties.
 * Returns the average of the four directional trust values (A->C, C->A, B->C, C->B).
 */
function getMutualTrustScore(STATE, candidateId, partyAId, partyBId) {
  try {
    const es = STATE.__emergent;
    if (!es || !es._trustNetwork || !es._trustNetwork.edges) return 0.5;

    const edges = es._trustNetwork.edges;
    const scores = [];

    const keys = [
      `${partyAId}\u2192${candidateId}`,
      `${candidateId}\u2192${partyAId}`,
      `${partyBId}\u2192${candidateId}`,
      `${candidateId}\u2192${partyBId}`,
    ];

    for (const key of keys) {
      const edge = edges.get(key);
      scores.push(edge ? edge.score : 0.5);
    }

    return scores.reduce((a, b) => a + b, 0) / scores.length;
  } catch (_) {
    return 0.5;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 4. RESOLUTION PROPOSALS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Propose a resolution for a dispute.
 * At Tier 1, the mediator proposes. At Tier 2, arbitrators propose.
 *
 * @param {string} disputeId
 * @param {string} proposedBy - Entity ID of proposer
 * @param {object} resolution - Resolution details
 * @param {string} resolution.type - One of RESOLUTION_TYPES
 * @param {string} resolution.summary - Description of the resolution
 * @param {object} [resolution.terms] - Specific terms of resolution
 * @param {string} [resolution.domain] - Domain boundaries (for territorial)
 * @returns {{ ok: boolean, error?: string }}
 */
export function proposeResolution(disputeId, proposedBy, resolution) {
  try {
    const dispute = _disputes.get(disputeId);
    if (!dispute) return { ok: false, error: "dispute_not_found" };
    if (dispute.status === DISPUTE_STATUSES.RESOLVED || dispute.status === DISPUTE_STATUSES.DISMISSED) {
      return { ok: false, error: "dispute_already_closed" };
    }
    if (!proposedBy || typeof proposedBy !== "string") {
      return { ok: false, error: "proposer_required" };
    }
    if (!resolution || !resolution.type || !VALID_RESOLUTION_TYPES.has(resolution.type)) {
      return { ok: false, error: "invalid_resolution_type", allowed: Object.values(RESOLUTION_TYPES) };
    }

    // Tier 1: only mediator can propose
    if (dispute.currentTier === 1 && dispute.mediatorId && proposedBy !== dispute.mediatorId) {
      return { ok: false, error: "only_mediator_can_propose_at_tier_1" };
    }

    const proposal = {
      resolution: {
        type: resolution.type,
        summary: String(resolution.summary || "").slice(0, 2000),
        terms: resolution.terms || null,
        domain: resolution.domain ? String(resolution.domain).slice(0, 500) : null,
      },
      proposedBy,
      proposedAt: nowISO(),
      acceptedBy: new Set(),
    };

    _proposedResolutions.set(disputeId, proposal);

    addTimelineEntry(dispute, "resolution_proposed", proposedBy, {
      resolutionType: resolution.type,
      summary: String(resolution.summary || "").slice(0, 200),
    });

    return { ok: true, proposal: { ...proposal, acceptedBy: Array.from(proposal.acceptedBy) } };
  } catch (_) {
    return { ok: false, error: "propose_resolution_failed" };
  }
}

/**
 * Accept a proposed resolution.
 * Both parties (filedBy and filedAgainst) must accept for Tier 1 resolution.
 *
 * @param {string} disputeId
 * @param {string} entityId - Entity accepting
 * @returns {{ ok: boolean, resolved?: boolean, error?: string }}
 */
export function acceptResolution(disputeId, entityId) {
  try {
    const dispute = _disputes.get(disputeId);
    if (!dispute) return { ok: false, error: "dispute_not_found" };

    const proposal = _proposedResolutions.get(disputeId);
    if (!proposal) return { ok: false, error: "no_resolution_proposed" };

    if (!entityId || typeof entityId !== "string") {
      return { ok: false, error: "entity_id_required" };
    }

    // Must be a party to the dispute
    if (entityId !== dispute.filedBy && entityId !== dispute.filedAgainst) {
      return { ok: false, error: "not_a_party_to_dispute" };
    }

    proposal.acceptedBy.add(entityId);
    addTimelineEntry(dispute, "resolution_accepted", entityId, null);

    // Check if both parties accepted (Tier 1 mediation)
    if (dispute.currentTier === 1) {
      const bothAccepted = proposal.acceptedBy.has(dispute.filedBy) &&
                           proposal.acceptedBy.has(dispute.filedAgainst);
      if (bothAccepted) {
        return resolveDispute(disputeId, proposal.resolution);
      }
    }

    return {
      ok: true,
      resolved: false,
      acceptedBy: Array.from(proposal.acceptedBy),
      awaitingAcceptance: getAwaitingParties(dispute, proposal),
    };
  } catch (_) {
    return { ok: false, error: "accept_resolution_failed" };
  }
}

/**
 * Reject a proposed resolution. At Tier 1, either party can reject and optionally escalate.
 *
 * @param {string} disputeId
 * @param {string} entityId - Entity rejecting
 * @returns {{ ok: boolean, escalatable?: boolean, error?: string }}
 */
export function rejectResolution(disputeId, entityId) {
  try {
    const dispute = _disputes.get(disputeId);
    if (!dispute) return { ok: false, error: "dispute_not_found" };

    const proposal = _proposedResolutions.get(disputeId);
    if (!proposal) return { ok: false, error: "no_resolution_proposed" };

    if (!entityId || typeof entityId !== "string") {
      return { ok: false, error: "entity_id_required" };
    }

    // Must be a party to the dispute
    if (entityId !== dispute.filedBy && entityId !== dispute.filedAgainst) {
      return { ok: false, error: "not_a_party_to_dispute" };
    }

    // Remove the proposal
    _proposedResolutions.delete(disputeId);

    addTimelineEntry(dispute, "resolution_rejected", entityId, null);

    // Determine if escalation is available
    const canEscalate = dispute.currentTier < 3;

    return { ok: true, escalatable: canEscalate, currentTier: dispute.currentTier };
  } catch (_) {
    return { ok: false, error: "reject_resolution_failed" };
  }
}

function getAwaitingParties(dispute, proposal) {
  const awaiting = [];
  if (!proposal.acceptedBy.has(dispute.filedBy)) awaiting.push(dispute.filedBy);
  if (!proposal.acceptedBy.has(dispute.filedAgainst)) awaiting.push(dispute.filedAgainst);
  return awaiting;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 5. ESCALATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Escalate a dispute to the next tier.
 * Tier 1 -> Tier 2 (Council Arbitration)
 * Tier 2 -> Tier 3 (Sovereign Adjudication)
 *
 * @param {string} disputeId
 * @returns {{ ok: boolean, newTier?: number, error?: string }}
 */
export function escalateDispute(disputeId) {
  try {
    const dispute = _disputes.get(disputeId);
    if (!dispute) return { ok: false, error: "dispute_not_found" };
    if (dispute.status === DISPUTE_STATUSES.RESOLVED || dispute.status === DISPUTE_STATUSES.DISMISSED) {
      return { ok: false, error: "dispute_already_closed" };
    }
    if (dispute.currentTier >= 3) {
      return { ok: false, error: "already_at_max_tier" };
    }

    // Clear any pending proposal
    _proposedResolutions.delete(disputeId);

    const previousTier = dispute.currentTier;
    dispute.currentTier++;
    dispute.escalatedAt.push(nowISO());
    _metrics.totalEscalations++;

    if (dispute.currentTier === 2) {
      updateDisputeStatus(dispute, DISPUTE_STATUSES.ARBITRATION);
      // Auto-assign arbitrators
      const arbitratorResult = assignArbitrators(dispute);
      addTimelineEntry(dispute, "escalated_to_tier_2", "system", {
        previousTier,
        arbitrators: arbitratorResult.arbitrators || [],
      });
    } else if (dispute.currentTier === 3) {
      updateDisputeStatus(dispute, DISPUTE_STATUSES.ADJUDICATION);
      addTimelineEntry(dispute, "escalated_to_tier_3", "system", { previousTier });
    }

    return { ok: true, newTier: dispute.currentTier, status: dispute.status };
  } catch (_) {
    return { ok: false, error: "escalate_failed" };
  }
}

/**
 * Check if a Tier 1 mediation has timed out and auto-escalate.
 * Called externally by a tick handler or scheduler.
 *
 * @param {string} disputeId
 * @returns {{ ok: boolean, autoEscalated?: boolean }}
 */
export function checkMediationTimeout(disputeId) {
  try {
    const dispute = _disputes.get(disputeId);
    if (!dispute) return { ok: false, error: "dispute_not_found" };
    if (dispute.currentTier !== 1) return { ok: true, autoEscalated: false };
    if (dispute.status !== DISPUTE_STATUSES.MEDIATION && dispute.status !== DISPUTE_STATUSES.FILED) {
      return { ok: true, autoEscalated: false };
    }

    const currentTick = getCurrentTick();
    const elapsed = currentTick - (dispute.filedAtTick || 0);

    if (elapsed >= MEDIATION_TICK_LIMIT) {
      addTimelineEntry(dispute, "mediation_timeout", "system", {
        elapsed,
        limit: MEDIATION_TICK_LIMIT,
      });
      const result = escalateDispute(disputeId);
      return { ok: true, autoEscalated: true, escalation: result };
    }

    return { ok: true, autoEscalated: false, ticksRemaining: MEDIATION_TICK_LIMIT - elapsed };
  } catch (_) {
    return { ok: false, error: "timeout_check_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 6. TIER 2 — COUNCIL ARBITRATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Select 3 arbitrators for a Tier 2 dispute.
 * Picks the highest-credibility active entities not involved in the dispute.
 */
function assignArbitrators(dispute) {
  try {
    const STATE = getSTATE();
    const es = STATE.__emergent;
    if (!es || !es.emergents) return { arbitrators: [] };

    const excluded = new Set([dispute.filedBy, dispute.filedAgainst, dispute.mediatorId].filter(Boolean));
    const candidates = [];

    for (const [eid, emergent] of es.emergents) {
      if (excluded.has(eid)) continue;
      if (!emergent.active) continue;

      // Get credibility from reputation store
      let credibility = 0.5;
      if (es.reputations) {
        const rep = es.reputations.get(eid);
        if (rep && typeof rep.credibility === "number") {
          credibility = rep.credibility;
        }
      }
      candidates.push({ entityId: eid, credibility });
    }

    // Sort by credibility descending, pick top 3
    candidates.sort((a, b) => b.credibility - a.credibility);
    const selected = candidates.slice(0, 3).map(c => c.entityId);

    dispute.arbitrators = selected;
    return { arbitrators: selected };
  } catch (_) {
    return { arbitrators: [] };
  }
}

/**
 * Cast an arbitration vote in a Tier 2 dispute.
 *
 * @param {string} disputeId
 * @param {string} arbitratorId - Must be one of the assigned arbitrators
 * @param {string} vote - "side_a" | "side_b" | "compromise" | "dismiss"
 * @param {string} [rationale] - Explanation for the vote
 * @returns {{ ok: boolean, allVoted?: boolean, outcome?: object, error?: string }}
 */
export function castArbitrationVote(disputeId, arbitratorId, vote, rationale) {
  try {
    const dispute = _disputes.get(disputeId);
    if (!dispute) return { ok: false, error: "dispute_not_found" };
    if (dispute.currentTier !== 2) return { ok: false, error: "not_tier_2" };
    if (dispute.status !== DISPUTE_STATUSES.ARBITRATION) {
      return { ok: false, error: "not_in_arbitration" };
    }
    if (!arbitratorId || !dispute.arbitrators.includes(arbitratorId)) {
      return { ok: false, error: "not_an_assigned_arbitrator" };
    }

    const validVotes = new Set(["side_a", "side_b", "compromise", "dismiss"]);
    if (!validVotes.has(vote)) {
      return { ok: false, error: "invalid_vote", allowed: Array.from(validVotes) };
    }

    // Store vote
    if (!_arbitrationVotes.has(disputeId)) {
      _arbitrationVotes.set(disputeId, new Map());
    }
    const votes = _arbitrationVotes.get(disputeId);
    votes.set(arbitratorId, {
      vote,
      rationale: rationale ? String(rationale).slice(0, 2000) : null,
      timestamp: nowISO(),
    });

    addTimelineEntry(dispute, "arbitration_vote", arbitratorId, { vote });

    // Check if all arbitrators have voted
    const allVoted = dispute.arbitrators.every(id => votes.has(id));
    if (!allVoted) {
      return {
        ok: true,
        allVoted: false,
        votesReceived: votes.size,
        votesNeeded: dispute.arbitrators.length,
      };
    }

    // Tally votes
    const outcome = tallyArbitrationVotes(dispute, votes);
    return { ok: true, allVoted: true, outcome };
  } catch (_) {
    return { ok: false, error: "cast_vote_failed" };
  }
}

/**
 * Tally arbitration votes and determine outcome.
 * Majority rules. If three-way tie, escalate to Tier 3.
 */
function tallyArbitrationVotes(dispute, votes) {
  const tally = { side_a: 0, side_b: 0, compromise: 0, dismiss: 0 };
  const voteDetails = [];

  for (const [arbitratorId, v] of votes) {
    tally[v.vote]++;
    voteDetails.push({ arbitratorId, vote: v.vote, rationale: v.rationale });
  }

  // Find the majority
  let maxVote = null;
  let maxCount = 0;
  let tied = false;

  for (const [voteType, count] of Object.entries(tally)) {
    if (count > maxCount) {
      maxCount = count;
      maxVote = voteType;
      tied = false;
    } else if (count === maxCount && count > 0) {
      tied = true;
    }
  }

  addTimelineEntry(dispute, "arbitration_tallied", "system", { tally, voteDetails });

  // If tied, escalate to Tier 3
  if (tied) {
    addTimelineEntry(dispute, "arbitration_tied", "system", { tally });
    const escalation = escalateDispute(dispute.disputeId);
    return {
      outcome: "tied",
      tally,
      voteDetails,
      escalated: true,
      escalation,
    };
  }

  // Map arbitration vote to resolution type
  const resolutionTypeMap = {
    side_a: RESOLUTION_TYPES.SIDE_A,
    side_b: RESOLUTION_TYPES.SIDE_B,
    compromise: RESOLUTION_TYPES.COMPROMISE,
    dismiss: RESOLUTION_TYPES.DISMISSED,
  };

  const resolutionType = resolutionTypeMap[maxVote] || RESOLUTION_TYPES.COMPROMISE;

  if (maxVote === "dismiss") {
    const result = dismissDispute(dispute.disputeId, "Dismissed by arbitration council");
    return { outcome: "dismissed", tally, voteDetails, result };
  }

  // Resolve with the majority decision
  const resolution = {
    type: resolutionType,
    summary: `Arbitration council ruled ${maxVote} (${maxCount}/${dispute.arbitrators.length} votes)`,
    terms: null,
    arbitrationTally: tally,
    voteDetails,
    bindingUntilTick: getCurrentTick() + ARBITRATION_APPEAL_TICKS,
  };

  const result = resolveDispute(dispute.disputeId, resolution);
  return { outcome: maxVote, tally, voteDetails, result };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 7. TIER 3 — SOVEREIGN ADJUDICATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Sovereign adjudication — final binding ruling at Tier 3.
 * Creates a precedent DTU for future reference.
 *
 * @param {string} disputeId
 * @param {object} decision - The sovereign's decision
 * @param {string} decision.type - One of RESOLUTION_TYPES
 * @param {string} decision.summary - Ruling summary
 * @param {object} [decision.terms] - Specific terms
 * @param {string} [decision.domain] - Domain boundaries
 * @param {string} rationale - Detailed rationale for the ruling
 * @returns {{ ok: boolean, resolution?: object, precedent?: object, error?: string }}
 */
export function adjudicate(disputeId, decision, rationale) {
  try {
    const dispute = _disputes.get(disputeId);
    if (!dispute) return { ok: false, error: "dispute_not_found" };
    if (dispute.currentTier !== 3) return { ok: false, error: "not_tier_3" };
    if (dispute.status !== DISPUTE_STATUSES.ADJUDICATION) {
      return { ok: false, error: "not_in_adjudication" };
    }
    if (!decision || !decision.type || !VALID_RESOLUTION_TYPES.has(decision.type)) {
      return { ok: false, error: "invalid_decision_type" };
    }

    const resolution = {
      type: decision.type,
      summary: String(decision.summary || "").slice(0, 2000),
      terms: decision.terms || null,
      domain: decision.domain ? String(decision.domain).slice(0, 500) : null,
      authority: 1.0,  // Sovereign decisions are fully authoritative
      rationale: rationale ? String(rationale).slice(0, 5000) : null,
      adjudicatedBy: "sovereign",
    };

    addTimelineEntry(dispute, "sovereign_adjudication", "sovereign", {
      decisionType: decision.type,
      rationale: String(rationale || "").slice(0, 500),
    });

    // Create precedent
    const precedent = createPrecedent(dispute, resolution, rationale);

    // Resolve the dispute
    const result = resolveDispute(disputeId, resolution);

    return {
      ok: true,
      resolution,
      precedent,
      result,
    };
  } catch (_) {
    return { ok: false, error: "adjudication_failed" };
  }
}

/**
 * Create a precedent DTU from a sovereign adjudication.
 */
function createPrecedent(dispute, resolution, rationale) {
  try {
    const precedentId = uid("prec");
    const now = nowISO();

    const precedent = {
      precedentId,
      disputeId: dispute.disputeId,
      disputeType: dispute.type,
      resolutionType: resolution.type,
      title: dispute.title,
      summary: resolution.summary,
      rationale: rationale ? String(rationale).slice(0, 5000) : null,
      domain: resolution.domain || null,
      terms: resolution.terms || null,
      parties: {
        filedBy: dispute.filedBy,
        filedAgainst: dispute.filedAgainst,
      },
      tags: ["precedent", "dispute_resolution", dispute.type],
      authority: 1.0,
      createdAt: now,
      referencedCount: 0,
    };

    _precedents.set(precedentId, precedent);
    capMapSize(_precedents, MAX_PRECEDENTS);

    return { ...precedent };
  } catch (_) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 8. RESOLVE / DISMISS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Finalize the resolution of a dispute and apply consequences.
 *
 * @param {string} disputeId
 * @param {object} resolution - Final resolution details
 * @param {string} resolution.type - One of RESOLUTION_TYPES
 * @param {string} resolution.summary - Description of resolution
 * @returns {{ ok: boolean, error?: string }}
 */
export function resolveDispute(disputeId, resolution) {
  try {
    const dispute = _disputes.get(disputeId);
    if (!dispute) return { ok: false, error: "dispute_not_found" };
    if (dispute.status === DISPUTE_STATUSES.RESOLVED) {
      return { ok: false, error: "already_resolved" };
    }
    if (!resolution || !resolution.type) {
      return { ok: false, error: "resolution_required" };
    }

    const now = nowISO();
    const tick = getCurrentTick();

    dispute.resolution = {
      type: resolution.type,
      summary: String(resolution.summary || "").slice(0, 2000),
      terms: resolution.terms || null,
      domain: resolution.domain || null,
      resolvedAtTier: dispute.currentTier,
      authority: resolution.authority || (dispute.currentTier === 3 ? 1.0 : 0.7 + dispute.currentTier * 0.1),
    };
    dispute.resolvedAt = now;
    dispute.resolvedAtTick = tick;

    updateDisputeStatus(dispute, DISPUTE_STATUSES.RESOLVED);
    addTimelineEntry(dispute, "resolved", "system", {
      resolutionType: resolution.type,
      tier: dispute.currentTier,
    });

    // Apply consequences
    applyConsequences(dispute);

    // Set cooling period
    setCoolingPeriod(dispute.filedBy, dispute.filedAgainst, tick, disputeId);

    // Clean up proposals and votes
    _proposedResolutions.delete(disputeId);
    _arbitrationVotes.delete(disputeId);

    // Metrics
    _metrics.totalResolved++;
    _metrics.byTier[dispute.currentTier] = (_metrics.byTier[dispute.currentTier] || 0) + 1;
    _metrics.byResolution[resolution.type] = (_metrics.byResolution[resolution.type] || 0) + 1;
    updateAvgResolutionTier();

    return { ok: true, dispute: { ...dispute } };
  } catch (_) {
    return { ok: false, error: "resolve_failed" };
  }
}

/**
 * Dismiss a dispute as invalid or moot.
 *
 * @param {string} disputeId
 * @param {string} reason - Why the dispute is being dismissed
 * @returns {{ ok: boolean, error?: string }}
 */
export function dismissDispute(disputeId, reason) {
  try {
    const dispute = _disputes.get(disputeId);
    if (!dispute) return { ok: false, error: "dispute_not_found" };
    if (dispute.status === DISPUTE_STATUSES.RESOLVED || dispute.status === DISPUTE_STATUSES.DISMISSED) {
      return { ok: false, error: "dispute_already_closed" };
    }

    const now = nowISO();
    dispute.resolution = {
      type: RESOLUTION_TYPES.DISMISSED,
      summary: reason ? String(reason).slice(0, 2000) : "Dismissed",
      resolvedAtTier: dispute.currentTier,
    };
    dispute.resolvedAt = now;
    dispute.resolvedAtTick = getCurrentTick();

    updateDisputeStatus(dispute, DISPUTE_STATUSES.DISMISSED);
    addTimelineEntry(dispute, "dismissed", "system", { reason: String(reason || "").slice(0, 500) });

    // Credibility penalty for frivolous filing
    applyFrivolousPenalty(dispute.filedBy);

    // Clean up
    _proposedResolutions.delete(disputeId);
    _arbitrationVotes.delete(disputeId);

    _metrics.totalDismissed++;
    _metrics.byResolution[RESOLUTION_TYPES.DISMISSED] = (_metrics.byResolution[RESOLUTION_TYPES.DISMISSED] || 0) + 1;

    return { ok: true, dispute: { ...dispute } };
  } catch (_) {
    return { ok: false, error: "dismiss_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 9. CONSEQUENCES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Apply trust and credibility consequences after dispute resolution.
 */
function applyConsequences(dispute) {
  try {
    const STATE = getSTATE();
    const es = STATE.__emergent;
    if (!es) return;

    const resolution = dispute.resolution;
    if (!resolution) return;

    const { filedBy, filedAgainst, mediatorId, arbitrators } = dispute;

    // Determine winner and loser
    let winner = null;
    let loser = null;

    if (resolution.type === RESOLUTION_TYPES.SIDE_A) {
      winner = filedBy;
      loser = filedAgainst;
    } else if (resolution.type === RESOLUTION_TYPES.SIDE_B) {
      winner = filedAgainst;
      loser = filedBy;
    }
    // For compromise, dissolved — no winner/loser

    // Trust impact: loser loses trust from winner
    if (winner && loser) {
      applyTrustDelta(es, winner, loser, -TRUST_LOSS_LOSER);
    }

    // Conflict cost: both parties lose trust from mediator/arbitrators
    const adjudicators = [mediatorId, ...arbitrators].filter(Boolean);
    for (const adjId of adjudicators) {
      applyTrustDelta(es, adjId, filedBy, -TRUST_LOSS_CONFLICT_COST);
      applyTrustDelta(es, adjId, filedAgainst, -TRUST_LOSS_CONFLICT_COST);
    }
  } catch (_e) { logger.debug('emergent:conflict-resolution', 'silent — consequences are best-effort', { error: _e?.message }); }
}

/**
 * Apply a trust delta between two entities.
 */
function applyTrustDelta(es, fromId, toId, delta) {
  try {
    if (!es._trustNetwork || !es._trustNetwork.edges) return;
    const key = `${fromId}\u2192${toId}`;
    const edge = es._trustNetwork.edges.get(key);
    if (edge) {
      edge.score = clamp01(edge.score + delta);
      edge.lastUpdated = nowISO();
      edge.history = edge.history || [];
      edge.history.push({
        type: "dispute_consequence",
        delta,
        scoreAfter: edge.score,
        timestamp: nowISO(),
      });
      if (edge.history.length > 50) edge.history = edge.history.slice(-50);
    }
  } catch (_e) { logger.debug('emergent:conflict-resolution', 'silent', { error: _e?.message }); }
}

/**
 * Apply credibility penalty for filing a frivolous (dismissed) dispute.
 */
function applyFrivolousPenalty(entityId) {
  try {
    const STATE = getSTATE();
    const es = STATE.__emergent;
    if (!es || !es.reputations) return;

    const rep = es.reputations.get(entityId);
    if (rep && typeof rep.credibility === "number") {
      rep.credibility = clamp01(rep.credibility - CREDIBILITY_PENALTY_FRIVOLOUS);
    }
  } catch (_e) { logger.debug('emergent:conflict-resolution', 'silent', { error: _e?.message }); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 10. COOLING PERIOD
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Set a cooling period between two entities after a dispute resolves.
 */
function setCoolingPeriod(entityA, entityB, currentTick, disputeId) {
  try {
    const key = coolingKey(entityA, entityB);
    _coolingPeriods.set(key, {
      until: currentTick + COOLING_PERIOD_TICKS,
      resolvedAt: currentTick,
      disputeId,
      entityA,
      entityB,
    });
  } catch (_e) { logger.debug('emergent:conflict-resolution', 'silent', { error: _e?.message }); }
}

/**
 * Check if a cooling period is active between two entities.
 *
 * @param {string} entityA
 * @param {string} entityB
 * @returns {{ active: boolean, until?: number, remainingTicks?: number, disputeId?: string } | null}
 */
export function checkCoolingPeriod(entityA, entityB) {
  try {
    if (!entityA || !entityB) return null;

    const key = coolingKey(entityA, entityB);
    const cooling = _coolingPeriods.get(key);
    if (!cooling) return { active: false };

    const currentTick = getCurrentTick();
    if (currentTick >= cooling.until) {
      // Cooling period expired, clean up
      _coolingPeriods.delete(key);
      return { active: false, expired: true };
    }

    return {
      active: true,
      until: cooling.until,
      remainingTicks: cooling.until - currentTick,
      disputeId: cooling.disputeId,
    };
  } catch (_) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 11. PRECEDENT SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Search for relevant precedents by dispute type and/or domain.
 *
 * @param {string} [type] - Dispute type to match
 * @param {string} [domain] - Domain keyword to match
 * @returns {{ ok: boolean, precedents: object[], count: number }}
 */
export function findPrecedent(type, domain) {
  try {
    let results = Array.from(_precedents.values());

    if (type) {
      results = results.filter(p => p.disputeType === type);
    }
    if (domain) {
      const d = String(domain).toLowerCase();
      results = results.filter(p => {
        const pDomain = (p.domain || "").toLowerCase();
        const pTitle = (p.title || "").toLowerCase();
        const pSummary = (p.summary || "").toLowerCase();
        return pDomain.includes(d) || pTitle.includes(d) || pSummary.includes(d);
      });
    }

    // Sort by most recent first
    results.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

    // Increment reference counts
    for (const p of results) {
      const stored = _precedents.get(p.precedentId);
      if (stored) stored.referencedCount++;
    }

    return { ok: true, precedents: results.map(p => ({ ...p })), count: results.length };
  } catch (_) {
    return { ok: true, precedents: [], count: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 12. COUNTER-EVIDENCE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Submit counter-evidence for a dispute (by the respondent).
 *
 * @param {string} disputeId
 * @param {string} entityId - Must be the filedAgainst party
 * @param {string[]} evidence - Counter-evidence references
 * @returns {{ ok: boolean, error?: string }}
 */
export function submitCounterEvidence(disputeId, entityId, evidence) {
  try {
    const dispute = _disputes.get(disputeId);
    if (!dispute) return { ok: false, error: "dispute_not_found" };
    if (dispute.status === DISPUTE_STATUSES.RESOLVED || dispute.status === DISPUTE_STATUSES.DISMISSED) {
      return { ok: false, error: "dispute_already_closed" };
    }
    if (entityId !== dispute.filedAgainst) {
      return { ok: false, error: "only_respondent_can_submit_counter_evidence" };
    }
    if (!Array.isArray(evidence) || evidence.length === 0) {
      return { ok: false, error: "evidence_required" };
    }

    const newEvidence = evidence.slice(0, 50).map(e => String(e));
    dispute.counterEvidence = [...dispute.counterEvidence, ...newEvidence].slice(0, 100);

    addTimelineEntry(dispute, "counter_evidence_submitted", entityId, {
      count: newEvidence.length,
    });

    return { ok: true, counterEvidenceCount: dispute.counterEvidence.length };
  } catch (_) {
    return { ok: false, error: "submit_counter_evidence_failed" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// 13. STATUS MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Update dispute status and maintain the status index.
 */
function updateDisputeStatus(dispute, newStatus) {
  const oldStatus = dispute.status;
  if (oldStatus === newStatus) return;

  // Update index
  removeFromSetIndex(_disputesByStatus, oldStatus, dispute.disputeId);
  addToSetIndex(_disputesByStatus, newStatus, dispute.disputeId);

  dispute.status = newStatus;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 14. METRICS
// ═══════════════════════════════════════════════════════════════════════════════

function updateAvgResolutionTier() {
  try {
    const totalByTier = _metrics.byTier;
    const total = (totalByTier[1] || 0) + (totalByTier[2] || 0) + (totalByTier[3] || 0);
    if (total === 0) {
      _metrics.avgResolutionTier = 0;
      return;
    }
    const weighted = (totalByTier[1] || 0) * 1 + (totalByTier[2] || 0) * 2 + (totalByTier[3] || 0) * 3;
    _metrics.avgResolutionTier = Math.round((weighted / total) * 100) / 100;
  } catch (_e) { logger.debug('emergent:conflict-resolution', 'silent', { error: _e?.message }); }
}

/**
 * Get dispute system metrics and statistics.
 *
 * @returns {{ ok: boolean, metrics: object }}
 */
export function getDisputeMetrics() {
  try {
    // Count active by status
    const activeByStatus = {};
    for (const [status, ids] of _disputesByStatus) {
      activeByStatus[status] = ids.size;
    }

    // Count active cooling periods
    let activeCooling = 0;
    const currentTick = getCurrentTick();
    for (const [, cooling] of _coolingPeriods) {
      if (currentTick < cooling.until) activeCooling++;
    }

    return {
      ok: true,
      metrics: {
        ..._metrics,
        totalDisputes: _disputes.size,
        totalPrecedents: _precedents.size,
        activeCoolingPeriods: activeCooling,
        activeByStatus,
        pendingProposals: _proposedResolutions.size,
        pendingVotes: _arbitrationVotes.size,
      },
    };
  } catch (_) {
    return { ok: true, metrics: { ..._metrics } };
  }
}
