/**
 * Session Context Accumulator
 *
 * Maintains compounding session context that grows across messages.
 * If someone starts talking about their farm, then asks about insurance,
 * then asks about a loan — the accumulator doesn't treat these as three
 * separate queries. The context engine recognizes the thread and each
 * subsequent question pulls from the accumulated session context plus
 * all relevant lenses.
 *
 * Integrates with:
 *   - chat-router.js (feeds domain signals to router)
 *   - context-engine.js (feeds activation pipeline)
 *   - lens-manifest.js (lens registry lookups)
 *
 * By the fifth message, the rail is operating with a rich multi-domain
 * context that no single-lens interaction could produce.
 */

// ── Session Store ────────────────────────────────────────────────────────

/** sessionId → SessionAccumulator */
const _sessions = new Map();

// Bumped for 32GB-heap deployments. Session context accumulator is the
// LLM's working memory across lens visits; bigger windows = better
// continuity for long sessions across many of the 175 lenses.
const MAX_SESSION_HISTORY = Number(process.env.CONCORD_SESSION_HISTORY) || 300;
const MAX_DOMAIN_SIGNALS = Number(process.env.CONCORD_DOMAIN_SIGNALS) || 500;
const MAX_ACTIVE_LENSES = Number(process.env.CONCORD_ACTIVE_LENSES) || 175; // every lens, in principle
const SIGNAL_DECAY_FACTOR = 0.85;
const SESSION_TTL_MS = 4 * 3600_000; // 4 hours

// ── SessionAccumulator Shape ─────────────────────────────────────────────

/**
 * Create a new session accumulator.
 */
export function createAccumulator(sessionId) {
  const acc = {
    sessionId,
    createdAt: Date.now(),
    lastUpdatedAt: Date.now(),
    turnCount: 0,

    // Domain signals with decay weights
    // tag → { weight, firstSeen, lastSeen, turnCount }
    domainSignals: new Map(),

    // Active lens history (ordered by most recent use)
    activeLenses: [],

    // Action type distribution for this session
    actionHistory: [],

    // Accumulated topic thread
    topicThread: [],

    // Cross-domain connections discovered during session
    crossDomainLinks: [],

    // Lenses that contributed to responses
    contributingLenses: new Set(),
  };

  _sessions.set(sessionId, acc);
  return acc;
}

/**
 * Get or create accumulator for a session.
 */
export function getAccumulator(sessionId) {
  let acc = _sessions.get(sessionId);
  if (!acc) acc = createAccumulator(sessionId);

  // TTL check
  if (Date.now() - acc.lastUpdatedAt > SESSION_TTL_MS) {
    acc = createAccumulator(sessionId);
  }

  return acc;
}

// ── Accumulation ─────────────────────────────────────────────────────────

/**
 * Accumulate context from a new message turn.
 *
 * Call this after the chat router produces a route plan.
 * The accumulator absorbs the domain signals, lens selections,
 * and action type from this turn, compounding with prior context.
 *
 * @param {string} sessionId
 * @param {Object} routePlan - From chatRouter.routeMessage()
 * @param {string} message - The user message
 * @returns {SessionAccumulator}
 */
export function accumulate(sessionId, routePlan, message) {
  const acc = getAccumulator(sessionId);
  acc.turnCount++;
  acc.lastUpdatedAt = Date.now();

  // ── Decay existing signals before adding new ones ──
  decaySignals(acc);

  // ── Absorb domain signals ──
  if (routePlan?.domainSignals) {
    for (const signal of routePlan.domainSignals) {
      const existing = acc.domainSignals.get(signal);
      if (existing) {
        existing.weight = Math.min(1.0, existing.weight + 0.3);
        existing.lastSeen = acc.turnCount;
        existing.turnCount++;
      } else {
        acc.domainSignals.set(signal, {
          weight: 0.5,
          firstSeen: acc.turnCount,
          lastSeen: acc.turnCount,
          turnCount: 1,
        });
      }
    }
  }

  // Cap domain signals
  if (acc.domainSignals.size > MAX_DOMAIN_SIGNALS) {
    const sorted = Array.from(acc.domainSignals.entries())
      .sort(([, a], [, b]) => b.weight - a.weight);
    acc.domainSignals = new Map(sorted.slice(0, MAX_DOMAIN_SIGNALS));
  }

  // ── Track active lenses ──
  if (routePlan?.lenses) {
    for (const lens of routePlan.lenses) {
      const lensId = lens.lensId || lens;
      // Move to front of active list
      acc.activeLenses = acc.activeLenses.filter(l => l !== lensId);
      acc.activeLenses.unshift(lensId);
      acc.contributingLenses.add(lensId);
    }
    // Cap
    if (acc.activeLenses.length > MAX_ACTIVE_LENSES) {
      acc.activeLenses = acc.activeLenses.slice(0, MAX_ACTIVE_LENSES);
    }
  }

  // ── Track action type ──
  if (routePlan?.actionType) {
    acc.actionHistory.push({
      type: routePlan.actionType,
      turn: acc.turnCount,
    });
    if (acc.actionHistory.length > MAX_SESSION_HISTORY) {
      acc.actionHistory = acc.actionHistory.slice(-MAX_SESSION_HISTORY);
    }
  }

  // ── Add to topic thread ──
  if (message) {
    acc.topicThread.push({
      turn: acc.turnCount,
      snippet: String(message).slice(0, 200),
      actionType: routePlan?.actionType || null,
      lenses: (routePlan?.lenses || []).slice(0, 3).map(l => l.lensId || l),
    });
    if (acc.topicThread.length > MAX_SESSION_HISTORY) {
      acc.topicThread = acc.topicThread.slice(-MAX_SESSION_HISTORY);
    }
  }

  // ── Detect cross-domain connections ──
  if (routePlan?.isMultiLens && routePlan.lenses.length >= 2) {
    const domains = routePlan.lenses.slice(0, 4).map(l => l.lensId || l);
    acc.crossDomainLinks.push({
      turn: acc.turnCount,
      domains,
      actionType: routePlan.actionType,
    });
  }

  return acc;
}

