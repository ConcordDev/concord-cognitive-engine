/**
 * Freshness Engine — Domain-aware freshness scoring for DTUs.
 *
 * Extends the base calculateFreshness() with:
 *   - Domain velocity (finance decays fast, history decays slow)
 *   - Citation boost (well-cited DTUs stay fresher)
 *   - Validation tracking (last verified date)
 *   - Freshness-weighted relevance for RAG context scoring
 */

import logger from "../logger.js";

// ── Domain Decay Rates ─────────────────────────────────────────────────────
// Half-life in days — lower = decays faster
const DOMAIN_HALF_LIVES = {
  // Fast-decay domains (information changes rapidly)
  finance:        7,
  crypto:         5,
  stocks:         7,
  trading:        7,
  news:           3,
  weather:        1,
  sports:         5,
  social_media:   7,
  trending:       3,
  market:         7,

  // Medium-decay domains
  technology:     21,
  programming:    30,
  science:        30,
  health:         21,
  nutrition:      21,
  politics:       14,
  business:       21,
  ai:             14,
  security:       14,
  law:            30,
  education:      45,

  // Slow-decay domains (information is stable)
  history:        365,
  mathematics:    730,
  philosophy:     365,
  literature:     365,
  geography:      180,
  physics:        180,
  chemistry:      120,
  biology:        90,
  music_theory:   365,
  architecture:   180,
  art_history:    365,
  linguistics:    365,
  classical:      730,
};

const DEFAULT_HALF_LIFE = 30; // days

/**
 * Get the domain-specific half-life for a DTU based on its tags.
 */
function getDomainHalfLife(tags = []) {
  if (!Array.isArray(tags) || tags.length === 0) return DEFAULT_HALF_LIFE;

  // Use the fastest-decaying matching domain
  let fastest = DEFAULT_HALF_LIFE;
  for (const tag of tags) {
    const normalized = tag.toLowerCase().replace(/[^a-z_]/g, "");
    if (DOMAIN_HALF_LIVES[normalized] != null) {
      fastest = Math.min(fastest, DOMAIN_HALF_LIVES[normalized]);
    }
  }
  return fastest;
}

/**
 * Compute a domain-aware freshness score for a DTU (0.0 - 1.0).
 *
 * Factors:
 *   1. Age decay with domain-specific half-life
 *   2. Access recency boost
 *   3. Tier boost (hyper/mega decay slower)
 *   4. Connection/citation boost
 *   5. Validation recency boost
 *
 * @param {object} dtu
 * @returns {{ score: number, label: string, factors: object, halfLife: number }}
 */
