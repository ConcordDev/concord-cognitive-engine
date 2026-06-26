// Shared server-authoritative combat ceilings. Single source of truth for the
// HTTP combat route (routes/worlds.js) AND the socket PvP path (server.js), so
// the two can't drift. The socket `combat:attack` handler previously trusted the
// client `baseDamage` with only armor mitigation — a modified client could send
// baseDamage:1e9 and one-shot any player — while the HTTP route was capped.
// These bound both paths to the same ceiling.

export const COMBAT_MAX_REACH_M      = Number(process.env.CONCORD_COMBAT_MAX_REACH_M)      || 80;  // ranged ceiling (m)
export const COMBAT_MELEE_REACH_M    = Number(process.env.CONCORD_COMBAT_MELEE_REACH_M)    || 3;   // melee threshold (m)
export const COMBAT_DAMAGE_HARD_CAP  = Number(process.env.CONCORD_COMBAT_DAMAGE_HARD_CAP)  || 500; // absolute per-hit cap
export const COMBAT_DAMAGE_CRIT_MULT = Number(process.env.CONCORD_COMBAT_DAMAGE_CRIT_MULT) || 2.5; // crit scaling

/**
 * Bound a (possibly client-supplied) base damage to a sane input ceiling before
 * it reaches damage resolution. Uses the attacker's authored skill `max_damage`
 * when known, else the hard cap. Non-finite / negative inputs floor to 1.
 *
 * @param {number} requested   client-declared base damage
 * @param {number} [skillMax]  attacker skill's max_damage (0/undefined → hard cap)
 * @returns {number} a finite base damage in [1, ceiling]
 */
export function clampBaseDamage(requested, skillMax = 0) {
  const ceiling = (Number(skillMax) > 0 ? Number(skillMax) : COMBAT_DAMAGE_HARD_CAP);
  const r = Number(requested);
  if (!Number.isFinite(r) || r <= 0) return 1;
  return Math.min(r, ceiling);
}

/**
 * Absolute per-hit damage ceiling for the resolved (post-crit) damage. Passed
 * into applyAttack as `maxDamage` so the final number can never exceed the cap
 * regardless of input, variance, or crit. Mirrors the HTTP route's
 * `skill.max_damage * CRIT_MULT` (or hard cap) ceiling.
 *
 * @param {number} [skillMax] attacker skill's max_damage
 * @returns {number}
 */
export function resolvedDamageCap(skillMax = 0) {
  return Number(skillMax) > 0
    ? Number(skillMax) * COMBAT_DAMAGE_CRIT_MULT
    : COMBAT_DAMAGE_HARD_CAP;
}
