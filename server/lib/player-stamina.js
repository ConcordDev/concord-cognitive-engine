// server/lib/player-stamina.js
//
// Concordia Phase 5 — player stamina lib.
//
// Per-(user, world) clock-derived stamina. On every read we apply
// (state, last_update) → projected value, then optionally clamp +
// transition. No heartbeat — the lazy-clock pattern keeps the table
// tiny and writes are only on state changes / explicit drains.
//
// Drain / regen rates (per second):
//   rest:        +5.0
//   climbing:    -1.0
//   sprinting:   -1.5
//   swimming:    -0.6
//   exhausted:   +2.5   (recovery is slower than rest)
//
// Floor: 0; when value hits 0 in a draining state, transition to
// 'exhausted'. Exhausted clears to 'rest' once value ≥ 25.
//
// Caller patterns:
//   - climb start: setState(user, world, 'climbing') — drains while held
//   - climb release: setState(user, world, 'rest')
//   - sprint start / release: same pattern
//
// We also support explicit `drain(user, world, amount)` for one-shot
// costs (a jump, a power-cast).

import logger from "../logger.js";

const REGEN_REST       = 5.0;
const DRAIN_CLIMBING   = 1.0;
const DRAIN_SPRINTING  = 1.5;
const DRAIN_SWIMMING   = 0.6;
const REGEN_EXHAUSTED  = 2.5;
const EXHAUSTED_RECOVERY_AT = 25;

const VALID_STATES = new Set(["rest", "climbing", "sprinting", "swimming", "exhausted"]);

function rateFor(state) {
  switch (state) {
    case "climbing":  return -DRAIN_CLIMBING;
    case "sprinting": return -DRAIN_SPRINTING;
    case "swimming":  return -DRAIN_SWIMMING;
    case "exhausted": return REGEN_EXHAUSTED;
    case "rest":
    default:          return REGEN_REST;
  }
}

function ensureRow(db, userId, worldId) {
  db.prepare(`
    INSERT INTO player_stamina (user_id, world_id)
    VALUES (?, ?)
    ON CONFLICT(user_id, world_id) DO NOTHING
  `).run(userId, worldId);
}

/**
 * Project stamina forward based on (state, last_update, now). Returns
 * the new value clamped [0, max_value] + a transition signal when the
 * value crosses a clock boundary (drain → exhausted, exhausted →
 * rest).
 */
function projectValue(row, nowSeconds) {
  const elapsed = Math.max(0, nowSeconds - row.last_update);
  const projected = row.value + rateFor(row.state) * elapsed;
  const max = row.max_value || 100;
  const clamped = Math.max(0, Math.min(max, projected));
  let nextState = row.state;
  if (clamped <= 0 && (row.state === "climbing" || row.state === "sprinting" || row.state === "swimming")) {
    nextState = "exhausted";
  } else if (clamped >= EXHAUSTED_RECOVERY_AT && row.state === "exhausted") {
    nextState = "rest";
  }
  return { value: clamped, state: nextState };
}

/**
 * Read current stamina with lazy projection applied. Persists any
 * state transition the projection induced.
 */
export function getStamina(db, userId, worldId = "concordia-hub") {
  if (!db || !userId) return null;
  ensureRow(db, userId, worldId);
  const row = db.prepare(`
    SELECT user_id, world_id, value, max_value, last_update, state
    FROM player_stamina WHERE user_id = ? AND world_id = ?
  `).get(userId, worldId);
  if (!row) return null;
  const now = Math.floor(Date.now() / 1000);
  const proj = projectValue(row, now);
  if (proj.state !== row.state || Math.abs(proj.value - row.value) >= 0.5) {
    db.prepare(`
      UPDATE player_stamina
      SET value = ?, state = ?, last_update = ?
      WHERE user_id = ? AND world_id = ?
    `).run(proj.value, proj.state, now, userId, worldId);
  }
  return { ...row, ...proj, last_update: now };
}

/**
 * Set the activity state. Persists projected stamina (so the player
 * doesn't get free credit by toggling state). Refuses to enter a
 * draining state from exhausted (must rest first).
 */
export function setState(db, userId, worldId, newState) {
  if (!db || !userId || !newState) return { ok: false, reason: "missing_inputs" };
  if (!VALID_STATES.has(newState)) return { ok: false, reason: "bad_state" };
  ensureRow(db, userId, worldId);
  const row = getStamina(db, userId, worldId);
  if (!row) return { ok: false, reason: "no_row" };
  if (row.state === "exhausted" && (newState === "climbing" || newState === "sprinting")) {
    return { ok: false, reason: "exhausted", value: row.value };
  }
  const now = Math.floor(Date.now() / 1000);
  try {
    db.prepare(`
      UPDATE player_stamina
      SET state = ?, last_update = ?
      WHERE user_id = ? AND world_id = ?
    `).run(newState, now, userId, worldId);
    return { ok: true, action: "set_state", state: newState, value: row.value };
  } catch (err) {
    try { logger.warn?.("stamina_set_state_failed", { userId, error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: "update_failed" };
  }
}

/**
 * One-shot drain (a jump, cast cost, etc.). Refuses if value < cost.
 */
export function drain(db, userId, worldId, amount) {
  if (!db || !userId || !Number.isFinite(amount) || amount <= 0) return { ok: false, reason: "missing_inputs" };
  const row = getStamina(db, userId, worldId);
  if (!row) return { ok: false, reason: "no_row" };
  if (row.value < amount) return { ok: false, reason: "insufficient", value: row.value };
  const next = row.value - amount;
  const nextState = next <= 0 ? "exhausted" : row.state;
  db.prepare(`
    UPDATE player_stamina
    SET value = ?, state = ?, last_update = unixepoch()
    WHERE user_id = ? AND world_id = ?
  `).run(next, nextState, userId, worldId);
  return { ok: true, action: "drained", value: next, state: nextState };
}

/** Test / restore helper. Resets to full. */
export function resetStamina(db, userId, worldId) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  ensureRow(db, userId, worldId);
  db.prepare(`
    UPDATE player_stamina
    SET value = max_value, state = 'rest', last_update = unixepoch()
    WHERE user_id = ? AND world_id = ?
  `).run(userId, worldId);
  return { ok: true, action: "reset" };
}

export const STAMINA_CONSTANTS = Object.freeze({
  REGEN_REST, DRAIN_CLIMBING, DRAIN_SPRINTING, DRAIN_SWIMMING,
  REGEN_EXHAUSTED, EXHAUSTED_RECOVERY_AT, VALID_STATES: Array.from(VALID_STATES),
});
