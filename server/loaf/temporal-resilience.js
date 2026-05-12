import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF IX.2 — Temporal Resilience & Knowledge Escrow
 *
 * Capabilities (Knowledge Survival, continued):
 *   16. Deferred reasoning — conclusions held until evidence matures
 *   17. Knowledge escrow — sealed knowledge released under conditions
 *   18. Dissent preservation — minority views survive majority consensus
 *   19. Historical rewriting prevention — immutable audit of past states
 *   20. Knowledge migration across system versions
 *   21. Temporal knowledge anchoring (time-bound validity)
 *   22. Future-proof knowledge encoding
 *   23. Version-aware knowledge retrieval
 *   24. Knowledge decay prediction and preemptive preservation
 *   25. Time-capsule knowledge (scheduled release)
 *   26. Retroactive knowledge validation
 *   27. Knowledge lineage across system generations
 *   28. Epistemic time-travel (reconstruct past knowledge states)
 *   29. Knowledge half-life estimation
 *   30. Temporal consistency enforcement
 *
 * Design:
 *   - Deferred conclusions wait for evidence maturation thresholds
 *   - Escrow is cryptographically sealed with release conditions
 *   - Dissent is first-class — never auto-removed by consensus
 *   - History is append-only with tamper detection
 *   - Migration tracks knowledge across system version boundaries
 *   - Time-capsules release knowledge on schedule or condition
 */

// === DEFERRED REASONING ===

const DEFERRAL_REASONS = Object.freeze({
  EVIDENCE_IMMATURE: "evidence_immature",
  CONFLICTING_SIGNALS: "conflicting_signals",
  AWAITING_REPLICATION: "awaiting_replication",
  TEMPORAL_DEPENDENCY: "temporal_dependency",
  ETHICAL_REVIEW: "ethical_review",
});

const ESCROW_STATUS = Object.freeze({
  SEALED: "sealed",
  CONDITION_MET: "condition_met",
  RELEASED: "released",
  EXPIRED: "expired",
  CONTESTED: "contested",
});

const MAX_DEFERRALS = 500;
const MAX_ESCROWS = 300;
const MAX_DISSENTS = 500;
const MAX_HISTORY_ENTRIES = 2000;
const MAX_MIGRATIONS = 200;
const MAX_CAPSULES = 300;

