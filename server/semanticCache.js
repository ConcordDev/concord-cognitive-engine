/**
 * Semantic Cache for Concord Cognitive Engine
 *
 * Before hitting any LLM, checks if a semantically similar question
 * has already been answered. Returns cached DTU if similarity exceeds
 * threshold. More users = more cache hits = less inference.
 *
 * Adaptive threshold: tracks satisfaction per lens and adjusts.
 */

import { embed, cosineSimilarity, isEmbeddingAvailable, getEmbedding } from "./embeddings.js";
import { LruMap, LruSet } from "./lib/lru-map.js";

// ── Configuration ──────────────────────────────────────────────────────────
const DEFAULT_THRESHOLD = 0.92;
const MIN_THRESHOLD = 0.80;
const MAX_THRESHOLD = 0.98;

// ── State ──────────────────────────────────────────────────────────────────

/** @type {Map<string, number>} Per-lens adaptive thresholds */
const lensThresholds = new LruMap();

/** @type {{ hits: number, misses: number, totalSaved: number, avgScore: number, hitsByLens: Map<string, number> }} */
const cacheStats = {
  hits: 0,
  misses: 0,
  totalSaved: 0,
  avgScore: 0,
  hitsByLens: new Map(),
  satisfaction: new Map(), // lensKey → { thumbsUp, thumbsDown }
};

/** @type {Function|null} */
let _log = null;

// ── Initialisation ─────────────────────────────────────────────────────────

/**
 * @param {{ structuredLog?: Function }} opts
 */
export function initSemanticCache({ structuredLog = console.log } = {}) {
  _log = structuredLog;
  _log("info", "semantic_cache_init", { defaultThreshold: DEFAULT_THRESHOLD });
}

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Check if a semantically similar query has already been answered.
 * Search only chat-generated DTUs (source: conscious.chat, utility).
 *
 * @param {string} query - The user's question
 * @param {string|null} lens - Optional lens filter
 * @param {{ dtusArray: Function, threshold?: number }} opts
 * @returns {Promise<{ cached: boolean, response?: string, sourceId?: string, score?: number }>}
 */
export async function semanticCacheCheck(query, lens, { dtusArray, threshold, userId: _userId } = {}) {
  if (!isEmbeddingAvailable()) {
    cacheStats.misses++;
    return { cached: false, reason: "embeddings_unavailable" };
  }

  const effectiveThreshold = threshold ?? lensThresholds.get(lens) ?? DEFAULT_THRESHOLD;

  const queryVec = await embed(query);
  if (!queryVec) {
    cacheStats.misses++;
    return { cached: false, reason: "embed_failed" };
  }

  // Get candidate DTUs — only chat/utility-generated ones, scoped to user's local instance
  const allDTUs = typeof dtusArray === "function" ? dtusArray() : [];
  const userId = _userId || null;
  const candidates = allDTUs.filter(d => {
    const src = String(d.source || "");
    if (!src.startsWith("conscious.chat") && !src.startsWith("utility.") && !src.startsWith("conscious.cache")) return false;
    // Sovereignty: scope to user's local DTUs when userId is provided
    if (userId && d.ownerId && d.ownerId !== userId) return false;
    // Sovereignty: only search local scope DTUs for cache
    if (d.scope && d.scope !== "local") return false;
    if (lens && Array.isArray(d.tags) && !d.tags.some(t => t.toLowerCase() === lens?.toLowerCase())) return false;
    return true;
  });

  if (candidates.length === 0) {
    cacheStats.misses++;
    return { cached: false, reason: "no_candidates" };
  }

  // Find best match
  let bestScore = 0;
  let bestDTU = null;

  for (const dtu of candidates) {
    const vec = getEmbedding(dtu.id);
    if (!vec) continue;

    const sim = cosineSimilarity(queryVec, vec);
    if (sim > bestScore) {
      bestScore = sim;
      bestDTU = dtu;
    }
  }

  if (bestDTU && bestScore >= effectiveThreshold) {
    cacheStats.hits++;
    cacheStats.totalSaved++;
    cacheStats.avgScore = cacheStats.hits > 0
      ? (cacheStats.avgScore * (cacheStats.hits - 1) + bestScore) / cacheStats.hits
      : bestScore;

    const lensKey = lens || "_global";
    cacheStats.hitsByLens.set(lensKey, (cacheStats.hitsByLens.get(lensKey) || 0) + 1);

    if (_log) _log("info", "cache_hit", { lens, score: bestScore, sourceId: bestDTU.id });

    const response = bestDTU.cretiHuman || bestDTU.human?.summary || bestDTU.machine?.notes || "";

    return {
      cached: true,
      response,
      sourceId: bestDTU.id,
      score: bestScore,
    };
  }

  cacheStats.misses++;
  return { cached: false, bestScore, reason: bestScore > 0 ? "below_threshold" : "no_embedding_matches" };
}

