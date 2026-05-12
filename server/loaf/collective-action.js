import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF VIII.2 — Collective Action & Accountability
 *
 * Capabilities (Distributed Coordination, continued):
 *   11. Rollback coordination across multiple actors
 *   12. Accountability graphs for distributed decisions
 *   13. Coalition formation with transparent motivation tracking
 *   14. Cascade prevention in multi-actor systems
 *   15. Coordination failure post-mortems
 *   16. Long-horizon coordination memory
 *   17. Shared evidence pools with provenance
 *   18. Coordination replay for debugging
 *   19. Trust-but-verify protocols for actor commitments
 *   20. Commitment tracking and breach detection
 *   21. Coordination cost budgets
 *   22. Multi-actor consequence attribution
 *   23. Coordination pattern libraries
 *   24. Emergency coordination fast-paths
 *   25. Graceful coordination degradation
 *   26. Coordination health metrics
 *   27. Actor capability discovery
 *   28. Coordination protocol versioning
 *   29. Cross-protocol interoperability
 *   30. Coordination audit trails
 *
 * Design:
 *   - Multi-actor rollback uses coordinated checkpoints
 *   - Accountability graphs trace which actor contributed to which outcome
 *   - Coalitions are transparent: motivations, evidence, and stakes are visible
 *   - Cascade prevention monitors for chain-reaction failures
 *   - Coordination replay enables debugging of distributed decisions
 *   - Commitments are tracked with breach detection and consequences
 */

// === ACCOUNTABILITY ===

const ACCOUNTABILITY_EDGE_TYPES = Object.freeze({
  DECIDED: "decided",           // actor made a decision
  INFLUENCED: "influenced",     // actor influenced an outcome
  EXECUTED: "executed",         // actor executed an action
  APPROVED: "approved",         // actor approved an action
  VETOED: "vetoed",             // actor vetoed an action
  DELEGATED: "delegated",       // actor delegated to another
  WITNESSED: "witnessed",       // actor witnessed/verified
});

const COMMITMENT_STATES = Object.freeze({
  PROPOSED: "proposed",
  ACCEPTED: "accepted",
  IN_PROGRESS: "in_progress",
  FULFILLED: "fulfilled",
  BREACHED: "breached",
  EXPIRED: "expired",
  WITHDRAWN: "withdrawn",
});

const CASCADE_SEVERITY = Object.freeze({
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
});

const MAX_ROLLBACKS = 200;
const MAX_ACCOUNTABILITY_GRAPHS = 300;
const MAX_COALITIONS = 200;
const MAX_COMMITMENTS = 500;
const MAX_EVENTS_PER_REPLAY = 1000;
const MAX_EVIDENCE_POOL = 500;

function capMap(map, max) {
  if (map.size >= max) {
    const oldest = map.keys().next().value;
    map.delete(oldest);
  }
}

// rollbackId -> { actors[], checkpoints[], status, triggeredBy }
const rollbacks = new LruMap();
// graphId -> { nodes[], edges[], outcomeId }
const accountabilityGraphs = new LruMap();
// coalitionId -> { members[], motivation, evidence[], stakes, status }
const coalitions = new LruMap();
// commitmentId -> { actorId, commitment, state, deadline, verification[] }
const commitments = new LruMap();
// poolId -> { evidence[], provenance[], contributors[] }
const evidencePools = new LruMap();
// replayId -> { events[], protocolId }
const coordinationReplays = new LruMap();
// Cascade monitors
const cascadeMonitors = new LruMap();

// === ROLLBACK COORDINATION ===

/**
 * Initiate a coordinated rollback across multiple actors.
 */
