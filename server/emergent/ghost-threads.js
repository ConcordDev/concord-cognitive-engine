/**
 * Ghost Threads — Autonomous Cross-Domain Insight Generator
 *
 * The subconscious picks random DTUs from different domains, finds
 * structural connections humans wouldn't think to make, and creates
 * ghost-insight DTUs. These are shadow-tier — they surface only when
 * a user query or dream cycle validates them.
 *
 * Ghost threads run during idle periods or dream cycles.
 * Every insight traces back to source DTUs with full provenance.
 *
 * Key invariant: Ghost threads NEVER invent — they DISCOVER connections
 * between existing knowledge that already exists in the lattice.
 */

import { v4 as uuid } from "uuid";
import logger from "../logger.js";

// ── Configuration ────────────────────────────────────────────────────────────

const GHOST_THREAD_CONFIG = {
  // How many DTUs to sample per thread
  sampleSize: 6,
  // Minimum domains that must be represented
  minDomains: 2,
  // Similarity threshold for "interesting" connection (0-1)
  connectionThreshold: 0.3,
  // Maximum ghost insights to keep in memory
  maxInsights: 500,
  // Cooldown between ghost thread runs (ms)
  cooldownMs: 60_000,
  // Maximum concurrent threads
  maxConcurrent: 3,
};

// ── Connection Patterns ──────────────────────────────────────────────────────

/**
 * Structural patterns that ghost threads look for across domains.
 * Each pattern defines a type of cross-domain connection.
 */
const CONNECTION_PATTERNS = {
  analogical: {
    id: "analogical",
    name: "Analogical Transfer",
    description: "Similar structures or processes across different domains",
    weight: 1.0,
    detect: (dtuA, dtuB) => {
      const tagsA = new Set(dtuA.tags || []);
      const tagsB = new Set(dtuB.tags || []);
      // Shared structural tags suggest analogical transfer
      const structural = ["process", "system", "pattern", "model", "framework", "cycle", "hierarchy", "network"];
      const shared = structural.filter(t => tagsA.has(t) || tagsB.has(t));
      return shared.length >= 1 ? { score: shared.length * 0.3, sharedTags: shared } : null;
    },
  },

  causal: {
    id: "causal",
    name: "Causal Chain",
    description: "Output of one domain feeds input of another",
    weight: 1.2,
    detect: (dtuA, dtuB) => {
      const outputA = dtuA.machine?.outputs || dtuA.machine?.results || [];
      const inputB = dtuB.machine?.inputs || dtuB.machine?.requirements || [];
      if (!outputA.length || !inputB.length) return null;
      // Check if any output type matches an input type
      const outputTypes = new Set(Array.isArray(outputA) ? outputA.map(String) : [String(outputA)]);
      const matching = (Array.isArray(inputB) ? inputB : [inputB]).filter(i => outputTypes.has(String(i)));
      return matching.length > 0 ? { score: 0.6, chain: matching } : null;
    },
  },

  contradictory: {
    id: "contradictory",
    name: "Productive Contradiction",
    description: "Opposing claims that could generate new insight when resolved",
    weight: 1.5,
    detect: (dtuA, dtuB) => {
      const summaryA = (dtuA.human?.summary || "").toLowerCase();
      const summaryB = (dtuB.human?.summary || "").toLowerCase();
      const negators = ["not", "never", "opposite", "contrary", "whereas", "however", "but"];
      const hasNegation = negators.some(n =>
        (summaryA.includes(n) && _topicOverlap(summaryA, summaryB) > 0.2) ||
        (summaryB.includes(n) && _topicOverlap(summaryA, summaryB) > 0.2)
      );
      return hasNegation ? { score: 0.5, type: "contradiction" } : null;
    },
  },

  convergent: {
    id: "convergent",
    name: "Convergent Evolution",
    description: "Independent domains arriving at similar conclusions",
    weight: 1.3,
    detect: (dtuA, dtuB) => {
      const domainA = dtuA.tags?.find(t => t.startsWith("domain:"))?.replace("domain:", "");
      const domainB = dtuB.tags?.find(t => t.startsWith("domain:"))?.replace("domain:", "");
      if (!domainA || !domainB || domainA === domainB) return null;
      const overlap = _topicOverlap(
        dtuA.human?.summary || "",
        dtuB.human?.summary || ""
      );
      return overlap > 0.25 ? { score: overlap, domains: [domainA, domainB] } : null;
    },
  },

  metaphorical: {
    id: "metaphorical",
    name: "Metaphorical Bridge",
    description: "Concepts from one domain illuminate another through metaphor",
    weight: 0.8,
    detect: (dtuA, dtuB) => {
      const lensA = dtuA.tags?.find(t => t.startsWith("lens:"))?.replace("lens:", "");
      const lensB = dtuB.tags?.find(t => t.startsWith("lens:"))?.replace("lens:", "");
      if (!lensA || !lensB || lensA === lensB) return null;
      // Different lenses with keyword overlap suggest metaphorical bridge
      const overlap = _keywordOverlap(dtuA, dtuB);
      return overlap > 0.15 ? { score: overlap * 0.8, lenses: [lensA, lensB] } : null;
    },
  },
};

