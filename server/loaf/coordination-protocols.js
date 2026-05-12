import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF VIII.1 — Coordination Protocols
 *
 * Capabilities (Distributed Coordination):
 *   1.  Non-centralized coordination protocols
 *   2.  Shared intent alignment without shared authority
 *   3.  Cross-actor plan compatibility checking
 *   4.  Conflict detection before execution
 *   5.  Negotiation-by-evidence (not by position or power)
 *   6.  Action interlock guarantees (mutual-exclusion, ordering)
 *   7.  Distributed veto and pause mechanisms
 *   8.  Priority arbitration under uncertainty
 *   9.  Compatibility envelopes for simultaneous actions
 *   10. Safe parallel execution across actors
 *
 * Design:
 *   - Coordination is peer-to-peer; no single authority owns the protocol
 *   - Intent alignment uses evidence overlap, not social hierarchy
 *   - Plans are checked for compatibility before execution
 *   - Conflicts surface early via pre-execution analysis
 *   - Interlocks guarantee ordering and mutual exclusion where needed
 *   - Any participant can veto or pause a coordination round
 *   - Priority is arbitrated by evidence weight, not actor power
 */

// === COORDINATION PRIMITIVES ===

const COORDINATION_MODES = Object.freeze({
  PEER: "peer",                   // equal-authority participants
  ADVISORY: "advisory",           // one leads, others advise
  CONSENSUS: "consensus",         // all must agree
  SUPERMAJORITY: "supermajority", // threshold agreement
  EVIDENCE_WEIGHTED: "evidence_weighted", // weight by evidence quality
});

const CONFLICT_TYPES = Object.freeze({
  RESOURCE: "resource",           // competing for same resource
  ORDERING: "ordering",           // actions must happen in sequence
  CONTRADICTION: "contradiction", // actions produce contradictory outcomes
  DEPENDENCY: "dependency",       // action A requires action B first
  EXCLUSION: "exclusion",         // actions cannot coexist
});

const INTERLOCK_TYPES = Object.freeze({
  MUTEX: "mutex",                 // only one at a time
  ORDERED: "ordered",             // must happen in sequence
  BARRIER: "barrier",             // all must reach before any proceed
  GATE: "gate",                   // requires explicit approval
  TIMEOUT: "timeout",             // auto-releases after duration
});

const VETO_REASONS = Object.freeze({
  SAFETY: "safety",
  EVIDENCE_INSUFFICIENT: "evidence_insufficient",
  CONFLICT_UNRESOLVED: "conflict_unresolved",
  ETHICS_CONCERN: "ethics_concern",
  RESOURCE_EXHAUSTION: "resource_exhaustion",
  UNKNOWN_CONSEQUENCE: "unknown_consequence",
});

const MAX_PROTOCOLS = 500;
const MAX_INTERLOCKS = 1000;
const MAX_NEGOTIATIONS = 500;
const MAX_PARTICIPANTS_PER_PROTOCOL = 50;