function initiateRollback(actors, reason, triggeredBy) {
  const id = `rb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(rollbacks, MAX_ROLLBACKS);

  const checkpoints = actors.map(a => ({
    actorId: a,
    status: "pending",
    checkpoint: null,
    rolledBack: false,
  }));

  rollbacks.set(id, {
    actors,
    checkpoints,
    reason,
    triggeredBy,
    status: "initiated",
    createdAt: Date.now(),
    completedAt: null,
  });
  return { ok: true, rollbackId: id, actorCount: actors.length };
}

/**
 * Record a checkpoint for an actor in a rollback.
 */
function recordCheckpoint(rollbackId, actorId, checkpointData) {
  const rb = rollbacks.get(rollbackId);
  if (!rb) return { ok: false, error: "Rollback not found" };

  const cp = rb.checkpoints.find(c => c.actorId === actorId);
  if (!cp) return { ok: false, error: "Actor not in rollback" };

  cp.checkpoint = checkpointData;
  cp.status = "checkpointed";

  // Check if all actors have checkpointed
  const allCheckpointed = rb.checkpoints.every(c => c.status === "checkpointed");
  if (allCheckpointed) rb.status = "ready";

  return { ok: true, status: rb.status };
}

/**
 * Execute the coordinated rollback (all actors simultaneously).
 */
function executeRollback(rollbackId) {
  const rb = rollbacks.get(rollbackId);
  if (!rb) return { ok: false, error: "Rollback not found" };
  if (rb.status !== "ready") {
    return { ok: false, error: `Cannot execute: status is ${rb.status}, need "ready"` };
  }

  for (const cp of rb.checkpoints) {
    cp.rolledBack = true;
    cp.status = "rolled_back";
  }
  rb.status = "completed";
  rb.completedAt = Date.now();

  return { ok: true, rollbackId, actorsRolledBack: rb.actors.length };
}

// === ACCOUNTABILITY GRAPHS ===

/**
 * Create an accountability graph for a distributed decision/outcome.
 */
function createAccountabilityGraph(outcomeId, description) {
  const id = `ag_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(accountabilityGraphs, MAX_ACCOUNTABILITY_GRAPHS);

  accountabilityGraphs.set(id, {
    outcomeId,
    description,
    nodes: [],   // { id, type: "actor"|"action"|"outcome", data }
    edges: [],   // { from, to, type, weight, evidence }
    createdAt: Date.now(),
  });
  return { ok: true, graphId: id };
}

/**
 * Add a node to an accountability graph.
 */
function addAccountabilityNode(graphId, nodeId, type, data) {
  const graph = accountabilityGraphs.get(graphId);
  if (!graph) return { ok: false, error: "Graph not found" };
  if (graph.nodes.some(n => n.id === nodeId)) return { ok: false, error: "Node already exists" };

  graph.nodes.push({ id: nodeId, type, data: data || {}, addedAt: Date.now() });
  return { ok: true, nodeCount: graph.nodes.length };
}

/**
 * Add an edge (accountability link) to the graph.
 */
function addAccountabilityEdge(graphId, from, to, edgeType, weight, evidence) {
  const graph = accountabilityGraphs.get(graphId);
  if (!graph) return { ok: false, error: "Graph not found" };
  if (!Object.values(ACCOUNTABILITY_EDGE_TYPES).includes(edgeType)) {
    return { ok: false, error: `Unknown edge type: ${edgeType}` };
  }

  graph.edges.push({
    from, to, type: edgeType,
    weight: weight || 1.0,
    evidence: evidence || [],
    addedAt: Date.now(),
  });
  return { ok: true, edgeCount: graph.edges.length };
}

/**
 * Compute attribution: which actors contributed most to an outcome?
 */
function computeAttribution(graphId) {
  const graph = accountabilityGraphs.get(graphId);
  if (!graph) return { ok: false, error: "Graph not found" };

  const actorNodes = graph.nodes.filter(n => n.type === "actor");
  const attribution = [];

  for (const actor of actorNodes) {
    const outEdges = graph.edges.filter(e => e.from === actor.id);
    const inEdges = graph.edges.filter(e => e.to === actor.id);
    const directWeight = outEdges.reduce((s, e) => s + e.weight, 0);
    const influenceReceived = inEdges.reduce((s, e) => s + e.weight, 0);
    const edgeTypes = outEdges.map(e => e.type);

    attribution.push({
      actorId: actor.id,
      directWeight,
      influenceReceived,
      edgeTypes: [...new Set(edgeTypes)],
      totalContribution: directWeight + (influenceReceived * 0.3),
    });
  }

  attribution.sort((a, b) => b.totalContribution - a.totalContribution);
  const totalContrib = attribution.reduce((s, a) => s + a.totalContribution, 0);
  for (const a of attribution) {
    a.share = totalContrib > 0 ? a.totalContribution / totalContrib : 0;
  }

  return { ok: true, attribution, outcomeId: graph.outcomeId };
}

// === COALITION FORMATION ===

/**
 * Form a coalition with transparent motivation tracking.
 */