// ── State ────────────────────────────────────────────────────────────────────

/** @type {Map<string, object>} insightId → ghost insight */
const _ghostInsights = new Map();

/** @type {{ ts: number }[]} Recent thread runs for rate limiting */
const _threadHistory = [];

let _runningThreads = 0;
let _lastRunAt = 0;

const _metrics = {
  totalRuns: 0,
  totalInsights: 0,
  totalConnections: 0,
  byPattern: {},
  surfacedInsights: 0,
  discardedInsights: 0,
};

// ── Core Engine ──────────────────────────────────────────────────────────────

/**
 * Run a ghost thread — sample DTUs, find connections, produce insights.
 *
 * @param {object} STATE - The emergent state object with dtus
 * @param {object} [opts]
 * @param {number} [opts.sampleSize] - Override sample size
 * @param {string[]} [opts.forceDomains] - Force specific domains
 * @returns {{ ok: boolean, insights: object[], connections: number }}
 */
export function runGhostThread(STATE, opts = {}) {
  const now = Date.now();

  // Rate limit
  if (now - _lastRunAt < GHOST_THREAD_CONFIG.cooldownMs) {
    return { ok: false, reason: "cooldown", nextRunIn: GHOST_THREAD_CONFIG.cooldownMs - (now - _lastRunAt) };
  }
  if (_runningThreads >= GHOST_THREAD_CONFIG.maxConcurrent) {
    return { ok: false, reason: "max_concurrent" };
  }

  _runningThreads++;
  _lastRunAt = now;

  try {
    // 1. Sample random DTUs from the lattice
    const allDtus = _getDtus(STATE);
    if (allDtus.length < 4) {
      return { ok: false, reason: "insufficient_dtus", count: allDtus.length };
    }

    const sampleSize = opts.sampleSize || GHOST_THREAD_CONFIG.sampleSize;
    const sampled = _weightedSample(allDtus, sampleSize, opts.forceDomains);

    // 2. Ensure minimum domain diversity
    const domains = new Set();
    for (const dtu of sampled) {
      const domain = (dtu.tags || []).find(t => t.startsWith("domain:") || t.startsWith("lens:"));
      if (domain) domains.add(domain);
    }
    if (domains.size < GHOST_THREAD_CONFIG.minDomains) {
      return { ok: false, reason: "insufficient_diversity", domains: domains.size };
    }

    // 3. Run all connection pattern detectors on DTU pairs
    const connections = [];
    for (let i = 0; i < sampled.length; i++) {
      for (let j = i + 1; j < sampled.length; j++) {
        for (const pattern of Object.values(CONNECTION_PATTERNS)) {
          const result = pattern.detect(sampled[i], sampled[j]);
          if (result && result.score >= GHOST_THREAD_CONFIG.connectionThreshold) {
            connections.push({
              pattern: pattern.id,
              patternName: pattern.name,
              dtuA: sampled[i].id,
              dtuB: sampled[j].id,
              score: result.score * pattern.weight,
              evidence: result,
            });
          }
        }
      }
    }

    // 4. Create ghost insights from discovered connections
    const insights = [];
    for (const conn of connections) {
      const dtuA = sampled.find(d => d.id === conn.dtuA);
      const dtuB = sampled.find(d => d.id === conn.dtuB);

      const insight = _createGhostInsight(conn, dtuA, dtuB);
      _ghostInsights.set(insight.id, insight);
      insights.push(insight);

      _metrics.totalConnections++;
      _metrics.byPattern[conn.pattern] = (_metrics.byPattern[conn.pattern] || 0) + 1;
    }

    // 5. Prune old insights if over limit
    if (_ghostInsights.size > GHOST_THREAD_CONFIG.maxInsights) {
      const sorted = [..._ghostInsights.entries()]
        .sort((a, b) => a[1].score - b[1].score);
      const toRemove = sorted.slice(0, _ghostInsights.size - GHOST_THREAD_CONFIG.maxInsights);
      for (const [id] of toRemove) {
        _ghostInsights.delete(id);
        _metrics.discardedInsights++;
      }
    }

    _metrics.totalRuns++;
    _metrics.totalInsights += insights.length;
    _threadHistory.push({ ts: now });

    logger.info("ghost-threads", `Ghost thread found ${connections.length} connections, ${insights.length} insights from ${sampled.length} DTUs across ${domains.size} domains`);

    return {
      ok: true,
      insights: insights.map(_serializeInsight),
      connections: connections.length,
      domains: [...domains],
      sampledDtus: sampled.length,
    };

  } finally {
    _runningThreads--;
  }
}

