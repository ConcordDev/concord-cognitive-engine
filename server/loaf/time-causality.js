import { LruMap, LruSet } from "../lib/lru-map.js";
/**
 * LOAF III.3 — Time & Causality Engine
 *
 * - Versioned timelines
 * - Causal graphs
 * - Counterfactual simulation
 * - "What changed and why" queries
 * - Forked reality analysis
 */

// Timeline store: each timeline is a versioned sequence of states
const timelines = new LruMap();  // timelineId -> Timeline

// Causal graph: events linked by cause-effect edges
const causalGraph = {
  nodes: new Map(),    // eventId -> { id, type, description, ts, data }
  edges: new Map(),    // edgeId -> { id, from, to, type, strength, metadata }
  adjacency: new Map(), // nodeId -> Set<edgeId>
};

/**
 * Create a new timeline.
 */
function createTimeline(id, label) {
  const timelineId = id || `tl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const timeline = {
    id: timelineId,
    label: String(label || "default"),
    versions: [],        // [{version, state, ts, description}]
    forks: [],           // [{forkId, fromVersion, reason}]
    createdAt: new Date().toISOString(),
    currentVersion: 0,
  };
  timelines.set(timelineId, timeline);
  return { ok: true, timeline: { id: timeline.id, label: timeline.label, versions: 0 } };
}

/**
 * Add a version (snapshot) to a timeline.
 */
function addTimelineVersion(timelineId, state, description) {
  const timeline = timelines.get(timelineId);
  if (!timeline) return { ok: false, error: "timeline_not_found" };

  const version = {
    version: timeline.versions.length + 1,
    state: (() => { try { return JSON.parse(JSON.stringify(state)); } catch (err) { console.debug('[time-causality] deep clone failed', err?.message); return { ...state }; } })(),  // deep clone with circular-ref fallback
    ts: new Date().toISOString(),
    description: String(description || ""),
  };

  timeline.versions.push(version);
  timeline.currentVersion = version.version;

  return { ok: true, version: version.version, timelineId };
}

/**
 * Get a specific version of a timeline.
 */
function getTimelineVersion(timelineId, version) {
  const timeline = timelines.get(timelineId);
  if (!timeline) return { ok: false, error: "timeline_not_found" };

  const v = version
    ? timeline.versions.find(v => v.version === version)
    : timeline.versions[timeline.versions.length - 1];

  if (!v) return { ok: false, error: "version_not_found" };
  return { ok: true, ...v };
}

/**
 * Fork a timeline at a specific version (creates a new alternate timeline).
 */
function forkTimeline(sourceTimelineId, atVersion, reason) {
  const source = timelines.get(sourceTimelineId);
  if (!source) return { ok: false, error: "source_timeline_not_found" };

  const forkVersion = atVersion || source.currentVersion;
  const versionsToKeep = source.versions.filter(v => v.version <= forkVersion);
  if (versionsToKeep.length === 0) return { ok: false, error: "no_versions_at_fork_point" };

  const forkId = `tl_fork_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const forked = {
    id: forkId,
    label: `Fork of ${source.label} at v${forkVersion}`,
    versions: versionsToKeep.map(v => ({ ...v })),
    forks: [],
    createdAt: new Date().toISOString(),
    currentVersion: forkVersion,
    sourceTimeline: sourceTimelineId,
    forkPoint: forkVersion,
  };

  timelines.set(forkId, forked);

  // Record fork in source
  source.forks.push({
    forkId,
    fromVersion: forkVersion,
    reason: String(reason || ""),
    forkedAt: new Date().toISOString(),
  });

  return { ok: true, forkId, sourceTimeline: sourceTimelineId, forkPoint: forkVersion };
}

/**
 * "What changed and why" query: diff two versions of a timeline.
 */