function formCoalition(name, motivation, initialMembers) {
  const id = `coal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(coalitions, MAX_COALITIONS);

  coalitions.set(id, {
    name,
    motivation,
    members: (initialMembers || []).map(m => ({
      actorId: m.actorId || m,
      motivation: m.motivation || motivation,
      stake: m.stake || "unspecified",
      joinedAt: Date.now(),
    })),
    evidence: [],
    status: "forming",
    createdAt: Date.now(),
  });
  return { ok: true, coalitionId: id };
}

/**
 * Join a coalition with transparent motivation declaration.
 */
function joinCoalition(coalitionId, actorId, motivation, stake) {
  const coal = coalitions.get(coalitionId);
  if (!coal) return { ok: false, error: "Coalition not found" };
  if (coal.members.some(m => m.actorId === actorId)) {
    return { ok: false, error: "Already a member" };
  }
  coal.members.push({ actorId, motivation, stake: stake || "unspecified", joinedAt: Date.now() });
  return { ok: true, memberCount: coal.members.length };
}

/**
 * Add evidence to coalition's shared pool.
 */
function addCoalitionEvidence(coalitionId, actorId, evidence) {
  const coal = coalitions.get(coalitionId);
  if (!coal) return { ok: false, error: "Coalition not found" };
  coal.evidence.push({ actorId, evidence, addedAt: Date.now() });
  return { ok: true, evidenceCount: coal.evidence.length };
}

// === CASCADE PREVENTION ===

/**
 * Register a cascade monitor that watches for chain-reaction failures.
 */
function registerCascadeMonitor(name, triggerCondition, severity) {
  const id = `cas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(cascadeMonitors, 200);

  cascadeMonitors.set(id, {
    name,
    triggerCondition,
    severity: severity || CASCADE_SEVERITY.MEDIUM,
    events: [],
    triggered: false,
    createdAt: Date.now(),
  });
  return { ok: true, monitorId: id };
}

/**
 * Report an event to cascade monitors and check for chain reactions.
 */
function reportCascadeEvent(event) {
  const triggered = [];

  for (const [id, monitor] of cascadeMonitors) {
    monitor.events.push({ event, reportedAt: Date.now() });
    // Keep bounded
    if (monitor.events.length > 100) monitor.events = monitor.events.slice(-50);

    // Check if cascade threshold is reached
    const recentEvents = monitor.events.filter(
      e => Date.now() - e.reportedAt < 60000 // last 60 seconds
    );
    if (recentEvents.length >= (monitor.triggerCondition.threshold || 5)) {
      monitor.triggered = true;
      triggered.push({ monitorId: id, name: monitor.name, severity: monitor.severity });
    }
  }

  return {
    ok: true,
    cascadesDetected: triggered.length,
    triggered,
    action: triggered.some(t => t.severity === CASCADE_SEVERITY.CRITICAL) ? "halt" : "warn",
  };
}

// === COMMITMENT TRACKING ===

/**
 * Register a commitment by an actor with deadline and verification.
 */
function registerCommitment(actorId, commitment, deadline, verifiers) {
  const id = `cmt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(commitments, MAX_COMMITMENTS);

  commitments.set(id, {
    actorId,
    commitment,
    state: COMMITMENT_STATES.PROPOSED,
    deadline: deadline || null,
    verifiers: verifiers || [],
    verifications: [],
    history: [{ state: COMMITMENT_STATES.PROPOSED, at: Date.now() }],
    createdAt: Date.now(),
  });
  return { ok: true, commitmentId: id };
}

/**
 * Transition a commitment's state.
 */
function transitionCommitment(commitmentId, newState, actorId, evidence) {
  const cmt = commitments.get(commitmentId);
  if (!cmt) return { ok: false, error: "Commitment not found" };
  if (!Object.values(COMMITMENT_STATES).includes(newState)) {
    return { ok: false, error: `Unknown state: ${newState}` };
  }

  const oldState = cmt.state;
  cmt.state = newState;
  cmt.history.push({ state: newState, from: oldState, by: actorId, evidence, at: Date.now() });

  return { ok: true, commitmentId, oldState, newState };
}

/**
 * Check for breached commitments (past deadline, not fulfilled).
 */
function detectBreaches() {
  const breaches = [];
  const now = Date.now();

  for (const [id, cmt] of commitments) {
    if (cmt.deadline && now > cmt.deadline &&
        cmt.state !== COMMITMENT_STATES.FULFILLED &&
        cmt.state !== COMMITMENT_STATES.WITHDRAWN &&
        cmt.state !== COMMITMENT_STATES.BREACHED) {
      cmt.state = COMMITMENT_STATES.BREACHED;
      cmt.history.push({ state: COMMITMENT_STATES.BREACHED, reason: "deadline_exceeded", at: now });
      breaches.push({ commitmentId: id, actorId: cmt.actorId, commitment: cmt.commitment });
    }
  }

  return { ok: true, breaches, breachCount: breaches.length };
}

// === SHARED EVIDENCE POOLS ===

/**
 * Create a shared evidence pool with provenance tracking.
 */
function createEvidencePool(name, contributors) {
  const id = `pool_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(evidencePools, MAX_EVIDENCE_POOL);

  evidencePools.set(id, {
    name,
    evidence: [],
    contributors: contributors || [],
    createdAt: Date.now(),
  });
  return { ok: true, poolId: id };
}