/**
 * Surface a ghost insight — promote it from shadow to visible.
 * Called when a user query or dream cycle validates the insight.
 *
 * @param {string} insightId
 * @param {object} [context] - Why it was surfaced
 * @returns {{ ok: boolean, insight?: object }}
 */
export function surfaceInsight(insightId, context = {}) {
  const insight = _ghostInsights.get(insightId);
  if (!insight) return { ok: false, reason: "not_found" };

  insight.surfaced = true;
  insight.surfacedAt = new Date().toISOString();
  insight.surfaceContext = context;
  _metrics.surfacedInsights++;

  logger.info("ghost-threads", `Insight surfaced: ${insight.id} (${insight.patternName})`);

  return { ok: true, insight: _serializeInsight(insight) };
}

/**
 * Query ghost insights by various filters.
 */
export function queryInsights({ pattern = null, surfaced = null, minScore = 0, limit = 20 } = {}) {
  let results = [..._ghostInsights.values()];

  if (pattern) results = results.filter(i => i.pattern === pattern);
  if (surfaced !== null) results = results.filter(i => i.surfaced === surfaced);
  results = results.filter(i => i.score >= minScore);

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(_serializeInsight);
}

/**
 * Get ghost thread metrics.
 */
export function getGhostThreadMetrics() {
  return {
    ..._metrics,
    activeInsights: _ghostInsights.size,
    runningThreads: _runningThreads,
  };
}

/**
 * Check if any ghost insights are relevant to a query.
 * Used by the chat router to surface insights contextually.
 *
 * @param {string} query - User's query text
 * @param {string[]} [queryTags] - Tags from the query context
 * @returns {object[]} Matching insights
 */
export function findRelevantInsights(query, queryTags = []) {
  const queryLower = query.toLowerCase();
  const tagSet = new Set(queryTags);
  const results = [];

  for (const insight of _ghostInsights.values()) {
    if (insight.surfaced) continue; // Already surfaced

    let relevance = 0;

    // Check tag overlap
    for (const tag of insight.sourceTags) {
      if (tagSet.has(tag)) relevance += 0.3;
    }

    // Check keyword overlap with summary
    const words = queryLower.split(/\s+/).filter(w => w.length > 3);
    const summaryLower = insight.summary.toLowerCase();
    for (const word of words) {
      if (summaryLower.includes(word)) relevance += 0.2;
    }

    if (relevance > 0.3) {
      results.push({ ...insight, relevance });
    }
  }

  return results
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 3)
    .map(_serializeInsight);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _getDtus(STATE) {
  if (STATE?.dtus && typeof STATE.dtus === "object") {
    if (STATE.dtus instanceof Map) return [...STATE.dtus.values()];
    if (Array.isArray(STATE.dtus)) return STATE.dtus;
    return Object.values(STATE.dtus);
  }
  return [];
}