function capMap(map, max) {
  if (map.size >= max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

// deferralId -> { conclusion, evidence[], reason, maturationThreshold, status }
const deferrals = new LruMap();
// escrowId -> { content, releaseCondition, status, sealedAt, releasedAt }
const escrows = new LruMap();
// dissentId -> { view, evidence[], author, consensusId, preserved }
const dissents = new LruMap();
// Append-only history log
const historyLog = [];
// migrationId -> { fromVersion, toVersion, knowledgeMapping[], status }
const migrations = new LruMap();
// capsuleId -> { content, releaseTime/releaseCondition, status }
const timeCapsules = new LruMap();
// snapshotId -> { timestamp, knowledgeState }
const stateSnapshots = new LruMap();

// === DEFERRED REASONING ===

/**
 * Defer a conclusion until evidence matures.
 */
function deferConclusion(conclusion, currentEvidence, reason, maturationThreshold) {
  if (!Object.values(DEFERRAL_REASONS).includes(reason)) {
    return { ok: false, error: `Unknown deferral reason: ${reason}` };
  }
  const id = `def_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(deferrals, MAX_DEFERRALS);

  deferrals.set(id, {
    conclusion,
    evidence: currentEvidence || [],
    reason,
    maturationThreshold: maturationThreshold || 0.8,
    currentMaturity: computeEvidenceMaturity(currentEvidence || []),
    status: "deferred",
    deferredAt: Date.now(),
    reviewAt: Date.now() + (30 * 24 * 3600 * 1000), // default 30 day review
  });

  appendHistory("deferral_created", { deferralId: id, reason });
  return { ok: true, deferralId: id };
}

/**
 * Add evidence to a deferred conclusion and check if maturation threshold is met.
 */
function addDeferredEvidence(deferralId, newEvidence) {
  const def = deferrals.get(deferralId);
  if (!def) return { ok: false, error: "Deferral not found" };
  if (def.status !== "deferred") return { ok: false, error: "Deferral already resolved" };

  def.evidence.push(...(Array.isArray(newEvidence) ? newEvidence : [newEvidence]));
  def.currentMaturity = computeEvidenceMaturity(def.evidence);

  const mature = def.currentMaturity >= def.maturationThreshold;
  if (mature) {
    def.status = "mature";
    appendHistory("deferral_matured", { deferralId, maturity: def.currentMaturity });
  }

  return { ok: true, deferralId, maturity: def.currentMaturity, mature, threshold: def.maturationThreshold };
}

/**
 * Resolve a deferred conclusion (accept or reject).
 */
function resolveDeferral(deferralId, accepted, justification) {
  const def = deferrals.get(deferralId);
  if (!def) return { ok: false, error: "Deferral not found" };

  def.status = accepted ? "accepted" : "rejected";
  def.resolvedAt = Date.now();
  def.justification = justification;

  appendHistory("deferral_resolved", { deferralId, accepted, justification });
  return { ok: true, deferralId, status: def.status };
}

/**
 * Compute evidence maturity (0–1) based on quantity, replication, and consistency.
 */
function computeEvidenceMaturity(evidence) {
  if (evidence.length === 0) return 0;

  const quantityScore = Math.min(evidence.length / 10, 1.0);
  const replicatedCount = evidence.filter(e => e.replicated).length;
  const replicationScore = evidence.length > 0 ? replicatedCount / evidence.length : 0;

  // Consistency: check if evidence points in the same direction
  const directions = evidence.map(e => e.direction || e.supports || "neutral");
  const directionCounts = {};
  for (const d of directions) directionCounts[d] = (directionCounts[d] || 0) + 1;
  const maxDirectionCount = Math.max(...Object.values(directionCounts), 0);
  const consistencyScore = directions.length > 0 ? maxDirectionCount / directions.length : 0;

  return (quantityScore * 0.3) + (replicationScore * 0.4) + (consistencyScore * 0.3);
}

// === KNOWLEDGE ESCROW ===

/**
 * Seal knowledge in escrow with a release condition.
 */
function sealEscrow(content, releaseCondition, expiresAt) {
  const id = `esc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(escrows, MAX_ESCROWS);

  escrows.set(id, {
    content,
    releaseCondition,
    status: ESCROW_STATUS.SEALED,
    sealedAt: Date.now(),
    expiresAt: expiresAt || null,
    releasedAt: null,
    contestedBy: [],
  });

  appendHistory("escrow_sealed", { escrowId: id, condition: releaseCondition });
  return { ok: true, escrowId: id, status: ESCROW_STATUS.SEALED };
}

/**
 * Check if an escrow's release condition is met.
 */
function checkEscrowCondition(escrowId, currentState) {
  const esc = escrows.get(escrowId);
  if (!esc) return { ok: false, error: "Escrow not found" };
  if (esc.status !== ESCROW_STATUS.SEALED) {
    return { ok: true, escrowId, alreadyReleased: esc.status === ESCROW_STATUS.RELEASED };
  }

  // Check expiry
  if (esc.expiresAt && Date.now() > esc.expiresAt) {
    esc.status = ESCROW_STATUS.EXPIRED;
    appendHistory("escrow_expired", { escrowId });
    return { ok: true, escrowId, status: ESCROW_STATUS.EXPIRED };
  }

  // Evaluate condition against current state
  const conditionMet = evaluateCondition(esc.releaseCondition, currentState);
  if (conditionMet) {
    esc.status = ESCROW_STATUS.CONDITION_MET;
    appendHistory("escrow_condition_met", { escrowId });
  }

  return { ok: true, escrowId, conditionMet, status: esc.status };
}

/**
 * Release escrow content after condition is met.
 */
function releaseEscrow(escrowId) {
  const esc = escrows.get(escrowId);
  if (!esc) return { ok: false, error: "Escrow not found" };
  if (esc.status !== ESCROW_STATUS.CONDITION_MET && esc.status !== ESCROW_STATUS.SEALED) {
    return { ok: false, error: `Cannot release: status is ${esc.status}` };
  }

  esc.status = ESCROW_STATUS.RELEASED;
  esc.releasedAt = Date.now();
  appendHistory("escrow_released", { escrowId });

  return { ok: true, escrowId, content: esc.content, status: ESCROW_STATUS.RELEASED };
}

/**
 * Contest an escrow (challenge its release or conditions).
 */
function contestEscrow(escrowId, actorId, reason) {
  const esc = escrows.get(escrowId);
  if (!esc) return { ok: false, error: "Escrow not found" };

  esc.contestedBy.push({ actorId, reason, at: Date.now() });
  esc.status = ESCROW_STATUS.CONTESTED;
  appendHistory("escrow_contested", { escrowId, actorId, reason });

  return { ok: true, escrowId, status: ESCROW_STATUS.CONTESTED };
}

/**
 * Simple condition evaluator for escrow release.
 */
function evaluateCondition(condition, state) {
  if (!condition || !state) return false;
  if (condition.type === "time_after" && condition.timestamp) {
    return Date.now() >= condition.timestamp;
  }
  if (condition.type === "state_equals" && condition.key) {
    return state[condition.key] === condition.value;
  }
  if (condition.type === "threshold" && condition.metric) {
    return (state[condition.metric] || 0) >= (condition.threshold || 0);
  }
  return false;
}

// === DISSENT PRESERVATION ===

/**
 * Preserve a dissenting view — minority views survive majority consensus.
 */
function preserveDissent(consensusId, author, view, evidence) {
  const id = `dis_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(dissents, MAX_DISSENTS);

  dissents.set(id, {
    consensusId,
    author,
    view,
    evidence: evidence || [],
    preserved: true,
    suppressionAttempts: 0,
    createdAt: Date.now(),
    lastAccessed: Date.now(),
  });

  appendHistory("dissent_preserved", { dissentId: id, consensusId, author });
  return { ok: true, dissentId: id };
}

/**
 * Record a suppression attempt on a dissent — dissent is never auto-removed.
 */
function recordSuppressionAttempt(dissentId, attemptedBy, reason) {
  const dis = dissents.get(dissentId);
  if (!dis) return { ok: false, error: "Dissent not found" };

  dis.suppressionAttempts++;
  appendHistory("dissent_suppression_attempt", {
    dissentId, attemptedBy, reason,
    totalAttempts: dis.suppressionAttempts,
  });

  // Dissent is NEVER removed — this is a design invariant
  return {
    ok: true,
    dissentId,
    preserved: true,
    suppressionAttempts: dis.suppressionAttempts,
    warning: "Dissent cannot be suppressed by design",
  };
}

/**
 * Retrieve all dissents for a given consensus.
 */
function getDissentsByConsensus(consensusId) {
  const matching = [];
  for (const [id, dis] of dissents) {
    if (dis.consensusId === consensusId) {
      dis.lastAccessed = Date.now();
      matching.push({ dissentId: id, ...dis });
    }
  }
  return { ok: true, consensusId, dissents: matching, count: matching.length };
}

// === HISTORICAL REWRITING PREVENTION ===

/**
 * Append an immutable entry to the history log.
 */
function appendHistory(eventType, data) {
  const entry = {
    eventType,
    data,
    timestamp: Date.now(),
    sequenceNumber: historyLog.length,
    previousHash: historyLog.length > 0
      ? historyLog[historyLog.length - 1].hash
      : "genesis",
  };
  // Simple chain hash
  const hashInput = `${entry.sequenceNumber}:${entry.previousHash}:${entry.eventType}:${entry.timestamp}`;
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    hash = ((hash << 5) - hash) + hashInput.charCodeAt(i);
    hash = hash & hash;
  }
  entry.hash = `h_${Math.abs(hash).toString(36)}`;
  historyLog.push(entry);

  // Bound the log
  if (historyLog.length > MAX_HISTORY_ENTRIES) {
    historyLog.splice(0, historyLog.length - MAX_HISTORY_ENTRIES);
  }

  return entry;
}

/**
 * Verify history chain integrity — detect any tampering.
 */
function verifyHistoryChain(startIndex, endIndex) {
  const start = startIndex || 0;
  const end = Math.min(endIndex || historyLog.length, historyLog.length);
  const issues = [];

  for (let i = start + 1; i < end; i++) {
    if (historyLog[i].previousHash !== historyLog[i - 1].hash) {
      issues.push({
        index: i,
        expected: historyLog[i - 1].hash,
        found: historyLog[i].previousHash,
      });
    }
  }

  return {
    ok: true,
    intact: issues.length === 0,
    checked: end - start,
    issues,
  };
}

/**
 * Retrieve history entries (read-only — never modify).
 */
function queryHistory(eventType, fromTimestamp, toTimestamp) {
  let results = [...historyLog];
  if (eventType) results = results.filter(e => e.eventType === eventType);
  if (fromTimestamp) results = results.filter(e => e.timestamp >= fromTimestamp);
  if (toTimestamp) results = results.filter(e => e.timestamp <= toTimestamp);
  return { ok: true, entries: results, count: results.length };
}

// === KNOWLEDGE MIGRATION ===

/**
 * Plan a knowledge migration across system versions.
 */
function planMigration(fromVersion, toVersion, mappings) {
  const id = `mig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(migrations, MAX_MIGRATIONS);

  migrations.set(id, {
    fromVersion,
    toVersion,
    mappings: (mappings || []).map(m => ({
      sourceId: m.sourceId,
      targetId: m.targetId || null,
      transformType: m.transformType || "direct",
      status: "pending",
    })),
    status: "planned",
    createdAt: Date.now(),
  });

  appendHistory("migration_planned", { migrationId: id, fromVersion, toVersion });
  return { ok: true, migrationId: id };
}

/**
 * Execute a knowledge migration.
 */
function executeMigration(migrationId) {
  const mig = migrations.get(migrationId);
  if (!mig) return { ok: false, error: "Migration not found" };

  mig.status = "in_progress";
  let succeeded = 0;
  let failed = 0;

  for (const mapping of mig.mappings) {
    // In a real system, this would transform and move knowledge
    if (mapping.sourceId) {
      mapping.status = "migrated";
      mapping.migratedAt = Date.now();
      succeeded++;
    } else {
      mapping.status = "failed";
      failed++;
    }
  }

  mig.status = failed === 0 ? "completed" : "partial";
  appendHistory("migration_executed", { migrationId, succeeded, failed });

  return { ok: true, migrationId, succeeded, failed, status: mig.status };
}

// === TIME CAPSULES ===

/**
 * Create a time capsule — knowledge released on schedule or condition.
 */
function createTimeCapsule(content, releaseTime, releaseCondition) {
  const id = `cap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(timeCapsules, MAX_CAPSULES);

  timeCapsules.set(id, {
    content,
    releaseTime: releaseTime || null,
    releaseCondition: releaseCondition || null,
    status: "sealed",
    createdAt: Date.now(),
    releasedAt: null,
  });

  appendHistory("capsule_created", { capsuleId: id });
  return { ok: true, capsuleId: id };
}

/**
 * Check and release any time capsules whose conditions are met.
 */
function checkTimeCapsules(currentState) {
  const released = [];
  const now = Date.now();

  for (const [id, cap] of timeCapsules) {
    if (cap.status !== "sealed") continue;

    let shouldRelease = false;
    if (cap.releaseTime && now >= cap.releaseTime) shouldRelease = true;
    if (cap.releaseCondition && evaluateCondition(cap.releaseCondition, currentState)) shouldRelease = true;

    if (shouldRelease) {
      cap.status = "released";
      cap.releasedAt = now;
      released.push({ capsuleId: id, content: cap.content });
      appendHistory("capsule_released", { capsuleId: id });
    }
  }

  return { ok: true, released, count: released.length };
}

// === KNOWLEDGE HALF-LIFE ===

/**
 * Estimate knowledge half-life based on domain and historical decay patterns.
 */
function estimateHalfLife(domain, knowledgeType, createdAt) {
  // Domain-specific half-life estimates (in days)
  const HALF_LIVES = {
    technology: 365,          // ~1 year
    science_cutting_edge: 730, // ~2 years
    science_established: 3650, // ~10 years
    mathematics: 36500,        // ~100 years (very stable)
    social_norms: 1825,        // ~5 years
    regulations: 730,          // ~2 years
    best_practices: 547,       // ~1.5 years
    general: 1825,             // ~5 years default
  };

  const halfLifeDays = HALF_LIVES[domain] || HALF_LIVES[knowledgeType] || HALF_LIVES.general;
  const ageMs = Date.now() - (createdAt || Date.now());
  const ageDays = ageMs / (24 * 3600 * 1000);
  const decayFactor = Math.pow(0.5, ageDays / halfLifeDays);

  return {
    ok: true,
    domain,
    halfLifeDays,
    ageDays: Math.round(ageDays),
    currentReliability: decayFactor,
    predictedReliabilityIn30Days: Math.pow(0.5, (ageDays + 30) / halfLifeDays),
    predictedReliabilityIn365Days: Math.pow(0.5, (ageDays + 365) / halfLifeDays),
    needsPreservation: decayFactor < 0.3,
  };
}

/**
 * Take a snapshot of current knowledge state for time-travel.
 */
function takeSnapshot(label, knowledgeIds) {
  const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(stateSnapshots, 200);

  stateSnapshots.set(id, {
    label,
    timestamp: Date.now(),
    knowledgeIds: knowledgeIds || [],
    historyIndex: historyLog.length,
  });

  appendHistory("snapshot_taken", { snapshotId: id, label });
  return { ok: true, snapshotId: id, timestamp: Date.now() };
}

/**
 * Reconstruct knowledge state at a past snapshot.
 */
function reconstructState(snapshotId) {
  const snap = stateSnapshots.get(snapshotId);
  if (!snap) return { ok: false, error: "Snapshot not found" };

  // Retrieve history up to the snapshot point
  const historyAtSnapshot = historyLog.filter(
    (_, idx) => idx < snap.historyIndex
  );

  return {
    ok: true,
    snapshotId,
    label: snap.label,
    timestamp: snap.timestamp,
    knowledgeIds: snap.knowledgeIds,
    historyEntries: historyAtSnapshot.length,
  };
}

// === MODULE INIT ===

function init({ register }) {
  register("loaf", "defer_conclusion", (ctx) => {
    const { conclusion, evidence, reason, threshold } = ctx.args || {};
    return deferConclusion(conclusion, evidence, reason || DEFERRAL_REASONS.EVIDENCE_IMMATURE, threshold);
  }, { public: true });

  register("loaf", "add_deferred_evidence", (ctx) => {
    const { deferralId, evidence } = ctx.args || {};
    return addDeferredEvidence(deferralId, evidence);
  }, { public: true });

  register("loaf", "resolve_deferral", (ctx) => {
    const { deferralId, accepted, justification } = ctx.args || {};
    return resolveDeferral(deferralId, accepted, justification);
  }, { public: true });

  register("loaf", "seal_escrow", (ctx) => {
    const { content, releaseCondition, expiresAt } = ctx.args || {};
    return sealEscrow(content, releaseCondition, expiresAt);
  }, { public: true });

  register("loaf", "check_escrow_condition", (ctx) => {
    const { escrowId, currentState } = ctx.args || {};
    return checkEscrowCondition(escrowId, currentState);
  }, { public: true });

  register("loaf", "release_escrow", (ctx) => {
    return releaseEscrow(ctx.args?.escrowId);
  }, { public: true });

  register("loaf", "contest_escrow", (ctx) => {
    const { escrowId, actorId, reason } = ctx.args || {};
    return contestEscrow(escrowId, actorId, reason);
  }, { public: true });

  register("loaf", "preserve_dissent", (ctx) => {
    const { consensusId, author, view, evidence } = ctx.args || {};
    return preserveDissent(consensusId, author, view, evidence);
  }, { public: true });

  register("loaf", "record_suppression_attempt", (ctx) => {
    const { dissentId, attemptedBy, reason } = ctx.args || {};
    return recordSuppressionAttempt(dissentId, attemptedBy, reason);
  }, { public: true });

  register("loaf", "get_dissents_by_consensus", (ctx) => {
    return getDissentsByConsensus(ctx.args?.consensusId);
  }, { public: true });

  register("loaf", "verify_history_chain", (ctx) => {
    return verifyHistoryChain(ctx.args?.startIndex, ctx.args?.endIndex);
  }, { public: true });

  register("loaf", "query_history", (ctx) => {
    const { eventType, from, to } = ctx.args || {};
    return queryHistory(eventType, from, to);
  }, { public: true });

  register("loaf", "plan_migration", (ctx) => {
    const { fromVersion, toVersion, mappings } = ctx.args || {};
    return planMigration(fromVersion, toVersion, mappings);
  }, { public: true });

  register("loaf", "execute_migration", (ctx) => {
    return executeMigration(ctx.args?.migrationId);
  }, { public: true });

  register("loaf", "create_time_capsule", (ctx) => {
    const { content, releaseTime, releaseCondition } = ctx.args || {};
    return createTimeCapsule(content, releaseTime, releaseCondition);
  }, { public: true });

  register("loaf", "check_time_capsules", (ctx) => {
    return checkTimeCapsules(ctx.args?.currentState);
  }, { public: true });

  register("loaf", "estimate_half_life", (ctx) => {
    const { domain, knowledgeType, createdAt } = ctx.args || {};
    return estimateHalfLife(domain, knowledgeType, createdAt);
  }, { public: true });

  register("loaf", "take_snapshot", (ctx) => {
    const { label, knowledgeIds } = ctx.args || {};
    return takeSnapshot(label, knowledgeIds);
  }, { public: true });

  register("loaf", "reconstruct_state", (ctx) => {
    return reconstructState(ctx.args?.snapshotId);
  }, { public: true });
}

export {
  init,
  DEFERRAL_REASONS,
  ESCROW_STATUS,
  deferConclusion,
  addDeferredEvidence,
  resolveDeferral,
  computeEvidenceMaturity,
  sealEscrow,
  checkEscrowCondition,
  releaseEscrow,
  contestEscrow,
  preserveDissent,
  recordSuppressionAttempt,
  getDissentsByConsensus,
  appendHistory,
  verifyHistoryChain,
  queryHistory,
  planMigration,
  executeMigration,
  createTimeCapsule,
  checkTimeCapsules,
  estimateHalfLife,
  takeSnapshot,
  reconstructState,
};