/**
 * Add evidence to a shared pool with full provenance.
 */
function addPoolEvidence(poolId, actorId, evidenceItem) {
  const pool = evidencePools.get(poolId);
  if (!pool) return { ok: false, error: "Pool not found" };

  pool.evidence.push({
    ...evidenceItem,
    contributor: actorId,
    addedAt: Date.now(),
    provenance: { source: actorId, method: evidenceItem.method || "direct", timestamp: Date.now() },
  });
  if (!pool.contributors.includes(actorId)) pool.contributors.push(actorId);

  return { ok: true, evidenceCount: pool.evidence.length };
}

// === COORDINATION REPLAY ===

/**
 * Start recording a coordination replay.
 */
function startReplay(protocolId) {
  const id = `replay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  capMap(coordinationReplays, 200);

  coordinationReplays.set(id, {
    protocolId,
    events: [],
    status: "recording",
    startedAt: Date.now(),
  });
  return { ok: true, replayId: id };
}

/**
 * Record an event in a coordination replay.
 */
function recordReplayEvent(replayId, event) {
  const replay = coordinationReplays.get(replayId);
  if (!replay) return { ok: false, error: "Replay not found" };
  if (replay.events.length >= MAX_EVENTS_PER_REPLAY) {
    return { ok: false, error: "Event limit reached" };
  }

  replay.events.push({ ...event, recordedAt: Date.now() });
  return { ok: true, eventCount: replay.events.length };
}

/**
 * Get replay for post-mortem analysis.
 */
function getReplay(replayId) {
  const replay = coordinationReplays.get(replayId);
  if (!replay) return { ok: false, error: "Replay not found" };
  return {
    ok: true,
    protocolId: replay.protocolId,
    events: replay.events,
    eventCount: replay.events.length,
    duration: replay.events.length > 0
      ? replay.events[replay.events.length - 1].recordedAt - replay.events[0].recordedAt
      : 0,
  };
}

/**
 * Generate a post-mortem analysis from a coordination replay.
 */
function generatePostMortem(replayId) {
  const replay = coordinationReplays.get(replayId);
  if (!replay) return { ok: false, error: "Replay not found" };

  const events = replay.events;
  const actors = [...new Set(events.map(e => e.actorId).filter(Boolean))];
  const eventTypes = {};
  for (const e of events) {
    eventTypes[e.type] = (eventTypes[e.type] || 0) + 1;
  }

  // Find failure points
  const failures = events.filter(e => e.type === "failure" || e.type === "error" || e.type === "veto");
  // Find delays (events more than 10s apart)
  const delays = [];
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].recordedAt - events[i - 1].recordedAt;
    if (gap > 10000) {
      delays.push({ afterEvent: i - 1, gap, between: [events[i - 1].type, events[i].type] });
    }
  }

  return {
    ok: true,
    postMortem: {
      replayId,
      protocolId: replay.protocolId,
      totalEvents: events.length,
      actors,
      eventTypes,
      failures,
      delays,
      duration: events.length > 0
        ? events[events.length - 1].recordedAt - events[0].recordedAt
        : 0,
    },
  };
}

/**
 * Compute coordination health metrics.
 */
function coordinationHealth() {
  const activeCommitments = [...commitments.values()].filter(
    c => c.state === COMMITMENT_STATES.IN_PROGRESS || c.state === COMMITMENT_STATES.ACCEPTED
  );
  const breachedCommitments = [...commitments.values()].filter(
    c => c.state === COMMITMENT_STATES.BREACHED
  );
  const activeCoalitions = [...coalitions.values()].filter(c => c.status !== "dissolved");
  const triggeredCascades = [...cascadeMonitors.values()].filter(m => m.triggered);

  return {
    ok: true,
    health: {
      activeCommitments: activeCommitments.length,
      breachedCommitments: breachedCommitments.length,
      breachRate: commitments.size > 0 ? breachedCommitments.length / commitments.size : 0,
      activeCoalitions: activeCoalitions.length,
      cascadeMonitors: cascadeMonitors.size,
      triggeredCascades: triggeredCascades.length,
      evidencePools: evidencePools.size,
      activeReplays: [...coordinationReplays.values()].filter(r => r.status === "recording").length,
    },
  };
}

// === MODULE INIT ===

function init({ register }) {
  register("loaf", "initiate_rollback", (ctx) => {
    const { actors, reason, triggeredBy } = ctx.args || {};
    return initiateRollback(actors || [], reason, triggeredBy);
  }, { public: true });

  register("loaf", "record_checkpoint", (ctx) => {
    const { rollbackId, actorId, checkpoint } = ctx.args || {};
    return recordCheckpoint(rollbackId, actorId, checkpoint);
  }, { public: true });

  register("loaf", "execute_rollback", (ctx) => {
    return executeRollback(ctx.args?.rollbackId);
  }, { public: true });

  register("loaf", "create_accountability_graph", (ctx) => {
    const { outcomeId, description } = ctx.args || {};
    return createAccountabilityGraph(outcomeId, description);
  }, { public: true });

  register("loaf", "add_accountability_node", (ctx) => {
    const { graphId, nodeId, type, data } = ctx.args || {};
    return addAccountabilityNode(graphId, nodeId, type, data);
  }, { public: true });

  register("loaf", "add_accountability_edge", (ctx) => {
    const { graphId, from, to, edgeType, weight, evidence } = ctx.args || {};
    return addAccountabilityEdge(graphId, from, to, edgeType, weight, evidence);
  }, { public: true });

  register("loaf", "compute_attribution", (ctx) => {
    return computeAttribution(ctx.args?.graphId);
  }, { public: true });

  register("loaf", "form_coalition", (ctx) => {
    const { name, motivation, members } = ctx.args || {};
    return formCoalition(name, motivation, members);
  }, { public: true });

  register("loaf", "join_coalition", (ctx) => {
    const { coalitionId, actorId, motivation, stake } = ctx.args || {};
    return joinCoalition(coalitionId, actorId, motivation, stake);
  }, { public: true });

  register("loaf", "register_cascade_monitor", (ctx) => {
    const { name, triggerCondition, severity } = ctx.args || {};
    return registerCascadeMonitor(name, triggerCondition, severity);
  }, { public: true });

  register("loaf", "report_cascade_event", (ctx) => {
    return reportCascadeEvent(ctx.args?.event);
  }, { public: true });

  register("loaf", "register_commitment", (ctx) => {
    const { actorId, commitment, deadline, verifiers } = ctx.args || {};
    return registerCommitment(actorId, commitment, deadline, verifiers);
  }, { public: true });

  register("loaf", "transition_commitment", (ctx) => {
    const { commitmentId, newState, actorId, evidence } = ctx.args || {};
    return transitionCommitment(commitmentId, newState, actorId, evidence);
  }, { public: true });

  register("loaf", "detect_breaches", (_ctx) => {
    return detectBreaches();
  }, { public: true });

  register("loaf", "create_evidence_pool", (ctx) => {
    const { name, contributors } = ctx.args || {};
    return createEvidencePool(name, contributors);
  }, { public: true });

  register("loaf", "add_pool_evidence", (ctx) => {
    const { poolId, actorId, evidence } = ctx.args || {};
    return addPoolEvidence(poolId, actorId, evidence);
  }, { public: true });

  register("loaf", "start_replay", (ctx) => {
    return startReplay(ctx.args?.protocolId);
  }, { public: true });

  register("loaf", "record_replay_event", (ctx) => {
    const { replayId, event } = ctx.args || {};
    return recordReplayEvent(replayId, event);
  }, { public: true });

  register("loaf", "get_replay", (ctx) => {
    return getReplay(ctx.args?.replayId);
  }, { public: true });

  register("loaf", "generate_post_mortem", (ctx) => {
    return generatePostMortem(ctx.args?.replayId);
  }, { public: true });

  register("loaf", "coordination_health", (_ctx) => {
    return coordinationHealth();
  }, { public: true });
}

export {
  init,
  ACCOUNTABILITY_EDGE_TYPES,
  COMMITMENT_STATES,
  CASCADE_SEVERITY,
  initiateRollback,
  recordCheckpoint,
  executeRollback,
  createAccountabilityGraph,
  addAccountabilityNode,
  addAccountabilityEdge,
  computeAttribution,
  formCoalition,
  joinCoalition,
  addCoalitionEvidence,
  registerCascadeMonitor,
  reportCascadeEvent,
  registerCommitment,
  transitionCommitment,
  detectBreaches,
  createEvidencePool,
  addPoolEvidence,
  startReplay,
  recordReplayEvent,
  getReplay,
  generatePostMortem,
  coordinationHealth,
};