function _weightedSample(dtus, n, forceDomains = null) {
  // Weight toward diverse domains and higher-tier DTUs
  const shuffled = [...dtus].sort(() => Math.random() - 0.5);

  if (forceDomains && forceDomains.length > 0) {
    const forced = [];
    const domainSet = new Set(forceDomains);
    for (const dtu of shuffled) {
      const domain = (dtu.tags || []).find(t => t.startsWith("domain:") || t.startsWith("lens:"));
      if (domain && domainSet.has(domain.replace(/^(domain:|lens:)/, ""))) {
        forced.push(dtu);
        if (forced.length >= n) break;
      }
    }
    // Fill remaining from general pool
    if (forced.length < n) {
      const remaining = shuffled.filter(d => !forced.includes(d));
      forced.push(...remaining.slice(0, n - forced.length));
    }
    return forced;
  }

  // Prefer diverse domains
  const picked = [];
  const seenDomains = new Set();
  // First pass: one per domain
  for (const dtu of shuffled) {
    const domain = (dtu.tags || []).find(t => t.startsWith("domain:") || t.startsWith("lens:"));
    const key = domain || "unknown";
    if (!seenDomains.has(key)) {
      seenDomains.add(key);
      picked.push(dtu);
      if (picked.length >= n) break;
    }
  }
  // Second pass: fill remaining
  if (picked.length < n) {
    for (const dtu of shuffled) {
      if (!picked.includes(dtu)) {
        picked.push(dtu);
        if (picked.length >= n) break;
      }
    }
  }
  return picked;
}

function _topicOverlap(textA, textB) {
  const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) if (wordsB.has(w)) overlap++;
  return overlap / Math.max(wordsA.size, wordsB.size);
}

function _keywordOverlap(dtuA, dtuB) {
  const tagsA = new Set(dtuA.tags || []);
  const tagsB = new Set(dtuB.tags || []);
  let shared = 0;
  for (const t of tagsA) if (tagsB.has(t)) shared++;
  const total = new Set([...tagsA, ...tagsB]).size;
  return total === 0 ? 0 : shared / total;
}

function _createGhostInsight(connection, dtuA, dtuB) {
  const summaryA = dtuA?.human?.summary || dtuA?.title || "DTU";
  const summaryB = dtuB?.human?.summary || dtuB?.title || "DTU";

  return {
    id: `ghost_${uuid().slice(0, 12)}`,
    type: "ghost_insight",
    tier: "shadow",
    pattern: connection.pattern,
    patternName: connection.patternName,
    score: connection.score,
    summary: `${connection.patternName}: "${summaryA.slice(0, 60)}" ↔ "${summaryB.slice(0, 60)}"`,
    evidence: connection.evidence,
    sourceDtus: [connection.dtuA, connection.dtuB],
    sourceTags: [...new Set([...(dtuA?.tags || []), ...(dtuB?.tags || [])])],
    surfaced: false,
    surfacedAt: null,
    surfaceContext: null,
    createdAt: new Date().toISOString(),
    authority: 0.2,
    lineage: { parents: [connection.dtuA, connection.dtuB], generation: 0 },
  };
}

function _serializeInsight(insight) {
  return {
    id: insight.id,
    type: insight.type,
    tier: insight.tier,
    pattern: insight.pattern,
    patternName: insight.patternName,
    score: insight.score,
    summary: insight.summary,
    evidence: insight.evidence,
    sourceDtus: insight.sourceDtus,
    surfaced: insight.surfaced,
    surfacedAt: insight.surfacedAt,
    createdAt: insight.createdAt,
    authority: insight.authority,
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

export { CONNECTION_PATTERNS, GHOST_THREAD_CONFIG };

export default {
  runGhostThread,
  surfaceInsight,
  queryInsights,
  getGhostThreadMetrics,
  findRelevantInsights,
};