function queryChanges(timelineId, fromVersion, toVersion) {
  const timeline = timelines.get(timelineId);
  if (!timeline) return { ok: false, error: "timeline_not_found" };

  const from = timeline.versions.find(v => v.version === fromVersion);
  const to = timeline.versions.find(v => v.version === toVersion);

  if (!from || !to) return { ok: false, error: "version_not_found" };

  // Compute diff between states
  const changes = diffStates(from.state, to.state);

  // Find causal events between these versions (guard against invalid dates)
  const fromTs = new Date(from.ts).getTime();
  const toTs = new Date(to.ts).getTime();
  const causalEvents = (isNaN(fromTs) || isNaN(toTs)) ? [] : Array.from(causalGraph.nodes.values())
    .filter(n => {
      const nTs = new Date(n.ts).getTime();
      return !isNaN(nTs) && nTs >= fromTs && nTs <= toTs;
    })
    .sort((a, b) => new Date(a.ts) - new Date(b.ts));

  return {
    ok: true,
    fromVersion,
    toVersion,
    changes,
    causalEvents,
    descriptions: {
      from: from.description,
      to: to.description,
    },
  };
}

/**
 * Simple state diff: find added, removed, and changed keys.
 */
function diffStates(stateA, stateB) {
  const keysA = new Set(Object.keys(stateA || {}));
  const keysB = new Set(Object.keys(stateB || {}));

  const added = [];
  const removed = [];
  const changed = [];

  for (const key of keysB) {
    if (!keysA.has(key)) {
      added.push({ key, value: stateB[key] });
    } else if (JSON.stringify(stateA[key]) !== JSON.stringify(stateB[key])) {
      changed.push({ key, from: stateA[key], to: stateB[key] });
    }
  }

  for (const key of keysA) {
    if (!keysB.has(key)) {
      removed.push({ key, value: stateA[key] });
    }
  }

  return { added, removed, changed, totalChanges: added.length + removed.length + changed.length };
}

/**
 * Add a causal event node.
 */
