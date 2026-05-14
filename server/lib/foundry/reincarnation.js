// server/lib/foundry/reincarnation.js
//
// Foundry Phase 7 — Isekai Reincarnation.
//
// On death in a world that enables this system, a character can be
// reincarnated rather than simply ending — carrying a fraction of
// their prior progress forward as an inherited boon, optionally with a
// rerolled appearance and fragmentary past-life memories.
//
// The world's isekai-reincarnation config carries enabled /
// inheritedFraction / rerollAppearance / memoryFragments. This module
// owns the per-world life ledger + the inheritance math + the
// reincarnate flow. Hooking it onto the actual death event is the
// caller's job (a world's death handler invokes reincarnate()).

import { randomUUID } from "node:crypto";

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  inheritedFraction: 20,   // % of prior progress carried forward
  rerollAppearance: true,
  memoryFragments: true,
});

function cfg(c) {
  return { ...DEFAULT_CONFIG, ...(c && typeof c === "object" ? c : {}) };
}

/**
 * Compute the inherited boon from a prior life's state. Numeric
 * progress fields (xp, level, currency, skill totals) carry forward at
 * inheritedFraction; everything else is dropped — reincarnation is a
 * fresh start with an echo, not a save-load.
 */
export function computeInheritance(priorState, worldConfig) {
  const c = cfg(worldConfig);
  const frac = Math.min(0.75, Math.max(0, c.inheritedFraction / 100));
  const prior = priorState && typeof priorState === "object" ? priorState : {};
  const inherited = {};
  for (const key of ["xp", "level", "currency", "skillPoints", "renown"]) {
    const v = Number(prior[key]);
    if (Number.isFinite(v) && v > 0) {
      // level carries as a floor (you don't lose a level to a fraction
      // of 1); the rest carry proportionally.
      inherited[key] = key === "level"
        ? Math.max(1, Math.floor(v * frac))
        : Number((v * frac).toFixed(2));
    }
  }
  return { fraction: frac, inherited };
}

/**
 * Reincarnate a player in a world. Records a new life in the ledger
 * and returns the starting state for the new life.
 * @returns {{ ok, lifeNumber, inherited, rerollAppearance, memoryFragments }}
 */
export function reincarnate(db, userId, worldId, priorState, worldConfig) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId || !worldId) return { ok: false, reason: "missing_args" };
  const c = cfg(worldConfig);
  if (c.enabled === false) return { ok: false, reason: "reincarnation_disabled" };

  const prevLives = db.prepare(
    `SELECT COUNT(*) AS n FROM reincarnations WHERE user_id = ? AND world_id = ?`,
  ).get(userId, worldId).n;
  const lifeNumber = prevLives + 2; // life 1 was the original; first reincarnation is life 2

  const { fraction, inherited } = computeInheritance(priorState, worldConfig);
  const inheritedRecord = {
    fraction,
    ...inherited,
    memoryFragments: c.memoryFragments
      ? `Fragments of life ${lifeNumber - 1} linger.`
      : null,
  };

  db.prepare(`
    INSERT INTO reincarnations (id, user_id, world_id, life_number, prior_avatar_id, inherited_json, reincarnated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `rein_${randomUUID().replace(/-/g, "").slice(0, 18)}`,
    userId, worldId, lifeNumber,
    priorState && priorState.avatarId ? String(priorState.avatarId) : null,
    JSON.stringify(inheritedRecord),
    Date.now(),
  );

  return {
    ok: true,
    lifeNumber,
    inherited: inheritedRecord,
    rerollAppearance: c.rerollAppearance !== false,
    memoryFragments: c.memoryFragments !== false,
  };
}

/** The full life ledger for a player in a world, newest life first. */
export function getLives(db, userId, worldId) {
  if (!db || !userId || !worldId) return [];
  const rows = db.prepare(`
    SELECT id, life_number, prior_avatar_id, inherited_json, reincarnated_at
    FROM reincarnations WHERE user_id = ? AND world_id = ?
    ORDER BY life_number DESC
  `).all(userId, worldId);
  return rows.map((r) => {
    let inherited;
    try { inherited = JSON.parse(r.inherited_json); } catch { inherited = {}; }
    return {
      id: r.id,
      lifeNumber: r.life_number,
      priorAvatarId: r.prior_avatar_id,
      inherited,
      reincarnatedAt: r.reincarnated_at,
    };
  });
}

export const REINCARNATION_INTERNALS = Object.freeze({ DEFAULT_CONFIG });
