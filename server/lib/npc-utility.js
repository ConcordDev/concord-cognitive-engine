// server/lib/npc-utility.js
//
// Living Society WS4.3 — the utility scorer (the new NPC brain).
//
// IAUS-lite (Dave Mark's Infinite Axis Utility System, the model The Sims uses):
// an NPC doesn't follow a fixed script — every tick it SCORES candidate goals
// (smart-object POIs that advertise need-satisfaction) against its current
// needs + schedule bias + personality + desires/grudges, and picks the best
// (weighted-random among the top few for variety). This is where needs, wants
// (npc_desires) and grudges FINALLY drive movement.
//
// Pure + deterministic (seeded RNG): given the same inputs, the same choice —
// so the brain is contract-testable.

import crypto from "node:crypto";
import { NEED_KINDS, normalizeNeeds } from "./npc-needs.js";

// Personality nudges per archetype: which needs an archetype over-weights when
// choosing (a trader chases wealth, a mystic chases purpose, a warrior safety).
const ARCHETYPE_WEIGHTS = Object.freeze({
  trader: { wealth: 1.5, social: 1.2 },
  merchant: { wealth: 1.5, social: 1.2 },
  warrior: { safety: 1.4, purpose: 1.2 },
  guard: { safety: 1.5, purpose: 1.1 },
  mystic: { purpose: 1.6, social: 0.8 },
  scholar: { purpose: 1.4 },
  healer: { social: 1.3, purpose: 1.2 },
  farmer: { wealth: 1.2, purpose: 1.3 },
  cook: { hunger: 1.3, social: 1.2 },
  default: {},
});

/** Distance falloff: closer POIs score higher. ~1.0 at 0m, ~0.5 at 60m. */
function distanceCurve(distM) {
  const d = Math.max(0, Number(distM) || 0);
  return 1 / (1 + d / 60);
}

/** Schedule bias: the time-block's activity_kind gently favours matching POIs. */
const BLOCK_AFFINITY = Object.freeze({
  sleep: { energy: 1.0 }, rest: { energy: 0.6 }, socialize: { social: 1.0 },
  trade: { wealth: 0.8, social: 0.4 }, craft: { wealth: 0.5, purpose: 0.6 },
  commune: { purpose: 1.0 }, gather: { wealth: 0.5 }, patrol: { safety: 0.6 },
  farm: { wealth: 0.5, purpose: 0.6 }, build: { wealth: 0.5, purpose: 0.6 },
  mine: { wealth: 0.6 }, cook: { hunger: 0.6, social: 0.4 },
});

function seededUnit(key) {
  return crypto.createHash("sha1").update(String(key)).digest()[0] / 255; // 0..1
}

/**
 * Score one candidate goal (a POI advertising {need: amount}) for an NPC.
 * score = Σ_need deficit[need] × advert[need] × personalityWeight[need]
 *         × distanceCurve × (1 + scheduleAffinity)  + desire/grudge modifier.
 */
export function scoreGoal(npc, needs, poi, opts = {}) {
  const cur = normalizeNeeds(needs);
  const advert = poi?.advertises || {};
  const pw = ARCHETYPE_WEIGHTS[String(npc?.archetype || "default").toLowerCase()] || ARCHETYPE_WEIGHTS.default;
  const blockAff = BLOCK_AFFINITY[opts.activityKind] || {};
  let base = 0;
  for (const k of NEED_KINDS) {
    const a = Number(advert[k]) || 0;
    if (a <= 0) continue;
    const w = Number(pw[k]) || 1;
    const sched = 1 + (Number(blockAff[k]) || 0);
    base += cur[k] * a * w * sched;
  }
  base *= distanceCurve(poi?.dist);

  // Wants/grudges drive movement: a desire whose target POI matches bumps the
  // score; a grudge target POI is pulled (confront) or pushed (avoid) per opts.
  let mod = 0;
  if (opts.desirePoiId && poi?.id === opts.desirePoiId) mod += (Number(opts.desireWeight) || 0.5);
  if (opts.grudgePoiId && poi?.id === opts.grudgePoiId) mod += (Number(opts.grudgeWeight) || 0); // +confront / -avoid
  return Math.max(0, base + mod);
}

/**
 * Choose the next goal: score every candidate, take the top-N, pick one by
 * seeded weighted-random (variety without thrash). Returns the chosen POI +
 * its score, or null if no candidates.
 *
 * @param opts { activityKind, seedKey, topN, desirePoiId, desireWeight, grudgePoiId, grudgeWeight }
 */
export function chooseNextGoal(npc, needs, pois, opts = {}) {
  if (!Array.isArray(pois) || pois.length === 0) return null;
  const scored = pois
    .map((poi) => ({ poi, score: scoreGoal(npc, needs, poi, opts) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;

  const topN = Math.max(1, Math.min(Number(opts.topN) || 3, scored.length));
  const top = scored.slice(0, topN);
  const total = top.reduce((a, s) => a + s.score, 0);
  // Seeded weighted pick among the top-N.
  const roll = seededUnit(`${opts.seedKey ?? npc?.id ?? "x"}|goal`) * total;
  let acc = 0;
  for (const s of top) { acc += s.score; if (roll <= acc) return { poi: s.poi, score: s.score }; }
  return { poi: top[0].poi, score: top[0].score };
}

export const UTILITY_CONSTANTS = Object.freeze({ ARCHETYPE_WEIGHTS, BLOCK_AFFINITY });