// ── Adaptive Threshold ─────────────────────────────────────────────────────

/**
 * Record user satisfaction feedback for a cached response.
 * Used to adaptively adjust the threshold per lens.
 *
 * @param {string|null} lens
 * @param {boolean} satisfied - true for thumbs up, false for thumbs down
 */
export function recordCacheSatisfaction(lens, satisfied) {
  const key = lens || "_global";
  if (!cacheStats.satisfaction.has(key)) {
    cacheStats.satisfaction.set(key, { thumbsUp: 0, thumbsDown: 0 });
  }
  const s = cacheStats.satisfaction.get(key);
  if (satisfied) s.thumbsUp++;
  else s.thumbsDown++;

  // Recalculate threshold for this lens
  const total = s.thumbsUp + s.thumbsDown;
  if (total >= 5) {
    const rate = s.thumbsUp / total;
    if (rate > 0.8) {
      // High satisfaction — can lower threshold (more cache hits)
      lensThresholds.set(key, Math.max(MIN_THRESHOLD, DEFAULT_THRESHOLD - 0.03));
    } else if (rate < 0.5) {
      // Low satisfaction — raise threshold (fewer, better cache hits)
      lensThresholds.set(key, Math.min(MAX_THRESHOLD, DEFAULT_THRESHOLD + 0.03));
    }
  }
}

// ── Cache Warming ──────────────────────────────────────────────────────────

/**
 * After a successful LLM response, check if similar unanswered queries exist
 * in recent logs and pre-associate them with the new response.
 *
 * @param {string} answeredQuery
 * @param {string} dtuId - The newly created DTU
 * @param {Function} dtusArray
 */
export async function warmRelatedQueries(answeredQuery, dtuId, dtusArray) {
  // Intentionally lightweight — just log for now, actual warming happens
  // via the precompute pipeline
  if (_log) _log("info", "cache_warm_trigger", { query: answeredQuery.slice(0, 100), dtuId });
}

// ── Monitoring ─────────────────────────────────────────────────────────────

/**
 * Get cache statistics for monitoring dashboards.
 */
export function getCacheStats() {
  const total = cacheStats.hits + cacheStats.misses;
  const hitRate = total > 0 ? cacheStats.hits / total : 0;

  const byLens = {};
  for (const [k, v] of cacheStats.hitsByLens) {
    byLens[k] = v;
  }

  const satisfaction = {};
  for (const [k, v] of cacheStats.satisfaction) {
    satisfaction[k] = {
      ...v,
      rate: (v.thumbsUp + v.thumbsDown) > 0 ? v.thumbsUp / (v.thumbsUp + v.thumbsDown) : null,
    };
  }

  const thresholds = {};
  for (const [k, v] of lensThresholds) {
    thresholds[k] = v;
  }

  return {
    hits: cacheStats.hits,
    misses: cacheStats.misses,
    total,
    hitRate: Math.round(hitRate * 100) / 100,
    avgScore: Math.round(cacheStats.avgScore * 1000) / 1000,
    totalSaved: cacheStats.totalSaved,
    byLens,
    satisfaction,
    thresholds,
    defaultThreshold: DEFAULT_THRESHOLD,
  };
}

export default {
  initSemanticCache,
  semanticCacheCheck,
  recordCacheSatisfaction,
  warmRelatedQueries,
  getCacheStats,
};
