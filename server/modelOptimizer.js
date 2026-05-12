/**
 * Progressive Model Optimizer for Concord Cognitive Engine
 *
 * Tracks substrate maturity per lens. On CPU, recommends model downgrades
 * as retrieval quality improves to free compute. On GPU (GPU_MODE=true),
 * the optimizer is bypassed — always use the assigned brain model.
 *
 * CPU maturity levels (active when GPU_MODE is not set):
 *   < 0.3 → 7B (full conscious reasoning)
 *   < 0.6 → 3B (utility brain sufficient)
 *   < 0.8 → 1.5B (subconscious-class model)
 *   >= 0.8 → 0.5B or retrieval-only (minimal inference)
 *
 * GPU mode: returns null (use default brain model, no downgrading)
 */

import { getEmbedding } from "./embeddings.js";
import { LruMap, LruSet } from "./lib/lru-map.js";

// ── State ──────────────────────────────────────────────────────────────────

/** @type {Map<string, { dtuCount: number, megaCount: number, hyperCount: number, cacheHits: number, totalQueries: number, retrievalSufficient: number, avgTopSimilarity: number, avgSatisfaction: number }>} */
const lensStats = new LruMap();

/** @type {Map<string, string>} lens → currently assigned model */
const lensModels = new Map();

/** @type {Function|null} */
let _log = null;

// ── Initialisation ─────────────────────────────────────────────────────────

export function initModelOptimizer({ structuredLog = console.warn } = {}) {
  _log = structuredLog;
  _log("info", "model_optimizer_init", {});
}

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Assess the maturity level of a specific lens.
 *
 * @param {string} lens
 * @param {{ dtusArray: Function }} opts
 * @returns {object}
 */
export function assessLensMaturity(lens, { dtusArray } = {}) {
  const stats = _getLensStats(lens, dtusArray);

  const maturity = calculateMaturity(stats);
  const recommended = recommendModel(stats);

  return {
    lens,
    totalDTUs: stats.dtuCount,
    megaCount: stats.megaCount,
    hyperCount: stats.hyperCount,
    cacheHitRate: stats.totalQueries > 0 ? stats.cacheHits / stats.totalQueries : 0,
    retrievalSufficiencyRate: stats.totalQueries > 0 ? stats.retrievalSufficient / stats.totalQueries : 0,
    avgTopSimilarity: stats.avgTopSimilarity,
    avgSatisfaction: stats.avgSatisfaction,
    maturityScore: maturity,
    recommendedModel: recommended,
    currentModel: lensModels.get(lens) || "7b",
  };
}

/**
 * Assess all lenses and return maturity report.
 *
 * @param {{ dtusArray: Function }} opts
 * @returns {object[]}
 */
export function assessAllLenses({ dtusArray } = {}) {
  const allDTUs = typeof dtusArray === "function" ? dtusArray() : [];

  // Extract unique lenses from DTU tags
  const lenses = new Set();
  for (const dtu of allDTUs) {
    if (Array.isArray(dtu.tags)) {
      for (const t of dtu.tags) {
        lenses.add(t.toLowerCase());
      }
    }
  }

  const results = [];
  for (const lens of lenses) {
    const assessment = assessLensMaturity(lens, { dtusArray });
    if (assessment.totalDTUs >= 5) { // Only report lenses with meaningful content
      results.push(assessment);
    }
  }

  return results.sort((a, b) => b.maturityScore - a.maturityScore);
}

/**
 * Record a query event for a lens (for stats tracking).
 *
 * @param {string|null} lens
 * @param {{ cacheHit?: boolean, retrievalSufficient?: boolean, topSimilarity?: number, satisfaction?: number }} event
 */