function capMap(map, max) {
  if (map.size >= max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

// protocolId -> { mode, participants[], intents[], plans[], conflicts[], status }
const protocols = new LruMap();
// interlockId -> { type, resources[], holders[], queue[], createdAt }
const interlocks = new LruMap();
// negotiationId -> { protocolId, topic, positions[], evidence[], rounds, outcome }
const negotiations = new LruMap();

/**
 * Create a new coordination protocol.
 */
function createProtocol(mode, description, initiatorId) {
  if (!COORDINATION_MODES[mode?.toUpperCase?.()] && !Object.values(COORDINATION_MODES).includes(mode)) {
    return { ok: false, error: `Unknown coordination mode: ${mode}` };
  }
  const id = `proto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(protocols, MAX_PROTOCOLS);
  protocols.set(id, {
    mode,
    description,
    initiatorId,
    participants: [{ actorId: initiatorId, joinedAt: Date.now(), role: "initiator" }],
    intents: [],
    plans: [],
    conflicts: [],
    vetoes: [],
    status: "forming",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return { ok: true, protocolId: id };
}

/**
 * Join an existing coordination protocol.
 */
function joinProtocol(protocolId, actorId, declaredIntent) {
  const proto = protocols.get(protocolId);
  if (!proto) return { ok: false, error: "Protocol not found" };
  if (proto.status === "terminated") return { ok: false, error: "Protocol terminated" };
  if (proto.participants.length >= MAX_PARTICIPANTS_PER_PROTOCOL) {
    return { ok: false, error: "Maximum participants reached" };
  }
  if (proto.participants.some(p => p.actorId === actorId)) {
    return { ok: false, error: "Actor already participating" };
  }
  proto.participants.push({ actorId, joinedAt: Date.now(), role: "participant" });
  if (declaredIntent) {
    proto.intents.push({ actorId, intent: declaredIntent, declaredAt: Date.now() });
  }
  proto.updatedAt = Date.now();
  return { ok: true, participants: proto.participants.length };
}

/**
 * Declare intent within a protocol (shared intent alignment without shared authority).
 */
function declareIntent(protocolId, actorId, intent, evidenceBundle) {
  const proto = protocols.get(protocolId);
  if (!proto) return { ok: false, error: "Protocol not found" };
  if (!proto.participants.some(p => p.actorId === actorId)) {
    return { ok: false, error: "Actor not participating in protocol" };
  }
  const intentEntry = {
    actorId,
    intent,
    evidence: evidenceBundle || [],
    declaredAt: Date.now(),
  };
  proto.intents.push(intentEntry);
  proto.updatedAt = Date.now();

  // Compute intent alignment across all participants
  const allIntents = proto.intents;
  const actorIntents = new Map();
  for (const i of allIntents) {
    actorIntents.set(i.actorId, i);
  }
  const alignment = computeIntentAlignment(Array.from(actorIntents.values()));
  return { ok: true, alignment };
}

/**
 * Compute alignment score between declared intents.
 * Uses evidence overlap as primary signal, not social hierarchy.
 */
function computeIntentAlignment(intentEntries) {
  if (intentEntries.length < 2) return { score: 1.0, aligned: true, conflicts: [] };

  let totalOverlap = 0;
  let totalComparisons = 0;
  const conflicts = [];

  for (let i = 0; i < intentEntries.length; i++) {
    for (let j = i + 1; j < intentEntries.length; j++) {
      const a = intentEntries[i];
      const b = intentEntries[j];
      const evidenceA = new Set((a.evidence || []).map(e => e.id || JSON.stringify(e)));
      const evidenceB = new Set((b.evidence || []).map(e => e.id || JSON.stringify(e)));
      const intersection = [...evidenceA].filter(x => evidenceB.has(x));
      const union = new Set([...evidenceA, ...evidenceB]);
      const overlap = union.size > 0 ? intersection.length / union.size : 0;
      totalOverlap += overlap;
      totalComparisons++;

      if (overlap < 0.2) {
        conflicts.push({
          actors: [a.actorId, b.actorId],
          evidenceOverlap: overlap,
          reason: "Low evidence alignment",
        });
      }
    }
  }

  const score = totalComparisons > 0 ? totalOverlap / totalComparisons : 0;
  return { score, aligned: score >= 0.5 && conflicts.length === 0, conflicts };
}

/**
 * Submit a plan for compatibility checking.
 */
function submitPlan(protocolId, actorId, plan) {
  const proto = protocols.get(protocolId);
  if (!proto) return { ok: false, error: "Protocol not found" };
  if (!proto.participants.some(p => p.actorId === actorId)) {
    return { ok: false, error: "Actor not in protocol" };
  }
  const planEntry = {
    actorId,
    plan,
    submittedAt: Date.now(),
    compatibilityChecked: false,
  };
  proto.plans.push(planEntry);
  proto.updatedAt = Date.now();
  return { ok: true, planIndex: proto.plans.length - 1 };
}

/**
 * Check compatibility between all submitted plans.
 * Detects conflicts before execution.
 */
function checkPlanCompatibility(protocolId) {
  const proto = protocols.get(protocolId);
  if (!proto) return { ok: false, error: "Protocol not found" };
  if (proto.plans.length < 2) return { ok: true, compatible: true, conflicts: [] };

  const conflicts = [];

  for (let i = 0; i < proto.plans.length; i++) {
    for (let j = i + 1; j < proto.plans.length; j++) {
      const planA = proto.plans[i];
      const planB = proto.plans[j];

      // Check resource conflicts
      const resourcesA = new Set((planA.plan.resources || []).map(r => r.id || r));
      const resourcesB = new Set((planB.plan.resources || []).map(r => r.id || r));
      const sharedResources = [...resourcesA].filter(r => resourcesB.has(r));
      if (sharedResources.length > 0) {
        conflicts.push({
          type: CONFLICT_TYPES.RESOURCE,
          actors: [planA.actorId, planB.actorId],
          details: { sharedResources },
        });
      }

      // Check ordering conflicts
      const outputsA = new Set((planA.plan.outputs || []).map(o => o.id || o));
      const inputsB = new Set((planB.plan.inputs || []).map(i => i.id || i));
      const inputsA = new Set((planA.plan.inputs || []).map(i => i.id || i));
      const outputsB = new Set((planB.plan.outputs || []).map(o => o.id || o));

      const aDependsOnB = [...inputsA].some(i => outputsB.has(i));
      const bDependsOnA = [...inputsB].some(i => outputsA.has(i));
      if (aDependsOnB && bDependsOnA) {
        conflicts.push({
          type: CONFLICT_TYPES.ORDERING,
          actors: [planA.actorId, planB.actorId],
          details: { circular: true },
        });
      } else if (aDependsOnB || bDependsOnA) {
        conflicts.push({
          type: CONFLICT_TYPES.DEPENDENCY,
          actors: [planA.actorId, planB.actorId],
          details: { direction: aDependsOnB ? "A_needs_B" : "B_needs_A" },
        });
      }

      // Check contradiction (mutually exclusive outcomes)
      const effectsA = planA.plan.effects || [];
      const effectsB = planB.plan.effects || [];
      for (const ea of effectsA) {
        for (const eb of effectsB) {
          if (ea.target === eb.target && ea.direction !== eb.direction) {
            conflicts.push({
              type: CONFLICT_TYPES.CONTRADICTION,
              actors: [planA.actorId, planB.actorId],
              details: { target: ea.target, directionA: ea.direction, directionB: eb.direction },
            });
          }
        }
      }
    }
  }

  // Mark all plans as checked
  for (const p of proto.plans) p.compatibilityChecked = true;
  proto.conflicts = conflicts;
  proto.updatedAt = Date.now();

  return {
    ok: true,
    compatible: conflicts.length === 0,
    conflicts,
    planCount: proto.plans.length,
  };
}

/**
 * Start a negotiation-by-evidence round (not by position or power).
 */
function startNegotiation(protocolId, topic) {
  const proto = protocols.get(protocolId);
  if (!proto) return { ok: false, error: "Protocol not found" };
  capMap(negotiations, MAX_NEGOTIATIONS);

  const id = `neg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  negotiations.set(id, {
    protocolId,
    topic,
    positions: [],
    evidence: [],
    rounds: 0,
    outcome: null,
    status: "open",
    createdAt: Date.now(),
  });
  return { ok: true, negotiationId: id };
}

/**
 * Submit a position with evidence to a negotiation.
 * Positions are weighted by evidence quality, not actor authority.
 */
function submitPosition(negotiationId, actorId, position, evidence) {
  const neg = negotiations.get(negotiationId);
  if (!neg) return { ok: false, error: "Negotiation not found" };
  if (neg.status !== "open") return { ok: false, error: "Negotiation not open" };

  const evidenceWeight = computeEvidenceWeight(evidence || []);
  neg.positions.push({
    actorId,
    position,
    evidence: evidence || [],
    evidenceWeight,
    submittedAt: Date.now(),
  });
  neg.rounds++;
  return { ok: true, evidenceWeight, positionCount: neg.positions.length };
}

/**
 * Compute evidence weight for a set of evidence items.
 */
function computeEvidenceWeight(evidenceItems) {
  if (evidenceItems.length === 0) return 0;
  let totalWeight = 0;
  for (const item of evidenceItems) {
    const baseWeight = item.confidence || 0.5;
    const replicationBonus = item.replicated ? 0.2 : 0;
    const recencyBonus = item.timestamp
      ? Math.max(0, 1 - (Date.now() - item.timestamp) / (365 * 24 * 3600 * 1000))
      : 0.5;
    totalWeight += baseWeight + replicationBonus + (recencyBonus * 0.1);
  }
  return totalWeight / evidenceItems.length;
}

/**
 * Resolve a negotiation based on evidence weights.
 */
function resolveNegotiation(negotiationId) {
  const neg = negotiations.get(negotiationId);
  if (!neg) return { ok: false, error: "Negotiation not found" };
  if (neg.positions.length === 0) return { ok: false, error: "No positions submitted" };

  // Group positions and sum evidence weights
  const positionWeights = new Map();
  for (const p of neg.positions) {
    const key = JSON.stringify(p.position);
    const current = positionWeights.get(key) || { position: p.position, weight: 0, supporters: [] };
    current.weight += p.evidenceWeight;
    current.supporters.push(p.actorId);
    positionWeights.set(key, current);
  }

  const ranked = Array.from(positionWeights.values()).sort((a, b) => b.weight - a.weight);
  const winner = ranked[0];
  const totalWeight = ranked.reduce((s, r) => s + r.weight, 0);
  const confidence = totalWeight > 0 ? winner.weight / totalWeight : 0;

  neg.outcome = {
    winningPosition: winner.position,
    confidence,
    supporters: winner.supporters,
    allPositions: ranked,
    resolvedAt: Date.now(),
  };
  neg.status = "resolved";

  return { ok: true, outcome: neg.outcome };
}

/**
 * Create an action interlock (mutex, ordered, barrier, gate, timeout).
 */
function createInterlock(type, resources, options = {}) {
  if (!Object.values(INTERLOCK_TYPES).includes(type)) {
    return { ok: false, error: `Unknown interlock type: ${type}` };
  }
  capMap(interlocks, MAX_INTERLOCKS);

  const id = `lock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  interlocks.set(id, {
    type,
    resources: resources || [],
    holders: [],
    queue: [],
    maxHolders: type === INTERLOCK_TYPES.MUTEX ? 1 : (options.maxHolders || Infinity),
    barrierCount: options.barrierCount || 0,
    barrierReached: [],
    timeout: options.timeout || null,
    gateApprover: options.gateApprover || null,
    gateApproved: false,
    createdAt: Date.now(),
  });
  return { ok: true, interlockId: id };
}

/**
 * Acquire an interlock. Returns whether acquisition succeeded or must wait.
 */
function acquireInterlock(interlockId, actorId) {
  const lock = interlocks.get(interlockId);
  if (!lock) return { ok: false, error: "Interlock not found" };

  // Check timeout expiry
  if (lock.timeout && lock.holders.length > 0) {
    const oldestHolder = lock.holders[0];
    if (Date.now() - oldestHolder.acquiredAt > lock.timeout) {
      lock.holders = [];
    }
  }

  // Gate check
  if (lock.type === INTERLOCK_TYPES.GATE && !lock.gateApproved) {
    lock.queue.push({ actorId, requestedAt: Date.now() });
    return { ok: true, acquired: false, reason: "Awaiting gate approval" };
  }

  // Barrier check
  if (lock.type === INTERLOCK_TYPES.BARRIER) {
    if (!lock.barrierReached.includes(actorId)) {
      lock.barrierReached.push(actorId);
    }
    if (lock.barrierReached.length >= lock.barrierCount) {
      return { ok: true, acquired: true, barrierCleared: true };
    }
    return { ok: true, acquired: false, reason: `Barrier: ${lock.barrierReached.length}/${lock.barrierCount}` };
  }

  // Mutex / capacity check
  if (lock.holders.length >= lock.maxHolders) {
    lock.queue.push({ actorId, requestedAt: Date.now() });
    return { ok: true, acquired: false, reason: "At capacity, queued" };
  }

  lock.holders.push({ actorId, acquiredAt: Date.now() });
  return { ok: true, acquired: true };
}

/**
 * Release an interlock.
 */
function releaseInterlock(interlockId, actorId) {
  const lock = interlocks.get(interlockId);
  if (!lock) return { ok: false, error: "Interlock not found" };

  lock.holders = lock.holders.filter(h => h.actorId !== actorId);

  // Auto-promote from queue
  if (lock.queue.length > 0 && lock.holders.length < lock.maxHolders) {
    const next = lock.queue.shift();
    lock.holders.push({ actorId: next.actorId, acquiredAt: Date.now() });
    return { ok: true, released: true, promoted: next.actorId };
  }

  return { ok: true, released: true };
}

/**
 * Approve a gate interlock.
 */
function approveGate(interlockId, approverId) {
  const lock = interlocks.get(interlockId);
  if (!lock) return { ok: false, error: "Interlock not found" };
  if (lock.type !== INTERLOCK_TYPES.GATE) return { ok: false, error: "Not a gate interlock" };
  if (lock.gateApprover && lock.gateApprover !== approverId) {
    return { ok: false, error: "Only designated approver can approve" };
  }
  lock.gateApproved = true;

  // Auto-acquire for all queued actors
  const promoted = [];
  while (lock.queue.length > 0 && lock.holders.length < lock.maxHolders) {
    const next = lock.queue.shift();
    lock.holders.push({ actorId: next.actorId, acquiredAt: Date.now() });
    promoted.push(next.actorId);
  }
  return { ok: true, approved: true, promoted };
}

/**
 * Exercise distributed veto on a protocol.
 * Any participant can veto with a reason.
 */
function vetoProtocol(protocolId, actorId, reason, evidence) {
  const proto = protocols.get(protocolId);
  if (!proto) return { ok: false, error: "Protocol not found" };
  if (!proto.participants.some(p => p.actorId === actorId)) {
    return { ok: false, error: "Only participants can veto" };
  }

  proto.vetoes.push({
    actorId,
    reason,
    evidence: evidence || [],
    vetoedAt: Date.now(),
  });
  proto.status = "vetoed";
  proto.updatedAt = Date.now();

  return { ok: true, status: "vetoed", vetoCount: proto.vetoes.length };
}

/**
 * Pause a protocol (distributed pause mechanism).
 */
function pauseProtocol(protocolId, actorId, reason) {
  const proto = protocols.get(protocolId);
  if (!proto) return { ok: false, error: "Protocol not found" };
  if (!proto.participants.some(p => p.actorId === actorId)) {
    return { ok: false, error: "Only participants can pause" };
  }
  proto.status = "paused";
  proto.updatedAt = Date.now();
  return { ok: true, status: "paused", pausedBy: actorId, reason };
}

/**
 * Resume a paused protocol.
 */
function resumeProtocol(protocolId, actorId) {
  const proto = protocols.get(protocolId);
  if (!proto) return { ok: false, error: "Protocol not found" };
  if (proto.status !== "paused") return { ok: false, error: "Protocol not paused" };
  proto.status = "active";
  proto.updatedAt = Date.now();
  return { ok: true, status: "active", resumedBy: actorId };
}

/**
 * Arbitrate priority under uncertainty — uses evidence weight, not actor power.
 */
function arbitratePriority(protocolId) {
  const proto = protocols.get(protocolId);
  if (!proto) return { ok: false, error: "Protocol not found" };

  // Score each participant's plans by evidence backing
  const scores = [];
  for (const plan of proto.plans) {
    const intentMatch = proto.intents.find(i => i.actorId === plan.actorId);
    const evidenceWeight = intentMatch ? computeEvidenceWeight(intentMatch.evidence || []) : 0;
    const urgency = plan.plan.urgency || 0.5;
    const reversibility = plan.plan.reversibility || 0.5;
    // Higher priority for: stronger evidence, higher urgency, higher reversibility
    const priority = (evidenceWeight * 0.5) + (urgency * 0.3) + (reversibility * 0.2);
    scores.push({ actorId: plan.actorId, priority, evidenceWeight, urgency, reversibility });
  }

  scores.sort((a, b) => b.priority - a.priority);
  return { ok: true, priorityOrder: scores };
}

/**
 * Check compatibility envelope for simultaneous actions.
 */
function checkCompatibilityEnvelope(actions) {
  if (!Array.isArray(actions) || actions.length < 2) {
    return { ok: true, compatible: true, violations: [] };
  }

  const violations = [];

  // Check all pairs for resource conflicts
  for (let i = 0; i < actions.length; i++) {
    for (let j = i + 1; j < actions.length; j++) {
      const a = actions[i];
      const b = actions[j];

      // Resource exclusion
      const resA = new Set(a.resources || []);
      const resB = new Set(b.resources || []);
      const shared = [...resA].filter(r => resB.has(r));
      if (shared.length > 0 && (a.exclusive || b.exclusive)) {
        violations.push({
          type: "resource_exclusion",
          actions: [a.id, b.id],
          resources: shared,
        });
      }

      // State precondition conflict
      if (a.postconditions && b.preconditions) {
        for (const post of (a.postconditions || [])) {
          for (const pre of (b.preconditions || [])) {
            if (post.variable === pre.variable && post.value !== pre.value) {
              violations.push({
                type: "state_conflict",
                actions: [a.id, b.id],
                variable: post.variable,
              });
            }
          }
        }
      }
    }
  }

  return { ok: true, compatible: violations.length === 0, violations };
}

/**
 * Get protocol status summary.
 */
function getProtocolStatus(protocolId) {
  const proto = protocols.get(protocolId);
  if (!proto) return { ok: false, error: "Protocol not found" };
  return {
    ok: true,
    protocolId,
    mode: proto.mode,
    status: proto.status,
    participants: proto.participants.length,
    intents: proto.intents.length,
    plans: proto.plans.length,
    conflicts: proto.conflicts.length,
    vetoes: proto.vetoes.length,
    createdAt: proto.createdAt,
    updatedAt: proto.updatedAt,
  };
}

// === MODULE INIT ===

function init({ register }) {
  register("loaf", "create_protocol", (ctx) => {
    const { mode, description } = ctx.args || {};
    return createProtocol(mode || COORDINATION_MODES.PEER, description, ctx.args?.initiatorId);
  }, { public: true });

  register("loaf", "join_protocol", (ctx) => {
    const { protocolId, actorId, intent } = ctx.args || {};
    return joinProtocol(protocolId, actorId, intent);
  }, { public: true });

  register("loaf", "declare_intent", (ctx) => {
    const { protocolId, actorId, intent, evidence } = ctx.args || {};
    return declareIntent(protocolId, actorId, intent, evidence);
  }, { public: true });

  register("loaf", "submit_plan", (ctx) => {
    const { protocolId, actorId, plan } = ctx.args || {};
    return submitPlan(protocolId, actorId, plan);
  }, { public: true });

  register("loaf", "check_plan_compatibility", (ctx) => {
    return checkPlanCompatibility(ctx.args?.protocolId);
  }, { public: true });

  register("loaf", "start_negotiation", (ctx) => {
    const { protocolId, topic } = ctx.args || {};
    return startNegotiation(protocolId, topic);
  }, { public: true });

  register("loaf", "submit_position", (ctx) => {
    const { negotiationId, actorId, position, evidence } = ctx.args || {};
    return submitPosition(negotiationId, actorId, position, evidence);
  }, { public: true });

  register("loaf", "resolve_negotiation", (ctx) => {
    return resolveNegotiation(ctx.args?.negotiationId);
  }, { public: true });

  register("loaf", "create_interlock", (ctx) => {
    const { type, resources, ...options } = ctx.args || {};
    return createInterlock(type, resources, options);
  }, { public: true });

  register("loaf", "acquire_interlock", (ctx) => {
    return acquireInterlock(ctx.args?.interlockId, ctx.args?.actorId);
  }, { public: true });

  register("loaf", "release_interlock", (ctx) => {
    return releaseInterlock(ctx.args?.interlockId, ctx.args?.actorId);
  }, { public: true });

  register("loaf", "veto_protocol", (ctx) => {
    const { protocolId, actorId, reason, evidence } = ctx.args || {};
    return vetoProtocol(protocolId, actorId, reason, evidence);
  }, { public: true });

  register("loaf", "pause_protocol", (ctx) => {
    const { protocolId, actorId, reason } = ctx.args || {};
    return pauseProtocol(protocolId, actorId, reason);
  }, { public: true });

  register("loaf", "arbitrate_priority", (ctx) => {
    return arbitratePriority(ctx.args?.protocolId);
  }, { public: true });

  register("loaf", "check_compatibility_envelope", (ctx) => {
    return checkCompatibilityEnvelope(ctx.args?.actions);
  }, { public: true });

  register("loaf", "protocol_status", (ctx) => {
    return getProtocolStatus(ctx.args?.protocolId);
  }, { public: true });
}

export {
  init,
  COORDINATION_MODES,
  CONFLICT_TYPES,
  INTERLOCK_TYPES,
  VETO_REASONS,
  createProtocol,
  joinProtocol,
  declareIntent,
  computeIntentAlignment,
  submitPlan,
  checkPlanCompatibility,
  startNegotiation,
  submitPosition,
  resolveNegotiation,
  createInterlock,
  acquireInterlock,
  releaseInterlock,
  approveGate,
  vetoProtocol,
  pauseProtocol,
  resumeProtocol,
  arbitratePriority,
  checkCompatibilityEnvelope,
  getProtocolStatus,
};
