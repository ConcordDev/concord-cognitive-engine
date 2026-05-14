// server/lib/foundry/size-scaling.js
//
// Foundry Phase 7 — Size Scaling (Ant-Man / Giant).
//
// Player size as a core loop. A Foundry world enables it via the
// size-scaling system; rule_modulators.size_scaling carries the
// per-world config (minScale / maxScale / smallGrantsFlight /
// largeGrantsDestruction / scaleChangeCost). This module owns the
// per-player size STATE + the gameplay-effect derivation. The 3D
// renderer scaling the avatar mesh is a frontend concern that reads
// size.get; the substrate — state, clamping, cost, effects — is here.

const DEFAULT_CONFIG = Object.freeze({
  minScale: 15, maxScale: 800,
  smallGrantsFlight: true, largeGrantsDestruction: true,
  scaleChangeCost: "stamina",
});

// Thresholds (as a % of normal size) where the small/large effects engage.
const SMALL_THRESHOLD = 60;  // <=60% counts as "small"
const LARGE_THRESHOLD = 160; // >=160% counts as "large"

function cfg(worldConfig) {
  return { ...DEFAULT_CONFIG, ...(worldConfig && typeof worldConfig === "object" ? worldConfig : {}) };
}

/** Clamp a requested scale (a percentage) into the world's bounds. */
export function clampScale(requestedPct, worldConfig) {
  const c = cfg(worldConfig);
  const n = Number(requestedPct);
  if (!Number.isFinite(n)) return 100;
  return Math.min(c.maxScale, Math.max(c.minScale, n));
}

/**
 * Derive the gameplay effects of a given scale under a world's config.
 * @returns {{ band, multiplier, canFly, canDestroy, stealthBonus, reachBonus }}
 */
export function scaleEffects(scalePct, worldConfig) {
  const c = cfg(worldConfig);
  const scale = clampScale(scalePct, worldConfig);
  const multiplier = scale / 100; // 1.0 = normal
  const band = scale <= SMALL_THRESHOLD ? "small" : scale >= LARGE_THRESHOLD ? "large" : "normal";
  return {
    band,
    scale,
    multiplier,
    // Small unlocks flight (if the world allows) + a stealth edge that
    // grows the smaller you are; large unlocks structural destruction +
    // reach that grows with size.
    canFly: band === "small" && c.smallGrantsFlight !== false,
    canDestroy: band === "large" && c.largeGrantsDestruction !== false,
    stealthBonus: band === "small" ? Number((1 - multiplier).toFixed(2)) : 0,
    reachBonus: band === "large" ? Number((multiplier - 1).toFixed(2)) : 0,
  };
}

/**
 * Combat profile at a given scale — feeds the size-scaled-combat
 * system. Small = precision/evasion; large = AoE/knockback. Damage and
 * incoming-damage scale gently with size (not linearly — a giant
 * isn't 8x tougher).
 */
export function scaledCombatProfile(scalePct, worldConfig) {
  const { band, multiplier } = scaleEffects(scalePct, worldConfig);
  if (band === "small") {
    return { band, damageMult: 0.7, incomingMult: 1.3, model: "precision", evasion: 0.35 };
  }
  if (band === "large") {
    return {
      band,
      damageMult: Number((1 + (multiplier - 1) * 0.4).toFixed(2)),
      incomingMult: Number((1 - Math.min(0.4, (multiplier - 1) * 0.15)).toFixed(2)),
      model: "aoe",
      knockback: Number(Math.min(2.0, multiplier * 0.5).toFixed(2)),
    };
  }
  return { band, damageMult: 1.0, incomingMult: 1.0, model: "balanced" };
}

/** Read a player's current scale in a world (defaults to 100%). */
export function getPlayerScale(db, userId, worldId) {
  if (!db || !userId || !worldId) return 100;
  const row = db.prepare(`SELECT scale FROM player_size WHERE user_id = ? AND world_id = ?`).get(userId, worldId);
  return row ? row.scale : 100;
}

/**
 * Set a player's scale in a world. Clamps to the world's bounds and
 * returns the resolved scale + its effects + the change cost the
 * caller should debit.
 * @returns {{ ok, scale, effects, cost }}
 */
export function setPlayerScale(db, userId, worldId, requestedPct, worldConfig) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!userId || !worldId) return { ok: false, reason: "missing_args" };
  const c = cfg(worldConfig);
  const scale = clampScale(requestedPct, worldConfig);
  const now = Date.now();
  db.prepare(`
    INSERT INTO player_size (user_id, world_id, scale, changed_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, world_id) DO UPDATE SET scale = excluded.scale, changed_at = excluded.changed_at
  `).run(userId, worldId, scale, now);
  return {
    ok: true,
    scale,
    effects: scaleEffects(scale, worldConfig),
    cost: c.scaleChangeCost, // 'free' | 'stamina' | 'cooldown' | 'item' — caller debits
  };
}

export const SIZE_SCALING_INTERNALS = Object.freeze({ DEFAULT_CONFIG, SMALL_THRESHOLD, LARGE_THRESHOLD });
