// server/lib/social/ranker.js
//
// The inverse-X ranker. Concord's OOTB social algorithm: boosts
// positive axes, tanks negative axes, and produces a transparent
// score breakdown so users can see exactly why a post ranked where
// it did ("why am I seeing this?").
//
// User-defined algorithms (Bluesky Attie parity) layer on top — the
// algorithm is just a weight vector + filter spec. Same compute path.

import { ALL_AXES } from "./classifier.js";

// Inverse-X default weights — concord's structural advantage. We have
// no ad business so we can actually ship these.
export const INVERSE_X_WEIGHTS = {
  // POSITIVE — amplified
  informative:     1.5,
  helpful:         1.4,
  learning:        1.3,
  calm:            1.0,
  celebration:     0.9,
  question:        1.0,
  personal:        1.1,
  creative:        1.0,
  // NEGATIVE — tanked (these are subtracted)
  rage_bait:      -2.5,    // hardest down-rank — the OOTB rejection
  engagement_bait:-1.8,
  controversy:    -1.0,
  promotional:    -1.6,
  doomscroll:     -1.4,
};

// Chronological + small-boost-for-recency floor, applied to ALL ranking
// (otherwise stale informative posts swamp fresh ones)
const RECENCY_HALF_LIFE_HOURS = 12;

export function recencyMultiplier(publishedAtSec, nowSec = Math.floor(Date.now() / 1000)) {
  const ageHours = Math.max(0, (nowSec - publishedAtSec) / 3600);
  return Math.pow(0.5, ageHours / RECENCY_HALF_LIFE_HOURS);
}

/**
 * Score a single post given a classification + a weight vector.
 * Returns { score, breakdown: { axis: contribution }, recencyMultiplier, reasons: string[] }.
 */
export function scorePost(post, classification, weights = INVERSE_X_WEIGHTS, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const breakdown = {};
  let raw = 0;
  const reasons = [];
  for (const axis of ALL_AXES) {
    const w = weights[axis] ?? 0;
    const v = Number(classification?.[axis]) || 0;
    if (!w || !v) { breakdown[axis] = 0; continue; }
    const contribution = w * v;
    breakdown[axis] = Math.round(contribution * 100) / 100;
    raw += contribution;
    if (Math.abs(contribution) >= 0.5) {
      reasons.push(
        contribution > 0
          ? `boosted because ${axis}=${v.toFixed(2)} (weight +${w})`
          : `tanked because ${axis}=${v.toFixed(2)} (weight ${w})`,
      );
    }
  }
  const recency = recencyMultiplier(post.published_at, nowSec);
  // Recency multiplier is applied to the POSITIVE half only — negative
  // signals should still tank stale rage-bait. We apply it to the
  // floor +5 baseline + half of the raw positive score.
  const positive = Math.max(0, raw);
  const negative = Math.min(0, raw);
  const score = (5 + positive * 0.5) * recency + positive * 0.5 + negative;
  if (recency < 0.5) reasons.push(`recency=${recency.toFixed(2)} (older than ${RECENCY_HALF_LIFE_HOURS}h)`);
  return { score: Math.round(score * 100) / 100, raw: Math.round(raw * 100) / 100, breakdown, recencyMultiplier: recency, reasons };
}

/**
 * Rank an array of posts (each with .classification attached).
 * Returns same array sorted by score DESC; each post gains .score +
 * .breakdown + .reasons + .recencyMultiplier.
 */
export function rankFeed(posts, weights = INVERSE_X_WEIGHTS, opts = {}) {
  const now = opts.nowSec || Math.floor(Date.now() / 1000);
  const filtered = (posts || []).filter((p) => {
    if (!opts.filters) return true;
    const c = p.classification || {};
    if (opts.filters.min_informative != null && (c.informative || 0) < opts.filters.min_informative) return false;
    if (opts.filters.max_rage_bait != null && (c.rage_bait || 0) > opts.filters.max_rage_bait) return false;
    if (opts.filters.max_engagement_bait != null && (c.engagement_bait || 0) > opts.filters.max_engagement_bait) return false;
    if (opts.filters.max_promotional != null && (c.promotional || 0) > opts.filters.max_promotional) return false;
    if (opts.filters.min_calm != null && (c.calm || 0) < opts.filters.min_calm) return false;
    if (opts.filters.min_helpful != null && (c.helpful || 0) < opts.filters.min_helpful) return false;
    return true;
  });
  const scored = filtered.map((p) => ({
    ...p,
    ...scorePost(p, p.classification || {}, weights, { nowSec: now }),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Seeded preset algorithms shown in the lens UI alongside Inverse-X.
 */
export const SEEDED_ALGOS = [
  {
    id: "algo:seed:inverse_x",
    name: "Concord default (Inverse-X)",
    description: "The inverse of every engagement-maximising algorithm: boosts informative, helpful, calm, learning, celebration. Tanks rage-bait + engagement-bait + doomscroll.",
    icon: "🕊️",
    weights: INVERSE_X_WEIGHTS,
    filters: { max_rage_bait: 0.6, max_engagement_bait: 0.7 },
  },
  {
    id: "algo:seed:hopeful_mornings",
    name: "Hopeful mornings",
    description: "Maximally positive. Celebration + helpful + creative dominate. Strong rage filter.",
    icon: "🌅",
    weights: {
      celebration: 2.0, helpful: 1.8, creative: 1.7, learning: 1.4,
      personal: 1.2, calm: 1.5, informative: 1.0, question: 0.8,
      rage_bait: -5.0, engagement_bait: -3.0, controversy: -2.5,
      doomscroll: -4.0, promotional: -2.0,
    },
    filters: { max_rage_bait: 0.2, max_doomscroll: 0.3 },
  },
  {
    id: "algo:seed:deep_learning",
    name: "Deep learning",
    description: "Informative + learning above all else. Tanks personal + celebration to focus on knowledge.",
    icon: "📚",
    weights: {
      informative: 3.0, learning: 2.8, helpful: 2.0, creative: 1.0,
      calm: 0.8, personal: -0.3, celebration: -0.3, question: 1.5,
      rage_bait: -3.0, engagement_bait: -2.0, controversy: -1.0,
      doomscroll: -2.5, promotional: -2.5,
    },
    filters: { min_informative: 0.25 },
  },
  {
    id: "algo:seed:no_outrage",
    name: "No outrage",
    description: "Pure chronological with hard filters: anything tagged rage_bait > 0.4 or engagement_bait > 0.5 is removed.",
    icon: "🚫",
    weights: {
      informative: 0.1, helpful: 0.1, calm: 0.1, personal: 0.1,
      celebration: 0.1, question: 0.1, learning: 0.1, creative: 0.1,
      rage_bait: -1.0, engagement_bait: -1.0, controversy: -0.5,
      promotional: -0.5, doomscroll: -0.5,
    },
    filters: { max_rage_bait: 0.4, max_engagement_bait: 0.5 },
  },
];
