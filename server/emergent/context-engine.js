/**
 * Concord Context Engine
 *
 * Not a new module. This is the activation system, shadow DTU layer, and
 * linguistic engine wired together with session-level persistence.
 *
 * Three existing components, one new connection pattern:
 *   - activation.js provides accumulate, spread, decay, working set
 *   - edges.js provides typed edges with weights for spreading
 *   - growth.js distillSession() provides post-session learning
 *
 * This module adds:
 *   - Query-to-activation pipeline (lens input → activate → spread → working set)
 *   - Co-activation edge extraction (shadow learning at session end)
 *   - Per-user profile store (cross-session context seeding)
 *   - Lens context profiles (per-lens behavior tuning)
 *   - Pinned DTU support in working set queries
 *   - Context observability data
 */

import {
  activate,
  spreadActivation,
  getWorkingSet,
  getGlobalActivation,
  decaySession,
  getActivationSystem,
} from "./activation.js";

import { createEdge, queryEdges } from "./edges.js";

import { getEmergentState } from "./store.js";

import { SCOPES, getDtuScope } from "./scope-separation.js";

import { DISTRICTS } from "./districts.js";

// ── Lens Context Profiles ──────────────────────────────────────────────────

/**
 * Per-lens behavior tuning. Each profile overrides defaults in the
 * activation/working-set pipeline so different lenses get the context
 * shape they need.
 */
/**
 * Canonical tier weights — HYPER and MEGA DTUs are preferentially cited.
 * These weights are applied as score multipliers during context assembly.
 */
export const TIER_WEIGHTS = Object.freeze({
  hyper: 2.0,
  mega: 1.5,
  regular: 1.0,
  shadow: 0.6,
  archive: 0.3,
});

export const CONTEXT_PROFILES = Object.freeze({
  research: {
    tierMultiplier: { ...TIER_WEIGHTS },
    decayRate: 0.001,
    maxWorkingSet: 50,
    spreadDecay: 0.6,
    edgeWeightOverrides: {},
    activationBonuses: {},
  },
  chat: {
    tierMultiplier: { ...TIER_WEIGHTS },
    decayRate: 0.005,        // faster decay — conversational context is short-term
    maxWorkingSet: 30,
    spreadDecay: 0.6,
    edgeWeightOverrides: {},
    activationBonuses: {},
  },
  thread: {
    tierMultiplier: { ...TIER_WEIGHTS },
    decayRate: 0.001,
    maxWorkingSet: 50,
    spreadDecay: 0.6,
    edgeWeightOverrides: { contradicts: 0.8 },   // threads are for debate
    activationBonuses: {},
  },
  explorer: {
    tierMultiplier: { ...TIER_WEIGHTS },
    decayRate: 0.001,
    maxWorkingSet: 100,
    spreadDecay: 0.4,        // lower decay → activation spreads further
    edgeWeightOverrides: {},
    activationBonuses: {},
  },
  marketplace: {
    tierMultiplier: { ...TIER_WEIGHTS, shadow: 0.5 },
    decayRate: 0.001,
    maxWorkingSet: 50,
    spreadDecay: 0.6,
    edgeWeightOverrides: {},
    activationBonuses: { hasMarketplace: 0.3 },   // economic context bonus
  },
});

const DEFAULT_PROFILE = CONTEXT_PROFILES.research;

// ── Context Engine State ────────────────────────────────────────────────────

function getContextEngine(STATE) {
  const es = getEmergentState(STATE);
  if (!es._contextEngine) {
    es._contextEngine = {
      // Per-user profile store: userId → { topDTUs, lastSession, sessionCount }
      userProfiles: new Map(),

      // Per-session co-activation tracker: sessionId → Map<dtuId, Set<queryIndex>>
      coActivationTracker: new Map(),

      // Session query counter: sessionId → number
      sessionQueryCounts: new Map(),

      // sessionId → userId (set when processQuery runs with userId)
      sessionOwners: new Map(),

      // sessionId → Set<dtuId> of pins observed for that session
      sessionPins: new Map(),

      metrics: {
        queriesProcessed: 0,
        coActivationEdgesProposed: 0,
        userProfilesUpdated: 0,
        contextPanelQueries: 0,
        profileSeeds: 0,
      },
    };
  }
  // Backfill maps on older in-memory engines (hot reload / long-lived STATE).
  if (!(es._contextEngine.sessionOwners instanceof Map)) {
    es._contextEngine.sessionOwners = new Map();
  }
  if (!(es._contextEngine.sessionPins instanceof Map)) {
    es._contextEngine.sessionPins = new Map();
  }
  return es._contextEngine;
}

// ── Query-to-Activation Pipeline ────────────────────────────────────────────

/**
 * The main context pipeline. Every user query flows through this:
 *
 *   Step 1: Extract DTU references from query (retrieval match)
 *   Step 2: Activate each matched DTU, score weighted by relevance
 *   Step 3: Spread activation through edges
 *   Step 4: Get working set (top-K activated DTUs)
 *   Step 5: Return context for response shaping
 *
 * Session activation accumulates WITHOUT clearing — previous queries stay warm.
 *
 * @param {Object} STATE - Global server state
 * @param {string} sessionId - Current session
 * @param {Object} opts
 * @param {string} opts.query - The user query text
 * @param {string} [opts.lens] - Active lens type (research|chat|thread|explorer|marketplace)
 * @param {string} [opts.userId] - User ID for profile seeding
 * @param {string[]} [opts.pinnedIds] - DTU IDs pinned by the current artifact/conversation
 * @param {Object[]} [opts.retrievalHits] - Pre-computed retrieval results [{dtuId, score}]
 * @returns {{ ok, workingSet, profile, activationSources, stats }}
 */
