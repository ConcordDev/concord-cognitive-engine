// server/lib/foundry/skill-affinity.js
//
// Foundry Phase 7 — per-player skill learning.
//
// Distinct from the existing per-WORLD skill_affinity modulator (a
// world saying "magic is 1.5x potent here"). This is per-PLAYER: a
// skill you use heavily grows YOUR personal affinity with it, and that
// affinity travels with you across worlds. It decays when unused.
//
// The world's skill-affinity-player system config carries learnRate /
// decayWhenUnused / crossWorldCarry. Effective potency is the product
// of the per-player affinity and the per-world modulator.

const DEFAULT_CONFIG = Object.freeze({
  learnRate: 100,        // % — 100 = baseline gain per use
  decayWhenUnused: true,
  crossWorldCarry: true,
});

const BASE_GAIN_PER_USE = 0.015;   // affinity points per use at 100% learnRate
const MAX_AFFINITY = 3.0;          // 3x personal potency ceiling
const MIN_AFFINITY = 0.5;          // never decays below half
const DECAY_PER_DAY = 0.02;        // idle decay, applied lazily on read
const DAY_MS = 24 * 60 * 60 * 1000;

function cfg(c) {
  return { ...DEFAULT_CONFIG, ...(c && typeof c === "object" ? c : {}) };
}

/**
 * Record a use of a skill by a player — grows their personal affinity.
 * @returns {{ ok, skillId, affinity, uses }}
 */
export function recordSkillUse(db, userId, skillId, worldConfig) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId || !skillId) return { ok: false, reason: "missing_args" };
  const c = cfg(worldConfig);
  const now = Date.now();
  const row = db.prepare(`SELECT affinity, uses FROM player_skill_affinity WHERE user_id = ? AND skill_id = ?`)
    .get(userId, skillId);

  const gain = BASE_GAIN_PER_USE * (c.learnRate / 100);
  const prior = row ? row.affinity : 1.0;
  const affinity = Math.min(MAX_AFFINITY, prior + gain);
  const uses = (row ? row.uses : 0) + 1;

  db.prepare(`
    INSERT INTO player_skill_affinity (user_id, skill_id, affinity, uses, last_used_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, skill_id) DO UPDATE SET
      affinity = excluded.affinity, uses = excluded.uses, last_used_at = excluded.last_used_at
  `).run(userId, skillId, affinity, uses, now);

  return { ok: true, skillId, affinity: Number(affinity.toFixed(4)), uses };
}

/**
 * Read a player's current affinity for a skill, applying lazy idle
 * decay (when the world's config has decayWhenUnused on). Returns 1.0
 * for a skill the player has never used.
 */
export function getPlayerAffinity(db, userId, skillId, worldConfig, now = Date.now()) {
  if (!db || !userId || !skillId) return 1.0;
  const row = db.prepare(`SELECT affinity, last_used_at FROM player_skill_affinity WHERE user_id = ? AND skill_id = ?`)
    .get(userId, skillId);
  if (!row) return 1.0;
  const c = cfg(worldConfig);
  if (!c.decayWhenUnused) return Number(row.affinity.toFixed(4));
  const idleDays = Math.max(0, (now - row.last_used_at) / DAY_MS);
  const decayed = Math.max(MIN_AFFINITY, row.affinity - idleDays * DECAY_PER_DAY);
  return Number(decayed.toFixed(4));
}

/**
 * Effective potency multiplier for a skill cast: the player's personal
 * affinity combined with the per-world skill_affinity modulator. This
 * is what a combat / cast path multiplies raw skill output by.
 *
 * @param {number} playerAffinity   — from getPlayerAffinity (1.0 = none)
 * @param {number} worldAffinityPct — rule_modulators.skill_affinity[domain]
 *                                    as a percent (100 = neutral)
 */
export function effectiveAffinity(playerAffinity, worldAffinityPct = 100) {
  const player = Number.isFinite(playerAffinity) ? playerAffinity : 1.0;
  const world = Number.isFinite(worldAffinityPct) ? worldAffinityPct / 100 : 1.0;
  return Number((player * world).toFixed(4));
}

export const SKILL_AFFINITY_INTERNALS = Object.freeze({
  DEFAULT_CONFIG, BASE_GAIN_PER_USE, MAX_AFFINITY, MIN_AFFINITY, DECAY_PER_DAY,
});
