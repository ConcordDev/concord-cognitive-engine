// server/lib/companions-mount-evo.js
//
// Concordia Procedural Mount System Phase B4 — mount evolution.
//
// Mounts gain XP from riding (gait_skill), combat (combat_skill), and
// flying (flight_skill). At threshold milestones the mount's
// `evolution_tier` increments — unlocking visual variants, unique
// finishers, and a stat-block bump.
//
// CLAUDE.md invariant: mount evolution shares the skill-evolution
// envelope semantics — the deterministic envelope curve gates how much
// any single revision can stack. LLM-mediated revisions are opt-in via
// CONCORD_MOUNT_EVO_LLM=1 (deferred to A5/B-track polish).

const TIER_THRESHOLDS = [0, 100, 500, 2000, 10_000];   // tier 0/1/2/3/4
const MAX_TIER = TIER_THRESHOLDS.length - 1;
const RIDE_XP_PER_METER     = 0.01;   // 100m of riding = +1 XP
const COMBAT_XP_PER_HIT     = 0.5;    // dealing damage while mounted
const FLIGHT_XP_PER_SECOND  = 0.5;    // sustained flight

function _readCompanion(db, mountId) {
  if (!db || !mountId) return null;
  try {
    return db.prepare(`
      SELECT id, owner_id, gait_skill, combat_skill, flight_skill, evolution_tier
      FROM player_companions WHERE id = ?
    `).get(mountId) || null;
  } catch {
    return null;
  }
}

function _tierFor(xp) {
  for (let i = MAX_TIER; i >= 0; i--) {
    if (xp >= TIER_THRESHOLDS[i]) return i;
  }
  return 0;
}

/**
 * Add XP to one of the three skill axes. Idempotent on small deltas
 * — the caller is expected to pass meaningful magnitudes (post-tick
 * accumulation, not per-frame).
 *
 * @returns {{ ok, axis, before, after, tierBefore, tierAfter, leveledUp }}
 */
export function gainSkillXp(db, args) {
  if (!db) return { ok: false, reason: "no_db" };
  const { mountId, axis, delta } = args || {};
  if (!mountId) return { ok: false, reason: "missing_mount_id" };
  if (!["gait", "combat", "flight"].includes(axis)) return { ok: false, reason: "invalid_axis" };
  const d = Number(delta);
  if (!Number.isFinite(d) || d <= 0) return { ok: false, reason: "invalid_delta" };

  const comp = _readCompanion(db, mountId);
  if (!comp) return { ok: false, reason: "mount_not_found" };

  const col = `${axis}_skill`;
  const before = Number(comp[col]) || 0;
  const after = before + d;

  const tierBefore = comp.evolution_tier || 0;
  // Aggregate tier across all three axes — use the dominant skill.
  const cols = ["gait_skill", "combat_skill", "flight_skill"];
  const totals = cols.map(c => {
    if (c === col) return after;
    return Number(comp[c]) || 0;
  });
  const dominant = Math.max(...totals);
  const tierAfter = Math.max(tierBefore, _tierFor(dominant));

  try {
    db.prepare(`
      UPDATE player_companions
      SET ${col} = ?, evolution_tier = ?
      WHERE id = ?
    `).run(after, tierAfter, mountId);
    return {
      ok: true,
      axis,
      before, after,
      tierBefore, tierAfter,
      leveledUp: tierAfter > tierBefore,
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Convenience: ride distance → gait_skill.
 */
export function gainRideDistance(db, mountId, meters) {
  if (!Number.isFinite(meters) || meters <= 0) return { ok: false, reason: "invalid_meters" };
  return gainSkillXp(db, { mountId, axis: "gait", delta: meters * RIDE_XP_PER_METER });
}

export function gainCombatHits(db, mountId, hits) {
  if (!Number.isFinite(hits) || hits <= 0) return { ok: false, reason: "invalid_hits" };
  return gainSkillXp(db, { mountId, axis: "combat", delta: hits * COMBAT_XP_PER_HIT });
}

export function gainFlightSeconds(db, mountId, seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return { ok: false, reason: "invalid_seconds" };
  return gainSkillXp(db, { mountId, axis: "flight", delta: seconds * FLIGHT_XP_PER_SECOND });
}

/**
 * Read the current evolution snapshot.
 */
export function getEvolutionState(db, mountId) {
  const comp = _readCompanion(db, mountId);
  if (!comp) return null;
  return {
    mountId,
    tier: comp.evolution_tier || 0,
    nextTier: Math.min(MAX_TIER, (comp.evolution_tier || 0) + 1),
    nextThreshold: TIER_THRESHOLDS[Math.min(MAX_TIER, (comp.evolution_tier || 0) + 1)],
    skill: {
      gait:   Number(comp.gait_skill)   || 0,
      combat: Number(comp.combat_skill) || 0,
      flight: Number(comp.flight_skill) || 0,
    },
    thresholds: TIER_THRESHOLDS.slice(),
    maxTier: MAX_TIER,
  };
}

export const _internals = { TIER_THRESHOLDS, RIDE_XP_PER_METER, COMBAT_XP_PER_HIT, FLIGHT_XP_PER_SECOND };