export function processQuery(STATE, sessionId, opts = {}) {
  const ce = getContextEngine(STATE);
  const profile = getProfile(opts.lens);
  const pinnedIds = opts.pinnedIds || [];

  // Track query index for co-activation analysis
  const queryIndex = (ce.sessionQueryCounts.get(sessionId) || 0) + 1;
  ce.sessionQueryCounts.set(sessionId, queryIndex);

  // Ownership + pin ledger for the debug inspector (auth-scoped reads).
  if (opts.userId) {
    ce.sessionOwners.set(sessionId, opts.userId);
  }
  if (pinnedIds.length) {
    const pinSet = ce.sessionPins.get(sessionId) || new Set();
    for (const id of pinnedIds) {
      if (id) pinSet.add(String(id));
    }
    ce.sessionPins.set(sessionId, pinSet);
  }

  // ── Step 0: Seed from user profile (first query in session) ──
  if (queryIndex === 1 && opts.userId) {
    seedFromUserProfile(STATE, sessionId, opts.userId);
  }

  // ── Step 1: Extract DTU references ──
  const hits = opts.retrievalHits || matchDTUs(STATE, opts.query || "");
  const directActivations = [];

  // ── Step 2: Activate each matched DTU ──
  for (const hit of hits) {
    const score = applyTierMultiplier(STATE, hit.dtuId, hit.score, profile);
    const bonusScore = applyActivationBonuses(STATE, hit.dtuId, score, profile);

    const result = activate(STATE, sessionId, hit.dtuId, bonusScore, "query_match");
    if (result.ok) {
      directActivations.push({
        dtuId: hit.dtuId,
        score: bonusScore,
        source: "direct",
      });
    }

    // Track for co-activation
    trackCoActivation(ce, sessionId, hit.dtuId, queryIndex);
  }

  // ── Step 3: Spread activation through edges ──
  const spreadResults = [];
  for (const da of directActivations) {
    const spreadResult = spreadActivationWithProfile(
      STATE, sessionId, da.dtuId, profile
    );
    if (spreadResult.ok && spreadResult.spread) {
      for (const s of spreadResult.spread) {
        spreadResults.push({
          dtuId: s.targetId,
          score: s.spreadScore,
          source: `spread_via_${s.viaEdge}`,
          fromDtu: da.dtuId,
        });
        trackCoActivation(ce, sessionId, s.targetId, queryIndex);
      }
    }
  }

  // ── Step 4: Get working set with pinned support ──
  const workingSet = getContextWorkingSet(
    STATE, sessionId, profile, pinnedIds
  );

  // ── Step 4b: Global fallback (when local is insufficient) ──
  let globalFallbackUsed = false;
  let globalShadowCount = 0;

  if (!isLocalSetSufficient(workingSet.items) && opts.query) {
    const queryHash = simpleHash(opts.query);
    const globalResults = queryGlobalFallback(STATE, opts.query);
    const shadows = globalResults
      .filter(r => r.score > 0.2)
      .map(r => createGlobalCitationShadow(STATE, r.dtu, queryHash));

    // Activate shadows in current session so they enter working set
    for (const shadow of shadows) {
      activate(STATE, sessionId, shadow.id, shadow.machine?.citationCount ? 0.5 : 0.4, "global_fallback");
    }

    if (shadows.length > 0) {
      globalFallbackUsed = true;
      globalShadowCount = shadows.length;
      // Re-compute working set with global shadows now activated
      const augmentedWorkingSet = getContextWorkingSet(STATE, sessionId, profile, pinnedIds);
      workingSet.items = augmentedWorkingSet.items;
      workingSet.pinnedCount = augmentedWorkingSet.pinnedCount;
    }
  }

  ce.metrics.queriesProcessed++;
  if (globalFallbackUsed) {
    ce.metrics.globalFallbackCount = (ce.metrics.globalFallbackCount || 0) + 1;
  }

  // ── Step 5: Return context ──
  return {
    ok: true,
    workingSet: workingSet.items,
    workingSetCount: workingSet.items.length,
    pinnedCount: workingSet.pinnedCount,
    profile: opts.lens || "research",
    globalFallbackUsed,
    globalShadowCount,
    activationSources: {
      direct: directActivations.length,
      spread: spreadResults.length,
      globalFallback: globalShadowCount,
      total: directActivations.length + spreadResults.length + globalShadowCount,
    },
    stats: {
      queryIndex,
      sessionId,
      directActivations: directActivations.slice(0, 10),
      spreadCount: spreadResults.length,
    },
  };
}

// ── Retrieval Matching ──────────────────────────────────────────────────────

/**
 * Simple token-overlap retrieval for DTU matching.
 * Returns top 20 DTUs matching the query by tag/title overlap.
 *
 * When the full pipeline is used, opts.retrievalHits bypasses this
 * and uses the chat.respond retrieval scoring instead.
 */