function computeFreshness(dtu) {
  if (!dtu) return { score: 0, label: "stale", factors: {}, halfLife: DEFAULT_HALF_LIFE };

  const now = Date.now();
  const created = new Date(dtu.createdAt || dtu.created || now).getTime();
  const updated = new Date(dtu.updatedAt || dtu.updated || created).getTime();
  const lastAccessed = dtu.meta?.lastAccessedAt ? new Date(dtu.meta.lastAccessedAt).getTime() : 0;
  const lastValidated = dtu.meta?.lastValidatedAt ? new Date(dtu.meta.lastValidatedAt).getTime() : 0;
  const lastTouched = Math.max(created, updated, lastAccessed, lastValidated);

  // Factor 1: Domain-aware age decay
  const halfLife = getDomainHalfLife(dtu.tags);
  const ageDays = (now - lastTouched) / 86_400_000;
  const ageDecay = Math.exp(-ageDays * Math.LN2 / halfLife);

  // Factor 2: Access recency boost (frequently accessed = stays fresh)
  const accessCount = dtu.meta?.accessCount || 0;
  const accessBoost = 1 + 0.1 * Math.min(accessCount, 10);

  // Factor 3: Tier boost
  const tierMultiplier = dtu.tier === "hyper" ? 1.5 : dtu.tier === "mega" ? 1.3 : dtu.tier === "crystal" ? 1.4 : 1.0;

  // Factor 4: Citation/connection boost
  const parentCount = dtu.lineage?.parentIds?.length || 0;
  const childCount = dtu.lineage?.childIds?.length || 0;
  const citationCount = dtu.meta?.citationCount || 0;
  const connectionScore = parentCount + childCount + citationCount;
  const connectionBoost = 1 + 0.05 * Math.min(connectionScore, 20);

  // Factor 5: Validation boost (recently verified = trusted)
  let validationBoost = 1.0;
  if (lastValidated > 0) {
    const daysSinceValidation = (now - lastValidated) / 86_400_000;
    validationBoost = daysSinceValidation < 7 ? 1.3 : daysSinceValidation < 30 ? 1.15 : 1.0;
  }

  // Combine
  const raw = ageDecay * accessBoost * tierMultiplier * connectionBoost * validationBoost;
  const score = Math.min(1.0, Math.max(0.0, raw));
  const label = score >= 0.8 ? "fresh" : score >= 0.5 ? "warm" : score >= 0.2 ? "cooling" : "stale";

  return {
    score: Math.round(score * 1000) / 1000,
    label,
    halfLife,
    factors: {
      ageDecay: Math.round(ageDecay * 1000) / 1000,
      ageDays: Math.round(ageDays * 10) / 10,
      accessBoost: Math.round(accessBoost * 100) / 100,
      tierMultiplier,
      connectionBoost: Math.round(connectionBoost * 100) / 100,
      validationBoost,
      domainHalfLifeDays: halfLife,
    },
  };
}

/**
 * Freshness label for display.
 */
export function freshnessLabel(score) {
  if (score >= 0.8) return "fresh";
  if (score >= 0.5) return "warm";
  if (score >= 0.2) return "cooling";
  return "stale";
}

/**
 * Apply freshness weighting to RAG relevance scores.
 * Used to re-rank semantic search results by combining similarity + freshness.
 *
 * @param {object[]} results - Array of { score (similarity), dtu }
 * @param {{ freshnessWeight?: number }} opts
 * @returns {object[]} Re-ranked results with combined score
 */
function applyFreshnessToRelevance(results, { freshnessWeight = 0.2 } = {}) {
  if (!Array.isArray(results) || results.length === 0) return results;

  const similarityWeight = 1 - freshnessWeight;

  return results.map(r => {
    const dtu = r.dtu || r;
    const freshness = computeFreshness(dtu);
    const similarityScore = r.score || r._semanticScore || 0.5;
    const combinedScore = (similarityScore * similarityWeight) + (freshness.score * freshnessWeight);

    return {
      ...r,
      score: Math.round(combinedScore * 1000) / 1000,
      _originalScore: similarityScore,
      _freshnessScore: freshness.score,
      _freshnessLabel: freshness.label,
    };
  }).sort((a, b) => b.score - a.score);
}

/**
 * Mark a DTU as validated (refreshes its freshness score).
 */
function markValidated(dtu) {
  if (!dtu) return;
  if (!dtu.meta) dtu.meta = {};
  dtu.meta.lastValidatedAt = new Date().toISOString();
}

/**
 * Get domain velocity stats — how fast knowledge changes in a domain.
 */
function getDomainVelocity(domain) {
  const hl = DOMAIN_HALF_LIVES[domain?.toLowerCase()] || DEFAULT_HALF_LIFE;
  return {
    domain,
    halfLifeDays: hl,
    velocity: hl <= 7 ? "high" : hl <= 30 ? "medium" : "low",
    description: hl <= 7
      ? "Fast-moving domain — DTUs decay quickly"
      : hl <= 30
        ? "Moderate domain — DTUs stay fresh for weeks"
        : "Stable domain — DTUs remain fresh for months",
  };
}

export default {
  computeFreshness,
  freshnessLabel,
  applyFreshnessToRelevance,
  getDomainHalfLife,
  getDomainVelocity,
  markValidated,
  DOMAIN_HALF_LIVES,
};
