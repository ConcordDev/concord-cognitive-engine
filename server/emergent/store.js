/**
 * Emergent Agent Governance — State Store
 *
 * Manages all persistent state for the emergent system:
 *   - Emergent registry
 *   - Dialogue sessions
 *   - Gate traces
 *   - Growth artifacts (patterns, reputation, specializations)
 *   - Output bundles
 */

import { MEMORY_POLICIES } from "./schema.js";
import logger from '../logger.js';

/**
 * Create the emergent state namespace.
 * Attached to STATE.__emergent by the init function.
 */
export function createEmergentState() {
  return {
    version: "1.0.0",
    initialized: false,
    initializedAt: null,

    // ── Core registries ───────────────────────────────────────────────────
    emergents: new Map(),         // emergentId -> Emergent
    sessions: new Map(),          // sessionId -> DialogueSession
    outputBundles: new Map(),     // bundleId -> OutputBundle
    gateTraces: new Map(),        // traceId -> GateTrace

    // ── Growth artifacts ──────────────────────────────────────────────────
    patterns: new Map(),          // patternId -> learned reasoning pattern
    reputations: new Map(),       // emergentId -> ReputationVector
    specializations: [],          // role fork log

    // ── Indices ───────────────────────────────────────────────────────────
    sessionsByEmergent: new Map(), // emergentId -> Set<sessionId>
    contentHashes: new Set(),      // dedup hashes for novelty enforcement

    // ── Rate / budget tracking ────────────────────────────────────────────
    rateBuckets: new Map(),       // emergentId -> { count, windowStart }
    activeSessions: 0,            // current concurrent session count

    // ── Metrics ───────────────────────────────────────────────────────────
    metrics: {
      sessionsCreated: 0,
      sessionsCompleted: 0,
      turnsProcessed: 0,
      gateChecks: 0,
      gateDenials: 0,
      dtusProposed: 0,
      dtusPromoted: 0,
      echoWarnings: 0,
      noveltyStops: 0,
      rateBlocks: 0,
    },
  };
}

/**
 * Get or create the emergent state on the global STATE object.
 */
export function getEmergentState(STATE) {
  if (!STATE.__emergent) {
    STATE.__emergent = createEmergentState();
  }
  return STATE.__emergent;
}

// ── Emergent CRUD ─────────────────────────────────────────────────────────

export function registerEmergent(state, emergent) {
  state.emergents.set(emergent.id, {
    ...emergent,
    instanceScope: emergent.instanceScope || "local",
    district: emergent.district || "commons",
    districtHistory: emergent.districtHistory || [],
    districtAffinity: emergent.districtAffinity || {},
    createdAt: new Date().toISOString(),
    active: true,
  });
  // Initialize reputation
  if (!state.reputations.has(emergent.id)) {
    state.reputations.set(emergent.id, {
      emergentId: emergent.id,
      accepted: 0,
      rejected: 0,
      contradictionsCaught: 0,
      predictionsValidated: 0,
      credibility: 0.5,  // neutral start
      history: [],
    });
  }
  // Initialize session index
  if (!state.sessionsByEmergent.has(emergent.id)) {
    state.sessionsByEmergent.set(emergent.id, new Set());
  }

  // Wire body instantiation for new entities
  try {
    import("./body-instantiation.js").then(mod => {
      if (mod?.instantiateBody) mod.instantiateBody(emergent.id, { generation: 1 });
    }).catch(e => console.warn('[emergent:store] async op failed:', e?.message));
  } catch (_e) { logger.debug('emergent:store', 'silent catch', { error: _e?.message }); }

  // Wire species classification
  try {
    import("./species.js").then(mod => {
      if (mod?.classifyEntity) {
        const result = mod.classifyEntity(emergent);
        if (result?.species) {
          const stored = state.emergents.get(emergent.id);
          if (stored) {
            stored.species = result.species;
            stored.speciesConfidence = result.confidence;
          }
        }
      }
    }).catch(e => console.warn('[emergent:store] async op failed:', e?.message));
  } catch (_e) { logger.debug('emergent:store', 'silent catch', { error: _e?.message }); }

  // Wire subjective time initialization
  try {
    import("./subjective-time.js").then(mod => {
      if (mod?.recordTick) {
        // Wrap the emergent state so subjective-time can find its internal
        // store via the `__emergent` discriminator key.
        const tickState = { __emergent: state };
        mod.recordTick(tickState, emergent.id);
      }
    }).catch(e => console.warn('[emergent:store] async op failed:', e?.message));
  } catch (_e) { logger.debug('emergent:store', 'silent catch', { error: _e?.message }); }

  return emergent;
}

// Add computed 'state' field for frontend compatibility (frontend uses e.state, backend stores e.active)
function _withState(e) {
  if (!e) return e;
  return { ...e, state: e.active ? "active" : "inactive" };
}

export function getEmergent(state, id) {
  const e = state.emergents.get(id) || null;
  return _withState(e);
}

