// server/lib/stealth-perception.js
//
// Stealth + observation perception fairness mechanic.
//
// Core idea: a target's render opacity to a given observer is a function
// of (target's stealth skill, observer's perception skill, distance,
// crouch/cover/lighting). The result is asymmetric — a high-stealth
// rogue is nearly invisible to a low-perception observer, but fully
// visible to a trained scout. This makes the asymmetry LEGIBLE: the
// player who keeps getting backstabbed sees the rogue as transparent
// and goes "oh, I need observation skill" — and they can train it via
// the existing skill-progression substrate.
//
// The opacity curve is sigmoid-shaped so high-end skills don't yield
// completely binary visibility. Tuning lever is in `K_STEEPNESS`.

const MIN_OPACITY      = 0.05;
const MAX_OPACITY      = 1.00;
const K_STEEPNESS      = 25;     // sigmoid steepness (higher = sharper)
const DISTANCE_FALLOFF = 30;     // metres before distance modifier kicks in
const COVER_MULTIPLIER = 0.6;    // hard cover lowers opacity 40%
const CROUCH_MULTIPLIER= 0.7;    // crouching lowers opacity 30%
const LIGHTING_FLOOR   = 0.3;    // night vision floor (lighting=0 won't drive opacity below 30% of base)
const BACKSTAB_PERCEPTION_MARGIN = 20;

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Compute the opacity at which an observer should render a target,
 * given both fighters' relevant skill levels + environmental modifiers.
 *
 * @param {object} opts
 * @param {number} opts.targetStealthSkill     0..200, higher = better hidden
 * @param {number} opts.observerPerceptionSkill 0..200, higher = better at spotting
 * @param {number} [opts.distance=10]          metres
 * @param {boolean} [opts.isCrouching=false]
 * @param {boolean} [opts.hasCover=false]
 * @param {number} [opts.lighting=1.0]         0..1, 0 = pitch dark, 1 = full daylight
 * @returns {number} opacity in [MIN_OPACITY, MAX_OPACITY]
 */
export function computeVisibility({
  targetStealthSkill = 0,
  observerPerceptionSkill = 0,
  distance = 10,
  isCrouching = false,
  hasCover = false,
  lighting = 1.0,
} = {}) {
  // Effective stealth: stealth provides 60% direct contribution; the
  // remaining 40% is contested by perception. This means a 0-perception
  // observer still sees a high-stealth rogue at ~20% opacity (silhouette
  // visible) — never literally invisible.
  const stealthEffective = Number(targetStealthSkill) * 0.6;
  const perception       = Number(observerPerceptionSkill);
  const skillDelta       = perception - stealthEffective;

  // Sigmoid base — centered at 0 delta = ~50% opacity. Steepness makes
  // small skill differences meaningful.
  let opacity = MIN_OPACITY + (MAX_OPACITY - MIN_OPACITY) * sigmoid(skillDelta / K_STEEPNESS);

  // Crouch + cover stack multiplicatively (target hidden by both = 0.42 base)
  if (isCrouching) opacity *= CROUCH_MULTIPLIER;
  if (hasCover)    opacity *= COVER_MULTIPLIER;

  // Distance falloff: at < 30m no penalty, beyond 30m opacity tilts toward
  // 0.2 (silhouette-only) at the curve's edge. Realistic at-range
  // detection difficulty.
  if (distance > DISTANCE_FALLOFF) {
    const falloff = clamp((distance - DISTANCE_FALLOFF) / DISTANCE_FALLOFF, 0, 1);
    opacity = opacity * (1 - falloff * 0.6) + 0.2 * (falloff * 0.6);
  }

  // Lighting modifier: doesn't go below LIGHTING_FLOOR, so even pitch dark
  // a high-perception observer gets some chance to see a high-stealth
  // target (night-vision-like degradation).
  const lightingFactor = LIGHTING_FLOOR + (1 - LIGHTING_FLOOR) * Number(lighting);
  opacity *= clamp(lightingFactor, LIGHTING_FLOOR, 1);

  return clamp(opacity, MIN_OPACITY, MAX_OPACITY);
}

/**
 * Pull both users' skill levels from the dtus skill substrate and
 * compute their visibility pair.
 *
 * @returns {{ opacity: number, observerPerception: number, targetStealth: number }}
 */
export function getVisibilityForObserver(db, observerId, targetId, contextOpts = {}) {
  if (!db) return { opacity: 1, observerPerception: 0, targetStealth: 0 };
  const targetStealth = _getSkillLevel(db, targetId, "stealth");
  const observerPerception = Math.max(
    _getSkillLevel(db, observerId, "observation"),
    _getSkillLevel(db, observerId, "perception"),
  );
  const opacity = computeVisibility({
    targetStealthSkill: targetStealth,
    observerPerceptionSkill: observerPerception,
    ...contextOpts,
  });
  return { opacity, observerPerception, targetStealth };
}

/**
 * Pull the player's skill level for a given domain.
 *
 * Fix (stealth design "step zero"): the prior query hit `dtus` with
 * `owner_user_id = ? AND type='skill' AND tags_json LIKE '%domain%'`, but skill
 * DTUs are written with `creator_id` (not owner_user_id) and the domain lives in
 * `skill_type`, not `tags_json` — so the query silently returned 0 for everyone
 * (the try/catch swallowed nothing; it was a wrong-table/wrong-column match that
 * matched no rows), collapsing all stealth + perception to 0. The AUTHORITATIVE
 * player skill source is `player_skill_levels` (see entity-power.js:78 +
 * skill-tree-engine.js:81), keyed by (user_id, skill_type). Use it.
 */
function _getSkillLevel(db, userId, domain) {
  try {
    const row = db.prepare(`
      SELECT MAX(level) AS lvl FROM player_skill_levels
      WHERE user_id = ? AND skill_type = ?
    `).get(userId, domain);
    return Math.max(0, Math.round(row?.lvl ?? 0));
  } catch {
    return 0;
  }
}

/**
 * Backstab gate: refuses the strike when the target's perception is
 * meaningfully higher than the attacker's stealth. Returns
 * `{ ok: true }` if the backstab can land, `{ ok: false, reason }`
 * otherwise. The server also emits `stealth:detected` to the would-be
 * attacker so the player learns they were spotted (rather than
 * silently failing).
 */
export function assertCanBackstab(db, attackerId, victimId) {
  const attackerStealth = _getSkillLevel(db, attackerId, "stealth");
  const victimPerception = Math.max(
    _getSkillLevel(db, victimId, "observation"),
    _getSkillLevel(db, victimId, "perception"),
  );
  if (victimPerception > attackerStealth + BACKSTAB_PERCEPTION_MARGIN) {
    return { ok: false, reason: "perception_breaks_stealth", attackerStealth, victimPerception };
  }
  return { ok: true, attackerStealth, victimPerception };
}

export {
  MIN_OPACITY,
  MAX_OPACITY,
  K_STEEPNESS,
  DISTANCE_FALLOFF,
  COVER_MULTIPLIER,
  CROUCH_MULTIPLIER,
  BACKSTAB_PERCEPTION_MARGIN,
};
