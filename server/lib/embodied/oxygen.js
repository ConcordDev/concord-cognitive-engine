// server/lib/embodied/oxygen.js
//
// Sprint C / Track C4 — player oxygen tracking.
//
// Caller (combat/move/dialog routes) supplies the player's current
// swim_depth in metres. tickOxygen advances the row by elapsed wall-time
// since last_breath_at, applying:
//   - submerged (depth > 0.3m): -1%/sec
//   - surface  (depth ≤ 0.3m):  +5%/sec, capped at 100
// Below 30% the lib returns suggestSignal=true so the caller can fan a
// sonic_os low-oxygen tone via signal-recording. At 0%, drowning damage
// accumulates at 1 HP / 0.5s of submerged time.

const SUBMERGED_THRESHOLD_M = 0.3;
const DECAY_RATE_PCT_PER_S = 1.0;
const REFILL_RATE_PCT_PER_S = 5.0;
const LOW_OXYGEN_THRESHOLD = 30;
const DROWN_DAMAGE_PER_S = 2;  // ~1 HP / 0.5s at 100hp scale

export function tickOxygen(db, userId, worldId, currentDepthM = 0) {
  if (!db || !userId || !worldId) return { ok: false, reason: "missing_inputs" };
  const now = Math.floor(Date.now() / 1000);

  let row = db.prepare(`
    SELECT * FROM player_oxygen WHERE user_id = ? AND world_id = ?
  `).get(userId, worldId);

  if (!row) {
    db.prepare(`
      INSERT INTO player_oxygen (user_id, world_id, oxygen_pct, last_breath_at, max_depth_explored)
      VALUES (?, ?, 100.0, ?, ?)
    `).run(userId, worldId, now, currentDepthM);
    return { ok: true, action: "init", oxygen_pct: 100.0 };
  }

  const elapsedS = Math.max(0, now - row.last_breath_at);
  const submerged = currentDepthM > SUBMERGED_THRESHOLD_M;

  let next = row.oxygen_pct;
  let damage = row.drowning_damage;

  if (submerged) {
    next = Math.max(0, row.oxygen_pct - DECAY_RATE_PCT_PER_S * elapsedS);
    if (next === 0) {
      damage += Math.floor(DROWN_DAMAGE_PER_S * elapsedS);
    }
  } else {
    next = Math.min(100, row.oxygen_pct + REFILL_RATE_PCT_PER_S * elapsedS);
  }

  const newMaxDepth = Math.max(row.max_depth_explored ?? 0, currentDepthM);
  db.prepare(`
    UPDATE player_oxygen
    SET oxygen_pct = ?, last_breath_at = ?, max_depth_explored = ?, drowning_damage = ?, updated_at = unixepoch()
    WHERE user_id = ? AND world_id = ?
  `).run(next, now, newMaxDepth, damage, userId, worldId);

  return {
    ok: true,
    oxygen_pct: next,
    submerged,
    drowning_damage_added: damage - row.drowning_damage,
    suggestSignal: submerged && next < LOW_OXYGEN_THRESHOLD,
    drowning: next === 0 && submerged,
  };
}

/** Reset on respawn / world change. */
export function resetOxygen(db, userId, worldId) {
  if (!db || !userId || !worldId) return { ok: false };
  db.prepare(`
    INSERT INTO player_oxygen (user_id, world_id, oxygen_pct, last_breath_at, max_depth_explored, drowning_damage)
    VALUES (?, ?, 100.0, unixepoch(), 0, 0)
    ON CONFLICT(user_id, world_id) DO UPDATE SET
      oxygen_pct = 100.0, last_breath_at = unixepoch(), drowning_damage = 0, updated_at = unixepoch()
  `).run(userId, worldId);
  return { ok: true };
}

export function getOxygen(db, userId, worldId) {
  if (!db || !userId || !worldId) return null;
  return db.prepare(`SELECT * FROM player_oxygen WHERE user_id = ? AND world_id = ?`).get(userId, worldId) || null;
}

export const OXYGEN_CONSTANTS = Object.freeze({
  SUBMERGED_THRESHOLD_M,
  DECAY_RATE_PCT_PER_S,
  REFILL_RATE_PCT_PER_S,
  LOW_OXYGEN_THRESHOLD,
});