export function listEmergents(state, { role, active, instanceScope } = {}) {
  let results = Array.from(state.emergents.values());
  if (role) results = results.filter(e => e.role === role);
  if (active !== undefined) results = results.filter(e => e.active === active);
  if (instanceScope) results = results.filter(e => (e.instanceScope || "local") === instanceScope);
  return results.map(_withState);
}

export function deactivateEmergent(state, id) {
  const e = state.emergents.get(id);
  if (!e) return null;
  e.active = false;
  return _withState(e);
}

// ── Session CRUD ──────────────────────────────────────────────────────────

export function createSession(state, session) {
  state.sessions.set(session.sessionId, session);
  state.metrics.sessionsCreated++;
  state.activeSessions++;

  // Index participants
  for (const pid of session.participants) {
    if (!state.sessionsByEmergent.has(pid)) {
      state.sessionsByEmergent.set(pid, new Set());
    }
    state.sessionsByEmergent.get(pid).add(session.sessionId);
  }

  return session;
}

export function getSession(state, sessionId) {
  return state.sessions.get(sessionId) || null;
}

export function completeSession(state, sessionId) {
  const session = state.sessions.get(sessionId);
  if (!session) return null;
  session.status = "completed";
  session.completedAt = new Date().toISOString();
  state.metrics.sessionsCompleted++;
  state.activeSessions = Math.max(0, state.activeSessions - 1);

  // Apply memory policy
  if (session.memoryPolicy === MEMORY_POLICIES.SESSION_ONLY) {
    // Keep structure but clear turn content
    session.turns = session.turns.map(t => ({
      ...t,
      claim: "[cleared]",
      support: null,
      counterpoint: null,
      question: null,
    }));
  }

  return session;
}

// ── Output Bundle ─────────────────────────────────────────────────────────

export function storeOutputBundle(state, bundle) {
  state.outputBundles.set(bundle.bundleId, bundle);
  return bundle;
}

export function getOutputBundle(state, bundleId) {
  return state.outputBundles.get(bundleId) || null;
}

// ── Gate Trace ────────────────────────────────────────────────────────────

export function storeGateTrace(state, trace) {
  state.gateTraces.set(trace.traceId, trace);
  state.metrics.gateChecks++;
  if (!trace.passed) state.metrics.gateDenials++;
  return trace;
}

export function getGateTrace(state, traceId) {
  return state.gateTraces.get(traceId) || null;
}

export function getGateTracesForSession(state, sessionId) {
  return Array.from(state.gateTraces.values())
    .filter(t => t.sessionId === sessionId);
}

// ── Reputation ────────────────────────────────────────────────────────────

export function getReputation(state, emergentId) {
  return state.reputations.get(emergentId) || null;
}

export function updateReputation(state, emergentId, event) {
  const rep = state.reputations.get(emergentId);
  if (!rep) return null;

  switch (event.type) {
    case "accepted":
      rep.accepted++;
      rep.credibility = Math.min(1, rep.credibility + 0.02);
      break;
    case "rejected":
      rep.rejected++;
      rep.credibility = Math.max(0, rep.credibility - 0.01);
      break;
    case "contradiction_caught":
      rep.contradictionsCaught++;
      rep.credibility = Math.min(1, rep.credibility + 0.03);
      break;
    case "prediction_validated":
      rep.predictionsValidated++;
      rep.credibility = Math.min(1, rep.credibility + 0.05);
      break;
    default:
      break;
  }

  rep.history.push({
    ...event,
    timestamp: new Date().toISOString(),
    credibilityAfter: rep.credibility,
  });

  // Cap history length
  if (rep.history.length > 200) {
    rep.history = rep.history.slice(-100);
  }

  return rep;
}

// ── Patterns ──────────────────────────────────────────────────────────────

export function storePattern(state, pattern) {
  state.patterns.set(pattern.patternId, pattern);
  return pattern;
}

export function getPatterns(state, { role, emergentId } = {}) {
  let results = Array.from(state.patterns.values());
  if (role) results = results.filter(p => p.role === role);
  if (emergentId) results = results.filter(p => p.emergentId === emergentId);
  return results;
}

// ── Rate Limiting ─────────────────────────────────────────────────────────

export function checkRate(state, emergentId, maxPerWindow = 100, windowMs = 3600000) {
  const now = Date.now();
  let bucket = state.rateBuckets.get(emergentId);

  if (!bucket || (now - bucket.windowStart) > windowMs) {
    bucket = { count: 0, windowStart: now };
    state.rateBuckets.set(emergentId, bucket);
  }

  if (bucket.count >= maxPerWindow) {
    state.metrics.rateBlocks++;
    return { allowed: false, remaining: 0, resetsAt: bucket.windowStart + windowMs };
  }

  bucket.count++;
  return { allowed: true, remaining: maxPerWindow - bucket.count, resetsAt: bucket.windowStart + windowMs };
}