function matchDTUs(STATE, query) {
  if (!query || !STATE.dtus?.size) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return [];

  const scored = [];

  for (const [id, dtu] of STATE.dtus) {
    const dtuTokens = new Set([
      ...tokenize(dtu.title || ""),
      ...(dtu.tags || []).map(t => t.toLowerCase()),
    ]);

    // Jaccard-ish overlap
    let overlap = 0;
    for (const qt of queryTokens) {
      if (dtuTokens.has(qt)) overlap++;
    }

    if (overlap === 0) continue;

    const score = overlap / (queryTokens.size + dtuTokens.size - overlap);
    if (score > 0.05) {
      scored.push({ dtuId: id, score: Math.min(score, 1.0) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 20);
}

function tokenize(text) {
  const stops = new Set(["the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to", "for", "of", "and", "or", "but", "not", "with", "this", "that", "it", "be", "as", "by", "from", "has", "have", "had", "do", "does", "did", "will", "would", "can", "could", "should", "may", "might"]);
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s_-]/g, " ")
      .split(/\s+/)
      .filter(t => t.length > 2 && !stops.has(t))
  );
}

// ── Tier Multiplier Application ────────────────────────────────────────────

function applyTierMultiplier(STATE, dtuId, score, profile) {
  // Check both canonical and shadow stores
  const dtu = STATE.dtus?.get(dtuId) || STATE.shadowDtus?.get(dtuId);
  if (!dtu || !profile.tierMultiplier) return score;

  const tier = (dtu.tier || dtu.meta?.tier || "regular").toLowerCase();
  const multiplier = profile.tierMultiplier[tier] || 1.0;
  return Math.min(1.0, score * multiplier);
}

function applyActivationBonuses(STATE, dtuId, score, profile) {
  if (!profile.activationBonuses) return score;
  const dtu = STATE.dtus?.get(dtuId);
  if (!dtu) return score;

  let bonus = 0;

  // Marketplace bonus: DTUs with marketplace metadata
  if (profile.activationBonuses.hasMarketplace && dtu.scope === "marketplace") {
    bonus += profile.activationBonuses.hasMarketplace;
  }

  return Math.min(1.0, score + bonus);
}

// ── Profile-Aware Spread ────────────────────────────────────────────────────

/**
 * Spread activation using the lens profile's edge weight overrides
 * and spread decay settings.
 */
function spreadActivationWithProfile(STATE, sessionId, sourceDtuId, profile) {
  const sys = getActivationSystem(STATE);
  const es = getEmergentState(STATE);
  const edgeStore = es._edges;

  if (!edgeStore) {
    return { ok: true, spread: [], message: "no_edge_store" };
  }

  if (!sys.sessions.has(sessionId)) {
    sys.sessions.set(sessionId, new Map());
  }
  const sessionMap = sys.sessions.get(sessionId);

  const sourceEntry = sessionMap.get(sourceDtuId);
  if (!sourceEntry) {
    return { ok: false, error: "source_not_activated" };
  }

  const spreadDecay = profile.spreadDecay || 0.6;
  const edgeWeightOverrides = profile.edgeWeightOverrides || {};

  // Default edge type weights from activation.js
  const defaultWeights = {
    supports: 1.0, derives: 0.9, causes: 0.8, enables: 0.7,
    references: 0.5, similar: 0.4, parentOf: 0.3, requires: 0.6,
    contradicts: 0.2,
  };

  const spread = [];
  const visited = new Set([sourceDtuId]);
  const queue = [{ nodeId: sourceDtuId, activation: sourceEntry.score, hop: 0 }];
  const maxHops = 2;

  while (queue.length > 0) {
    const { nodeId, activation, hop } = queue.shift();
    if (hop >= maxHops) continue;

    const outEdgeIds = edgeStore.bySource?.get(nodeId);
    if (!outEdgeIds) continue;

    for (const eid of outEdgeIds) {
      const edge = edgeStore.edges.get(eid);
      if (!edge || visited.has(edge.targetId)) continue;

      visited.add(edge.targetId);

      // Use profile override for this edge type, or default
      const typeWeight = edgeWeightOverrides[edge.edgeType]
        ?? defaultWeights[edge.edgeType]
        ?? 0.3;

      const spreadScore = activation * spreadDecay * typeWeight * edge.weight;
      if (spreadScore < 0.01) continue;

      const existing = sessionMap.get(edge.targetId);
      const newScore = existing
        ? Math.min(1.0, existing.score + spreadScore)
        : Math.min(Math.max(0, spreadScore), 1);

      sessionMap.set(edge.targetId, {
        dtuId: edge.targetId,
        score: newScore,
        lastActivated: Date.now(),
        activationCount: (existing?.activationCount || 0) + 1,
        reasons: [...(existing?.reasons || []).slice(-3), `context_spread:${sourceDtuId}:${edge.edgeType}`],
      });

      spread.push({
        targetId: edge.targetId,
        spreadScore: newScore,
        viaEdge: edge.edgeType,
        hop: hop + 1,
      });

      queue.push({ nodeId: edge.targetId, activation: spreadScore, hop: hop + 1 });
    }
  }

  return { ok: true, spread, count: spread.length };
}

// ── Working Set with Pinned Support ─────────────────────────────────────────

