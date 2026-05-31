// server/lib/career-engine.js
//
// WAVE JOBS keystone — the activity→wage→promotion wire + the 4-gate promotion.
// performanceScore is the outcome of the REAL activity (recipe quality, match
// stats, case solved, ore yield) and it feeds BOTH the pay multiplier AND
// promotion XP — that's what makes "do the job yourself" matter economically.
// Promotion copies The Sims' proven 4-condition legibility (skill + daily task
// + work performance + reputation), and every promotion delivers the TRIO (wage
// + public title + unlock), with a PERMANENT output multiplier at the mastery
// tiers (Stardew Artisan). Pure; composes professions.js. Sparks economy.
// Behind CONCORD_LIVING_CAREER at the callers.

import { tierInfo, resolveBranch, MAX_TIER, BRANCH_TIER } from "./professions.js";

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));

export const DEFAULT_PERF_THRESHOLD = 0.6; // work-performance bar for promotion
export const MASTERY_MULT_TIER10 = 1.5;     // permanent output multiplier at tier 10
export const MASTERY_MULT_TIER5 = 1.2;      // …and at the branch/mastery tier 5

/**
 * The 4-gate promotion check (Sims model). All four must hold; reputation gate
 * defaults to 0 (off) so a track without a social requirement still promotes on
 * the other three. Returns which gates are met + the next tier if ready.
 * @returns {{ ready:boolean, gates:{skill,dailyTask,performance,reputation}, nextTier:number }}
 */
export function promotionReady(state = {}, trackId, tier, opts = {}) {
  const info = tierInfo(trackId, tier);
  if (!info) return { ready: false, gates: {}, nextTier: tier };
  const perfThreshold = opts.perfThreshold ?? DEFAULT_PERF_THRESHOLD;
  const repThreshold = opts.repThreshold ?? 0;
  const gates = {
    skill: (Number(state.skillLevel) || 0) >= info.skillGate,
    dailyTask: !!state.dailyTaskDone,
    performance: clamp01(state.performanceScore) >= perfThreshold,
    reputation: (Number(state.reputation) ?? 0) >= repThreshold,
  };
  const ready = gates.skill && gates.dailyTask && gates.performance && gates.reputation && tier < MAX_TIER;
  return { ready, gates, nextTier: ready ? tier + 1 : tier };
}

/**
 * Pay for one work session: the activity's performanceScore (0..1) scales the
 * tier wage base 0.5×–1.5×, then a mastery multiplier applies if the worker has
 * hit a mastery tier (the permanent "I'm a master chef, worth more forever").
 * Returns sparks.
 */
export function shiftPay(performanceScore, trackId, tier, { masteryTierReached = 0 } = {}) {
  const info = tierInfo(trackId, tier);
  if (!info) return 0;
  const perfMult = 0.5 + clamp01(performanceScore);                 // 0.5×…1.5×
  const mastery = masteryMultiplierFor(masteryTierReached);
  return Math.round(info.wageBase * perfMult * mastery);
}

/** Promotion XP from a session — performance-weighted (10…50 per shift). */
export function promotionXp(performanceScore) {
  return Math.round(10 + clamp01(performanceScore) * 40);
}

/** The permanent output multiplier earned by reaching a mastery tier. */
export function masteryMultiplierFor(highestTierReached) {
  const t = Math.floor(Number(highestTierReached) || 0);
  if (t >= MAX_TIER) return MASTERY_MULT_TIER10;
  if (t >= BRANCH_TIER) return MASTERY_MULT_TIER5;
  return 1.0;
}

/**
 * The TRIO reward on a promotion: wage bump + public TITLE (queryable identity)
 * + an access/content unlock; mastery tiers also stamp the permanent multiplier.
 * @returns {{ tier, wage, title, unlock, masteryMultiplier, isMastery }}
 */
export function promotionReward(trackId, newTier) {
  const info = tierInfo(trackId, newTier);
  if (!info) return null;
  return {
    tier: info.tier,
    wage: info.wageBase,
    title: info.title,                         // (2) public identity
    unlock: `${trackId}:tier-${info.tier}`,    // (3) access/content unlock
    masteryMultiplier: masteryMultiplierFor(info.tier),
    isMastery: info.isMastery,
  };
}

/** At the branch tier, commit a specialisation (Chef vs Mixologist). */
export function chooseBranch(trackId, tier, choice) {
  if (tier !== BRANCH_TIER) return { ok: false, reason: "not_branch_tier" };
  const resolved = resolveBranch(trackId, choice);
  return resolved ? { ok: true, branch: resolved } : { ok: false, reason: "invalid_branch" };
}