export function recordQueryEvent(lens, { cacheHit = false, retrievalSufficient = false, topSimilarity = 0, satisfaction = null } = {}) {
  const key = lens || "_global";
  if (!lensStats.has(key)) {
    lensStats.set(key, {
      dtuCount: 0,
      megaCount: 0,
      hyperCount: 0,
      cacheHits: 0,
      totalQueries: 0,
      retrievalSufficient: 0,
      avgTopSimilarity: 0,
      avgSatisfaction: 0.5,
      _satisfactionSum: 0,
      _satisfactionCount: 0,
    });
  }

  const s = lensStats.get(key);
  s.totalQueries++;
  if (cacheHit) s.cacheHits++;
  if (retrievalSufficient) s.retrievalSufficient++;
  s.avgTopSimilarity = (s.avgTopSimilarity * (s.totalQueries - 1) + topSimilarity) / s.totalQueries;

  if (satisfaction !== null) {
    s._satisfactionSum += satisfaction;
    s._satisfactionCount++;
    s.avgSatisfaction = s._satisfactionSum / s._satisfactionCount;
  }
}

/**
 * Get the recommended model for a lens (used by routing logic).
 *
 * @param {string|null} lens
 * @returns {string|null} Model size recommendation, or null on GPU (use default brain model)
 */
export function getRecommendedModel(lens) {
  // On GPU, always use the assigned brain model — no downgrading
  if (process.env.GPU_MODE === "true") return null;

  const stats = lensStats.get(lens || "_global");
  if (!stats) return "7b";
  return recommendModel(stats).model;
}

// ── Internal Helpers ───────────────────────────────────────────────────────

function _getLensStats(lens, dtusArray) {
  const base = lensStats.get(lens) || {
    dtuCount: 0,
    megaCount: 0,
    hyperCount: 0,
    cacheHits: 0,
    totalQueries: 0,
    retrievalSufficient: 0,
    avgTopSimilarity: 0,
    avgSatisfaction: 0.5,
  };

  // Enrich with live DTU counts
  if (typeof dtusArray === "function") {
    const allDTUs = dtusArray();
    const lensDTUs = allDTUs.filter(d => Array.isArray(d.tags) && d.tags.some(t => t.toLowerCase() === lens?.toLowerCase()));
    base.dtuCount = lensDTUs.length;
    base.megaCount = lensDTUs.filter(d => d.tier === "mega").length;
    base.hyperCount = lensDTUs.filter(d => d.tier === "hyper").length;
  }

  return base;
}

/**
 * Calculate overall maturity score (0–1) for a lens.
 */
function calculateMaturity(stats) {
  let score = 0;

  // Has HYPER DTUs (dense knowledge kernel)
  if (stats.hyperCount > 0) score += 0.2;

  // Has 10+ MEGA DTUs (consolidated clusters)
  if (stats.megaCount >= 10) score += 0.2;

  // Cache hit rate (capped at 0.5 contribution)
  const cacheRate = stats.totalQueries > 0 ? stats.cacheHits / stats.totalQueries : 0;
  score += Math.min(cacheRate, 0.5) * 0.4;

  // Retrieval sufficiency rate (capped at 0.5 contribution)
  const retrievalRate = stats.totalQueries > 0 ? stats.retrievalSufficient / stats.totalQueries : 0;
  score += Math.min(retrievalRate, 0.5) * 0.4;

  return Math.min(score, 1.0);
}

/**
 * Recommend a model size based on lens maturity (CPU mode only).
 * On GPU, getRecommendedModel() short-circuits before reaching this.
 */
function recommendModel(stats) {
  const maturity = calculateMaturity(stats);

  if (maturity < 0.3) return { model: "7b", reason: "Low substrate coverage" };
  if (maturity < 0.6) return { model: "3b", reason: "Adequate retrieval context" };
  if (maturity < 0.8) return { model: "1.5b", reason: "Strong retrieval coverage" };
  return { model: "0.5b", reason: "Substrate answers most queries via retrieval" };
}

// ── Monitoring ─────────────────────────────────────────────────────────────

export function getModelOptimizerStats() {
  const byLens = {};
  for (const [k, v] of lensStats) {
    byLens[k] = {
      ...v,
      maturity: calculateMaturity(v),
      recommendedModel: recommendModel(v),
      currentModel: lensModels.get(k) || "7b",
    };
  }

  return { byLens };
}

export default {
  initModelOptimizer,
  assessLensMaturity,
  assessAllLenses,
  recordQueryEvent,
  getRecommendedModel,
  getModelOptimizerStats,
};