/**
 * Get working set with pinned DTU support and profile-aware decay.
 *
 * Pinned DTUs are always included regardless of score.
 * Remaining slots fill by activation score descending.
 */
function getContextWorkingSet(STATE, sessionId, profile, pinnedIds = []) {
  const sys = getActivationSystem(STATE);
  const sessionMap = sys.sessions.get(sessionId);

  if (!sessionMap) {
    return { items: [], pinnedCount: 0 };
  }

  const maxK = profile.maxWorkingSet || 50;
  const decayRate = profile.decayRate || 0.001;

  // Apply time decay with profile-specific rate
  const now = Date.now();
  for (const [dtuId, entry] of sessionMap) {
    const elapsed = (now - entry.lastActivated) / 1000;
    const decay = Math.exp(-decayRate * elapsed);
    entry.score *= decay;
    if (entry.score < 0.01) {
      sessionMap.delete(dtuId);
    }
  }

  // Separate pinned and unpinned
  const pinnedSet = new Set(pinnedIds);
  const pinned = [];
  const candidates = [];

  for (const entry of sessionMap.values()) {
    if (pinnedSet.has(entry.dtuId)) {
      pinned.push(entry);
    } else {
      candidates.push(entry);
    }
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Fill remaining slots after pinned
  const remaining = Math.max(0, maxK - pinned.length);
  const items = [...pinned, ...candidates.slice(0, remaining)];

  return { items, pinnedCount: pinned.length };
}

// ── Pinned Working Set (public API) ─────────────────────────────────────────

/**
 * Public wrapper for getWorkingSet with pinned support.
 * Augments the existing activation.js getWorkingSet() with:
 *   - pinnedIds array (always included regardless of score)
 *   - Profile-aware decay rate
 */
export function getWorkingSetWithPins(STATE, sessionId, opts = {}) {
  const profile = getProfile(opts.lens);
  const pinnedIds = opts.pinnedIds || [];
  const result = getContextWorkingSet(STATE, sessionId, profile, pinnedIds);
  return {
    ok: true,
    workingSet: result.items,
    count: result.items.length,
    pinnedCount: result.pinnedCount,
    lens: opts.lens || "research",
  };
}

// ── Co-Activation Tracking ──────────────────────────────────────────────────

function trackCoActivation(ce, sessionId, dtuId, queryIndex) {
  if (!ce.coActivationTracker.has(sessionId)) {
    ce.coActivationTracker.set(sessionId, new Map());
  }
  const tracker = ce.coActivationTracker.get(sessionId);
  if (!tracker.has(dtuId)) {
    tracker.set(dtuId, new Set());
  }
  tracker.get(dtuId).add(queryIndex);
}

/**
 * Extract co-activation edges from session.
 *
 * Called at session distillation time. Finds DTU pairs that appeared
 * together in the working set for 3+ queries in the same session.
 * Proposes shadow edges with type "similar" and weight proportional
 * to co-activation frequency.
 *
 * @param {Object} STATE - Global server state
 * @param {string} sessionId - Completed session
 * @returns {{ ok, edgesProposed, pairs }}
 */
export function extractCoActivationEdges(STATE, sessionId) {
  const ce = getContextEngine(STATE);
  const tracker = ce.coActivationTracker.get(sessionId);

  if (!tracker || tracker.size < 2) {
    return { ok: true, edgesProposed: 0, pairs: [] };
  }

  const totalQueries = ce.sessionQueryCounts.get(sessionId) || 0;
  if (totalQueries < 3) {
    return { ok: true, edgesProposed: 0, pairs: [], reason: "insufficient_queries" };
  }

  // Find co-activated pairs (both appeared in 3+ queries)
  const dtuIds = Array.from(tracker.keys());
  const pairs = [];
  const edgesProposed = [];

  // Limit comparison count to avoid O(n²) explosion
  const maxCompare = Math.min(dtuIds.length, 100);

  for (let i = 0; i < maxCompare; i++) {
    const idA = dtuIds[i];
    const queriesA = tracker.get(idA);

    for (let j = i + 1; j < maxCompare; j++) {
      const idB = dtuIds[j];
      const queriesB = tracker.get(idB);

      // Count queries where both were active
      let coCount = 0;
      for (const q of queriesA) {
        if (queriesB.has(q)) coCount++;
      }

      if (coCount < 3) continue;

      // Weight proportional to co-activation: start at 0.2, +0.05 per occurrence
      const weight = Math.min(0.2 + (coCount - 3) * 0.05, 0.8);

      pairs.push({ dtuA: idA, dtuB: idB, coCount, weight });

      // Only propose edge if weight crosses threshold
      if (weight >= 0.2) {
        // Check if edge already exists
        const existing = queryEdges(STATE, {
          sourceId: idA,
          targetId: idB,
          edgeType: "similar",
          limit: 1,
        });

        if (!existing.ok || existing.edges.length === 0) {
          const edgeResult = createEdge(STATE, {
            sourceId: idA,
            targetId: idB,
            edgeType: "similar",
            weight,
            confidence: Math.min(coCount / totalQueries, 1.0),
            createdBy: { source: "context_engine", id: `session:${sessionId}` },
            label: `co-activated ${coCount}x in session ${sessionId}`,
          });

          if (edgeResult.ok) {
            edgesProposed.push(edgeResult.edge);
          }
        }
      }
    }
  }

  ce.metrics.coActivationEdgesProposed += edgesProposed.length;

  // Clean up tracker for this session
  ce.coActivationTracker.delete(sessionId);
  ce.sessionQueryCounts.delete(sessionId);

  return {
    ok: true,
    edgesProposed: edgesProposed.length,
    pairs: pairs.slice(0, 50),
    totalDtusTracked: dtuIds.length,
    totalQueries,
  };
}

// ── Per-User Profile Store ──────────────────────────────────────────────────

/**
 * Update user profile with session activation data.
 * Called at session distillation time.
 *
 * Tracks top 20 DTUs by activation frequency per user.
 * When a returning user starts a session, pre-activates
 * their top DTUs at a low baseline (0.1).
 */
export function updateUserProfile(STATE, userId, sessionId) {
  if (!userId) return { ok: false, error: "userId_required" };

  const ce = getContextEngine(STATE);
  const sys = getActivationSystem(STATE);
  const sessionMap = sys.sessions.get(sessionId);

  if (!sessionMap || sessionMap.size === 0) {
    return { ok: true, updated: false, reason: "empty_session" };
  }

  // Get or create user profile
  const existing = ce.userProfiles.get(userId) || {
    topDTUs: [],
    lastSession: null,
    sessionCount: 0,
  };

  // Merge session activations into profile
  const freqMap = new Map();
  for (const entry of existing.topDTUs) {
    freqMap.set(entry.dtuId, entry.frequency);
  }

  for (const [dtuId, entry] of sessionMap) {
    const currentFreq = freqMap.get(dtuId) || 0;
    // Weight by activation score and count
    freqMap.set(dtuId, currentFreq + entry.score * entry.activationCount);
  }

  // Keep top 20
  const sorted = Array.from(freqMap.entries())
    .map(([dtuId, frequency]) => ({ dtuId, frequency }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, 20);

  const profile = {
    topDTUs: sorted,
    lastSession: new Date().toISOString(),
    sessionCount: existing.sessionCount + 1,
  };

  ce.userProfiles.set(userId, profile);
  ce.metrics.userProfilesUpdated++;

  return { ok: true, updated: true, topCount: sorted.length, sessionCount: profile.sessionCount };
}

/**
 * Seed a new session's activation from the user's profile.
 * Pre-activates their top 20 DTUs at baseline 0.1.
 */
function seedFromUserProfile(STATE, sessionId, userId) {
  const ce = getContextEngine(STATE);
  const profile = ce.userProfiles.get(userId);

  if (!profile || !profile.topDTUs.length) return;

  for (const entry of profile.topDTUs) {
    // Verify DTU still exists
    if (!STATE.dtus?.has(entry.dtuId)) continue;

    activate(STATE, sessionId, entry.dtuId, 0.1, "user_profile_seed");
  }

  ce.metrics.profileSeeds++;
}

/**
 * Get a user's profile data.
 */
export function getUserProfile(STATE, userId) {
  const ce = getContextEngine(STATE);
  const profile = ce.userProfiles.get(userId);
  if (!profile) return { ok: false, error: "no_profile" };
  return { ok: true, profile };
}

// ── Autogen Integration ─────────────────────────────────────────────────────

/**
 * Run autogen target selection through the activation system.
 *
 * When selectIntent() picks target DTUs, activate them in a system session.
 * Spreading activation determines the full retrieval context.
 * This means the autogen pipeline inherits the same structural context
 * that user sessions get.
 *
 * @param {Object} STATE - Global server state
 * @param {Object} intent - From selectIntent()
 * @param {Object} [opts]
 * @returns {{ ok, activatedCount, workingSet }}
 */
export function activateForAutogen(STATE, intent, opts = {}) {
  const sessionId = `autogen_${Date.now().toString(36)}`;

  // Activate DTUs identified by intent signal
  const targetIds = intent.signal?.sampleIds || [];
  const topIds = intent.signal?.top?.map(t => t.dtuId || t.id) || [];
  const allTargets = [...new Set([...targetIds, ...topIds])];

  let activatedCount = 0;

  for (const dtuId of allTargets) {
    if (!STATE.dtus?.has(dtuId)) continue;
    const result = activate(STATE, sessionId, dtuId, 0.8, `autogen_${intent.intent}`);
    if (result.ok) {
      activatedCount++;
      // Spread from each activated target
      spreadActivation(STATE, sessionId, dtuId, 2);
    }
  }

  // Also activate globally warm DTUs — user interest feeds autogen
  const globalWarm = getGlobalActivation(STATE, 10);
  if (globalWarm.ok) {
    for (const item of globalWarm.items) {
      if (!STATE.dtus?.has(item.dtuId)) continue;
      // Lower score — these are background warmth, not direct targets
      activate(STATE, sessionId, item.dtuId, 0.3, "global_warmth");
    }
  }

  // Get the resulting working set
  const ws = getWorkingSet(STATE, sessionId, opts.maxWorkingSet || 100);

  return {
    ok: true,
    sessionId,
    activatedCount,
    globalWarmCount: globalWarm.ok ? globalWarm.items.length : 0,
    workingSet: ws.workingSet || [],
    workingSetCount: (ws.workingSet || []).length,
  };
}

// ── Context Observability ───────────────────────────────────────────────────

/**
 * Get detailed context panel data for a session.
 * Shows what's in the working set and why.
 *
 * Each lens can show this panel to explain why certain DTUs appear
 * in context — legibility applied to the context engine.
 */
export function getContextPanel(STATE, sessionId, opts = {}) {
  const ce = getContextEngine(STATE);
  ce.metrics.contextPanelQueries++;

  const profile = getProfile(opts.lens);
  const sys = getActivationSystem(STATE);
  const sessionMap = sys.sessions.get(sessionId);

  if (!sessionMap) {
    return { ok: true, workingSet: [], count: 0, empty: true };
  }

  // Build detailed entry list with source explanation
  const entries = [];
  for (const [dtuId, entry] of sessionMap) {
    const dtu = STATE.dtus?.get(dtuId);

    // Classify activation source
    const sources = classifyActivationSources(entry.reasons);

    entries.push({
      dtuId,
      title: dtu?.title || "(unknown)",
      tier: dtu?.tier || dtu?.meta?.tier || "regular",
      score: Math.round(entry.score * 1000) / 1000,
      activationCount: entry.activationCount,
      lastActivated: entry.lastActivated,
      sources,
    });
  }

  // Sort by score descending
  entries.sort((a, b) => b.score - a.score);

  // Global warmth info
  const globalWarm = getGlobalActivation(STATE, 10);

  return {
    ok: true,
    sessionId,
    lens: opts.lens || "research",
    profile: {
      decayRate: profile.decayRate,
      maxWorkingSet: profile.maxWorkingSet,
      spreadDecay: profile.spreadDecay,
      tierMultiplier: profile.tierMultiplier,
    },
    workingSet: entries.slice(0, profile.maxWorkingSet),
    totalActivated: entries.length,
    queryCount: ce.sessionQueryCounts.get(sessionId) || 0,
    globalWarm: globalWarm.ok ? globalWarm.items.slice(0, 5) : [],
  };
}

/**
 * Classify why a DTU was activated based on reason strings.
 */
function classifyActivationSources(reasons) {
  const sources = {
    queryMatch: false,
    edgeSpread: false,
    globalWarmth: false,
    userProfileSeed: false,
    autogen: false,
  };

  for (const r of (reasons || [])) {
    if (r === "query_match" || r === "direct") sources.queryMatch = true;
    else if (r.startsWith("spread_from:") || r.startsWith("context_spread:")) sources.edgeSpread = true;
    else if (r === "global_warmth") sources.globalWarmth = true;
    else if (r === "user_profile_seed") sources.userProfileSeed = true;
    else if (r.startsWith("autogen_")) sources.autogen = true;
  }

  return sources;
}

// ── Profile Helpers ─────────────────────────────────────────────────────────

function getProfile(lens) {
  if (!lens) return DEFAULT_PROFILE;
  return CONTEXT_PROFILES[lens] || DEFAULT_PROFILE;
}

/**
 * Get available context profiles.
 */
export function getContextProfiles() {
  return { ok: true, profiles: { ...CONTEXT_PROFILES } };
}

// ── Session Lifecycle ───────────────────────────────────────────────────────

/**
 * Apply context decay to a session. Uses the lens profile's decay rate.
 */
export function decaySessionContext(STATE, sessionId, opts = {}) {
  const profile = getProfile(opts.lens);
  // Convert time-based decay rate to a factor for explicit decay
  const factor = opts.factor || Math.exp(-profile.decayRate * (opts.elapsedSeconds || 60));
  return decaySession(STATE, sessionId, factor);
}

/**
 * Complete a session's context lifecycle:
 *   1. Extract co-activation edges
 *   2. Update user profile
 *   3. Clean up tracker state
 */
export function completeSessionContext(STATE, sessionId, opts = {}) {
  const results = {
    coActivation: extractCoActivationEdges(STATE, sessionId),
    userProfile: opts.userId
      ? updateUserProfile(STATE, opts.userId, sessionId)
      : { ok: true, skipped: true, reason: "no_userId" },
  };

  return {
    ok: true,
    sessionId,
    edgesProposed: results.coActivation.edgesProposed || 0,
    profileUpdated: results.userProfile.updated || false,
  };
}

// ── Global Fallback ──────────────────────────────────────────────────────────

const MIN_LOCAL_SET = 3;
const MIN_RELEVANCE_SCORE = 0.4;
const MAX_GLOBAL_FALLBACK = 20;

/**
 * Check whether the local working set is sufficient for a quality response.
 * If not, we'll query the global lattice for fallback DTUs.
 */
export function isLocalSetSufficient(localSet) {
  if (!localSet || localSet.length < MIN_LOCAL_SET) return false;
  const topScore = Math.max(...localSet.map(d => d.score || 0), 0);
  if (topScore < MIN_RELEVANCE_SCORE) return false;
  return true;
}

/**
 * Query global-scoped DTUs for fallback when local is insufficient.
 * On the same server, this is a direct read from global-scoped DTUs.
 * On a remote local instance, this would become an API call.
 */
export function queryGlobalFallback(STATE, query, limit = MAX_GLOBAL_FALLBACK) {
  if (!query || !STATE.dtus?.size) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.size === 0) return [];

  const scored = [];
  for (const [id, dtu] of STATE.dtus) {
    if (getDtuScope(dtu) !== SCOPES.GLOBAL) continue;

    const dtuTokens = new Set([
      ...tokenize(dtu.title || ""),
      ...(dtu.tags || []).map(t => t.toLowerCase()),
      ...tokenize((dtu.core?.claims || []).join(" ")),
    ]);

    let overlap = 0;
    for (const qt of queryTokens) {
      if (dtuTokens.has(qt)) overlap++;
    }
    if (overlap === 0) continue;

    const score = overlap / (queryTokens.size + dtuTokens.size - overlap);
    if (score > 0.1) {
      scored.push({ dtu, score: Math.min(score, 1.0) });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/**
 * Create a shadow citation in local scope pointing back to a global DTU.
 * The shadow is a lightweight local proxy for activation and retrieval.
 */
export function createGlobalCitationShadow(STATE, globalDtu, queryHash) {
  if (!STATE.shadowDtus) STATE.shadowDtus = new Map();

  const shadowId = `gshadow_${globalDtu.id}`.slice(0, 64);

  // Don't create duplicate shadows — bump citation count instead
  if (STATE.shadowDtus.has(shadowId)) {
    const existing = STATE.shadowDtus.get(shadowId);
    existing.machine = existing.machine || {};
    existing.machine.citationCount = (existing.machine.citationCount || 0) + 1;
    existing.machine.lastCitedAt = new Date().toISOString();
    return existing;
  }

  const shadow = {
    id: shadowId,
    title: globalDtu.title,
    tier: "shadow",
    tags: [
      ...(globalDtu.tags || []).filter(t => t !== "shadow"),
      "shadow", "global-cited", `source-global:${globalDtu.id}`,
    ],
    scope: "local",
    source: "global-fallback",
    machine: {
      kind: "global_citation",
      sourceId: globalDtu.id,
      sourceScope: "global",
      citedAt: new Date().toISOString(),
      citationCount: 1,
      queryHash,
    },
    core: {
      invariants: globalDtu.core?.invariants || [],
      claims: globalDtu.core?.claims || [],
      definitions: (globalDtu.core?.definitions || []).slice(0, 2),
    },
    meta: { hidden: true, globalCitation: true },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  STATE.shadowDtus.set(shadowId, shadow);
  return shadow;
}

/**
 * Simple hash for query dedup (not crypto — just a fingerprint).
 */
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 12);
}

// ── District Bias ─────────────────────────────────────────────────────────────

/**
 * Apply district-specific bias to a working set.
 * The emergent's current district shapes WHAT they see — a context lens.
 *
 * Each district defines workingSetBias keys. The bias helpers check each DTU
 * against those keys and multiply the score accordingly.
 *
 * @param {Object} STATE - Global server state
 * @param {Array} items - Working set items [{ dtuId, score, ... }]
 * @param {string} districtId - Current district of the emergent
 * @returns {Array} Reweighted items sorted by new score
 */
export function applyDistrictBias(STATE, items, districtId) {
  const district = DISTRICTS[districtId];
  if (!district || !district.workingSetBias || !items?.length) return items;

  const bias = district.workingSetBias;

  return items.map(item => {
    const dtu = STATE.dtus?.get(item.dtuId);
    if (!dtu) return item;

    let multiplier = 1.0;

    // Recency bias
    if (bias.recency && dtu.updatedAt) {
      const ageMs = Date.now() - new Date(dtu.updatedAt).getTime();
      const ageHours = ageMs / 3_600_000;
      if (ageHours < 24) multiplier *= bias.recency;
    }

    // Cross-domain: DTUs with tags from multiple sectors
    if (bias.crossDomain && dtu.tags?.length > 3) {
      multiplier *= bias.crossDomain;
    }

    // External source: DTUs ingested from external feeds
    if (bias.externalSource && (dtu.source === "ingest" || dtu.source === "external" || dtu.tags?.includes("ingested"))) {
      multiplier *= bias.externalSource;
    }

    // Shadow weight: shadow-tier DTUs
    if (bias.shadow && (dtu.tier === "shadow" || dtu.meta?.tier === "shadow")) {
      multiplier *= bias.shadow;
    }

    // Seed proximity: DTUs close to seed/axiom content
    if (bias.seedProximity && (dtu.tags?.includes("seed") || dtu.tags?.includes("axiom") || dtu.tags?.includes("first-principle"))) {
      multiplier *= bias.seedProximity;
    }

    // Derivation depth: DTUs with deep derivation chains
    if (bias.derivationDepth && dtu.meta?.derivationDepth > 2) {
      multiplier *= bias.derivationDepth;
    }

    // Meta-invariant: DTUs tagged as meta-invariants
    if (bias.metaInvariant && (dtu.tags?.includes("meta-invariant") || dtu.tags?.includes("invariant"))) {
      multiplier *= bias.metaInvariant;
    }

    // Unpromoted shadows
    if (bias.unpromoted && dtu.tier === "shadow" && !dtu.meta?.promoted) {
      multiplier *= bias.unpromoted;
    }

    // Low citation: DTUs with few citations (garden favors the neglected)
    if (bias.lowCitation && (dtu.machine?.citationCount || 0) < 3) {
      multiplier *= bias.lowCitation;
    }

    // High citation penalty (garden deprioritizes well-known DTUs)
    if (bias.highCitation && (dtu.machine?.citationCount || 0) > 10) {
      multiplier *= bias.highCitation;
    }

    // Pending governance: DTUs awaiting governance review
    if (bias.pendingGovernance && dtu.meta?.pendingGovernance) {
      multiplier *= bias.pendingGovernance;
    }

    // Promotion candidate
    if (bias.promotionCandidate && dtu.meta?.promotionCandidate) {
      multiplier *= bias.promotionCandidate;
    }

    // Contradiction flagged
    if (bias.contradictionFlag && dtu.meta?.contradictionFlagged) {
      multiplier *= bias.contradictionFlag;
    }

    // Capability gap (forge)
    if (bias.capabilityGap && dtu.tags?.includes("capability-gap")) {
      multiplier *= bias.capabilityGap;
    }

    // Plugin related
    if (bias.pluginRelated && (dtu.tags?.includes("plugin") || dtu.tags?.includes("capability"))) {
      multiplier *= bias.pluginRelated;
    }

    // Emergence related (nursery)
    if (bias.emergenceRelated && (dtu.tags?.includes("emergence") || dtu.tags?.includes("threshold"))) {
      multiplier *= bias.emergenceRelated;
    }

    // Trust dynamics
    if (bias.trustDynamics && dtu.tags?.includes("trust")) {
      multiplier *= bias.trustDynamics;
    }

    return {
      ...item,
      score: Math.min(1.0, item.score * multiplier),
      _districtBias: districtId,
    };
  }).sort((a, b) => b.score - a.score);
}

// ── Metrics ─────────────────────────────────────────────────────────────────

export function getContextEngineMetrics(STATE) {
  const ce = getContextEngine(STATE);
  return {
    ok: true,
    version: "1.0.0",
    metrics: { ...ce.metrics },
    activeSessions: ce.sessionQueryCounts.size,
    trackedSessions: ce.coActivationTracker.size,
    userProfiles: ce.userProfiles.size,
    shadowDtus: STATE.shadowDtus?.size || 0,
    profiles: Object.keys(CONTEXT_PROFILES),
  };
}

/**
 * Auth-scoped aggregate for GET /api/context/inspector (Debug Context panel).
 *
 * Derives the panel shape from the live context engine — never fabricates
 * working-set / pin / profile rows. Only the caller's sessions and profile
 * are included; other users' context is omitted.
 *
 * @param {Object} STATE
 * @param {string} userId - Authenticated caller id
 */
export function getContextInspector(STATE, userId) {
  const ce = getContextEngine(STATE);
  ce.metrics.contextPanelQueries++;

  if (!userId) {
    return { ok: false, error: "auth_required" };
  }

  const mySessions = [];
  for (const [sessionId, owner] of ce.sessionOwners) {
    if (owner === userId) mySessions.push(sessionId);
  }

  const sys = getActivationSystem(STATE);
  let totalSize = 0;
  for (const sessionId of mySessions) {
    const sessionMap = sys.sessions.get(sessionId);
    if (sessionMap) totalSize += sessionMap.size;
  }

  const pinnedDtus = [];
  for (const sessionId of mySessions) {
    const pins = ce.sessionPins.get(sessionId);
    if (!pins || pins.size === 0) continue;
    const sessionMap = sys.sessions.get(sessionId);
    for (const dtuId of pins) {
      const dtu = STATE.dtus?.get(dtuId);
      const entry = sessionMap?.get(dtuId);
      pinnedDtus.push({
        dtuId,
        title: dtu?.title || "(unknown)",
        score: entry ? Math.round(entry.score * 1000) / 1000 : 0,
        session: sessionId,
      });
    }
  }

  const coActivationPatterns = [];
  for (const sessionId of mySessions) {
    const tracker = ce.coActivationTracker.get(sessionId);
    if (!tracker) continue;
    coActivationPatterns.push({
      sessionId,
      trackedDtus: tracker.size,
      queryCount: ce.sessionQueryCounts.get(sessionId) || 0,
    });
  }

  const profile = ce.userProfiles.get(userId);
  const userProfiles = [];
  if (profile) {
    userProfiles.push({
      // Opaque self-label — never echo another account's id (none are included).
      label: "you",
      topDtuCount: profile.topDTUs.length,
      sessionCount: profile.sessionCount,
      lastSession: profile.lastSession,
      topDtus: profile.topDTUs.map((t) => ({
        dtuId: t.dtuId,
        frequency: Math.round(Number(t.frequency) * 1000) / 1000 || 0,
        title: STATE.dtus?.get(t.dtuId)?.title || "(unknown)",
      })),
    });
  }

  const engineMetrics = getContextEngineMetrics(STATE);

  return {
    ok: true,
    workingSet: { totalSize },
    pinnedDtus,
    coActivationPatterns,
    userProfiles,
    engine: {
      activeSessions: mySessions.length,
      userProfileCount: profile ? 1 : 0,
      shadowDtuCount: engineMetrics.shadowDtus,
    },
    metrics: {
      queriesProcessed: engineMetrics.metrics.queriesProcessed || 0,
      coActivationEdgesProposed: engineMetrics.metrics.coActivationEdgesProposed || 0,
      profileSeeds: engineMetrics.metrics.profileSeeds || 0,
      contextPanelQueries: engineMetrics.metrics.contextPanelQueries || 0,
    },
  };
}