function addCausalEvent(id, type, description, data = {}) {
  const eventId = id || `ce_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const node = {
    id: eventId,
    type: String(type),
    description: String(description),
    ts: new Date().toISOString(),
    data,
  };
  causalGraph.nodes.set(eventId, node);
  if (!causalGraph.adjacency.has(eventId)) causalGraph.adjacency.set(eventId, new Set());
  return { ok: true, event: node };
}

/**
 * Add a causal edge (cause -> effect).
 */
function addCausalEdge(causeId, effectId, type = "causes", strength = 1.0, metadata = {}) {
  if (!causalGraph.nodes.has(causeId)) return { ok: false, error: "cause_event_not_found" };
  if (!causalGraph.nodes.has(effectId)) return { ok: false, error: "effect_event_not_found" };

  const edgeId = `${causeId}->${effectId}`;
  const edge = {
    id: edgeId,
    from: causeId,
    to: effectId,
    type: String(type),
    strength: Math.max(0, Math.min(1, Number(strength))),
    metadata,
    createdAt: new Date().toISOString(),
  };
  causalGraph.edges.set(edgeId, edge);

  if (!causalGraph.adjacency.has(causeId)) causalGraph.adjacency.set(causeId, new Set());
  causalGraph.adjacency.get(causeId).add(edgeId);

  return { ok: true, edge };
}

/**
 * Trace causal chain: find all causes/effects of an event.
 */
function traceCausalChain(eventId, direction = "effects", maxDepth = 10) {
  const visited = new Set();
  const chain = [];

  function traverse(nodeId, depth) {
    if (depth >= maxDepth || visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = causalGraph.nodes.get(nodeId);
    if (!node) return;

    chain.push({ ...node, depth });

    if (direction === "effects") {
      // Follow outgoing edges
      const edgeIds = causalGraph.adjacency.get(nodeId) || new Set();
      for (const edgeId of edgeIds) {
        const edge = causalGraph.edges.get(edgeId);
        if (edge) traverse(edge.to, depth + 1);
      }
    } else {
      // Follow incoming edges (causes)
      for (const edge of causalGraph.edges.values()) {
        if (edge.to === nodeId) traverse(edge.from, depth + 1);
      }
    }
  }

  traverse(eventId, 0);
  return { chain, depth: Math.max(0, ...chain.map(c => c.depth)) };
}

/**
 * Counterfactual simulation: "What if event X didn't happen?"
 */
function simulateCounterfactual(eventId, alternativePayload = null) {
  const event = causalGraph.nodes.get(eventId);
  if (!event) return { ok: false, error: "event_not_found" };

  // Find all effects of this event
  const effects = traceCausalChain(eventId, "effects");

  // Find all causes of this event
  const causes = traceCausalChain(eventId, "causes");

  // Simulate: if event didn't happen, its effects would be removed
  const removedEffects = effects.chain.filter(c => c.id !== eventId);

  // If alternative payload provided, simulate different effects
  const alternativeEffects = alternativePayload
    ? removedEffects.map(e => ({
        ...e,
        data: { ...e.data, counterfactual: true, alternative: alternativePayload },
      }))
    : [];

  return {
    ok: true,
    originalEvent: event,
    removedEffects,
    alternativeEffects,
    causes: causes.chain.filter(c => c.id !== eventId),
    impact: {
      effectsRemoved: removedEffects.length,
      causesIdentified: causes.chain.length - 1,
      maxDepth: effects.depth,
    },
  };
}

function init({ register, STATE, helpers: _helpers }) {
  STATE.__loaf = STATE.__loaf || {};
  STATE.__loaf.timeCausality = {
    stats: {
      timelinesCreated: 0, versionsAdded: 0, forks: 0,
      causalEventsAdded: 0, causalEdgesAdded: 0, queriesRun: 0, counterfactuals: 0,
    },
  };

  register("loaf.time", "status", (ctx) => {
    const tc = ctx.state.__loaf.timeCausality;
    return {
      ok: true,
      timelines: timelines.size,
      causalNodes: causalGraph.nodes.size,
      causalEdges: causalGraph.edges.size,
      stats: tc.stats,
    };
  }, { public: true });

  register("loaf.time", "create_timeline", (ctx, input = {}) => {
    const tc = ctx.state.__loaf.timeCausality;
    const result = createTimeline(input.id, input.label);
    if (result.ok) tc.stats.timelinesCreated++;
    return result;
  }, { public: false });

  register("loaf.time", "add_version", (ctx, input = {}) => {
    const tc = ctx.state.__loaf.timeCausality;
    const result = addTimelineVersion(String(input.timelineId || ""), input.state, input.description);
    if (result.ok) tc.stats.versionsAdded++;
    return result;
  }, { public: false });

  register("loaf.time", "get_version", (_ctx, input = {}) => {
    return getTimelineVersion(String(input.timelineId || ""), input.version);
  }, { public: true });

  register("loaf.time", "fork", (ctx, input = {}) => {
    const tc = ctx.state.__loaf.timeCausality;
    const result = forkTimeline(String(input.timelineId || ""), input.atVersion, input.reason);
    if (result.ok) tc.stats.forks++;
    return result;
  }, { public: false });

  register("loaf.time", "what_changed", (ctx, input = {}) => {
    const tc = ctx.state.__loaf.timeCausality;
    tc.stats.queriesRun++;
    return queryChanges(String(input.timelineId || ""), input.fromVersion, input.toVersion);
  }, { public: true });

  register("loaf.time", "add_causal_event", (ctx, input = {}) => {
    const tc = ctx.state.__loaf.timeCausality;
    const result = addCausalEvent(input.id, input.type, input.description, input.data);
    if (result.ok) tc.stats.causalEventsAdded++;
    return result;
  }, { public: false });

  register("loaf.time", "add_causal_edge", (ctx, input = {}) => {
    const tc = ctx.state.__loaf.timeCausality;
    const result = addCausalEdge(input.causeId, input.effectId, input.type, input.strength, input.metadata);
    if (result.ok) tc.stats.causalEdgesAdded++;
    return result;
  }, { public: false });

  register("loaf.time", "trace_chain", (_ctx, input = {}) => {
    return { ok: true, ...traceCausalChain(String(input.eventId || ""), input.direction, input.maxDepth) };
  }, { public: true });

  register("loaf.time", "counterfactual", (ctx, input = {}) => {
    const tc = ctx.state.__loaf.timeCausality;
    tc.stats.counterfactuals++;
    return simulateCounterfactual(String(input.eventId || ""), input.alternative);
  }, { public: true });

  register("loaf.time", "list_timelines", (_ctx) => {
    const list = Array.from(timelines.values()).map(t => ({
      id: t.id, label: t.label, versions: t.versions.length,
      forks: t.forks.length, currentVersion: t.currentVersion, createdAt: t.createdAt,
    }));
    return { ok: true, timelines: list };
  }, { public: true });
}

export {
  createTimeline,
  addTimelineVersion,
  getTimelineVersion,
  forkTimeline,
  queryChanges,
  diffStates,
  addCausalEvent,
  addCausalEdge,
  traceCausalChain,
  simulateCounterfactual,
  init,
};