// ── Signal Decay ─────────────────────────────────────────────────────────

function decaySignals(acc) {
  const toRemove = [];
  for (const [signal, data] of acc.domainSignals) {
    data.weight *= SIGNAL_DECAY_FACTOR;
    if (data.weight < 0.05) {
      toRemove.push(signal);
    }
  }
  for (const signal of toRemove) {
    acc.domainSignals.delete(signal);
  }
}

// ── Context Snapshot ─────────────────────────────────────────────────────

/**
 * Get a snapshot of accumulated context for the chat router.
 *
 * This is what gets passed to routeMessage() as opts.sessionContext.
 * Contains the compounded domain signals and active lenses from all
 * prior turns in the session.
 *
 * @param {string} sessionId
 * @returns {Object} context snapshot
 */
export function getContextSnapshot(sessionId) {
  const acc = _sessions.get(sessionId);
  if (!acc) {
    return {
      domainSignals: [],
      activeLenses: [],
      turnCount: 0,
      crossDomainLinks: [],
      actionDistribution: {},
    };
  }

  // Build weighted domain signal list
  const domainSignals = Array.from(acc.domainSignals.entries())
    .filter(([, data]) => data.weight >= 0.1)
    .sort(([, a], [, b]) => b.weight - a.weight)
    .map(([signal]) => signal);

  // Action type distribution
  const actionDistribution = {};
  for (const { type } of acc.actionHistory) {
    actionDistribution[type] = (actionDistribution[type] || 0) + 1;
  }

  return {
    domainSignals,
    activeLenses: acc.activeLenses.slice(0, 8),
    turnCount: acc.turnCount,
    crossDomainLinks: acc.crossDomainLinks.slice(-5),
    actionDistribution,
    contributingLensCount: acc.contributingLenses.size,
    topicThreadLength: acc.topicThread.length,
  };
}

/**
 * Get the full topic thread for context assembly.
 * Used by the chat.respond macro to build rich context prompts.
 */
export function getTopicThread(sessionId) {
  const acc = _sessions.get(sessionId);
  if (!acc) return [];
  return acc.topicThread;
}

/**
 * Get cross-domain connection signals for the resonance system.
 * Called after session completion to feed the meta-derivation engine.
 */
export function getCrossDomainSignals(sessionId) {
  const acc = _sessions.get(sessionId);
  if (!acc) return [];
  return acc.crossDomainLinks;
}

/**
 * Get all contributing lenses for this session.
 * Used for DTU tagging and attribution.
 */
export function getContributingLenses(sessionId) {
  const acc = _sessions.get(sessionId);
  if (!acc) return [];
  return Array.from(acc.contributingLenses);
}

// ── Session Lifecycle ────────────────────────────────────────────────────

/**
 * Complete a session and extract signals for the resonance system.
 * Call at session end to emit cross-domain connection data.
 *
 * @param {string} sessionId
 * @returns {{ crossDomainLinks, contributingLenses, turnCount }}
 */
export function completeSession(sessionId) {
  const acc = _sessions.get(sessionId);
  if (!acc) return { crossDomainLinks: [], contributingLenses: [], turnCount: 0 };

  const result = {
    crossDomainLinks: acc.crossDomainLinks,
    contributingLenses: Array.from(acc.contributingLenses),
    turnCount: acc.turnCount,
    domainSignalCount: acc.domainSignals.size,
  };

  // Don't delete — keep for potential reconnection
  // But mark as completed
  acc.completedAt = Date.now();

  return result;
}

/**
 * Clean up expired sessions.
 * Call periodically (e.g., from heartbeat).
 */
export function cleanupExpiredSessions() {
  const now = Date.now();
  let cleaned = 0;
  for (const [id, acc] of _sessions) {
    if (now - acc.lastUpdatedAt > SESSION_TTL_MS) {
      _sessions.delete(id);
      cleaned++;
    }
  }
  return { cleaned, remaining: _sessions.size };
}

// ── Metrics ──────────────────────────────────────────────────────────────

export function getAccumulatorMetrics() {
  let totalTurns = 0;
  let totalSignals = 0;
  let totalCrossDomain = 0;

  for (const acc of _sessions.values()) {
    totalTurns += acc.turnCount;
    totalSignals += acc.domainSignals.size;
    totalCrossDomain += acc.crossDomainLinks.length;
  }

  return {
    ok: true,
    activeSessions: _sessions.size,
    totalTurns,
    totalSignals,
    totalCrossDomainLinks: totalCrossDomain,
    avgTurnsPerSession: _sessions.size > 0 ? (totalTurns / _sessions.size).toFixed(1) : 0,
  };
}
