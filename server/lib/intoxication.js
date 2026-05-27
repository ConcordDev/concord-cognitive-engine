// server/lib/intoxication.js
//
// Phase X2 — blood alcohol tracking with decay.
//
// BAC scale 0..1 in this system:
//   0.0–0.1   sober
//   0.1–0.3   buzzed (dialogue options unlock)
//   0.3–0.6   drunk (combat accuracy -20%, hold-mug emote)
//   0.6+      stumbling (movement -30%, dialogue slurred)
//
// Decay: half-life of 60 minutes (matches roughly 0.015/hour real BAC).
// Each tavern drink adds 0.1 BAC.

import logger from "../logger.js";

const PER_DRINK_BAC = 0.1;
const DECAY_PER_MIN = 0.0025;  // ~0.15/hour → roughly real-world

export function getBac(db, userId) {
  if (!db || !userId) return 0;
  try {
    const row = db.prepare(`
      SELECT blood_alcohol AS bac, last_decay_at AS lastDecayAt
      FROM player_intoxication WHERE user_id = ?
    `).get(userId);
    if (!row) return 0;
    return _applyDecay(db, userId, row.bac, row.lastDecayAt);
  } catch {
    return 0;
  }
}

export function drink(db, userId, drinkStrength = 1.0) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  const inc = PER_DRINK_BAC * Math.max(0.5, Math.min(2.0, Number(drinkStrength) || 1));
  try {
    const cur = getBac(db, userId);
    const next = Math.min(1.0, cur + inc);
    db.prepare(`
      INSERT INTO player_intoxication (user_id, blood_alcohol, last_drink_at, last_decay_at)
      VALUES (?, ?, unixepoch(), unixepoch())
      ON CONFLICT(user_id) DO UPDATE SET
        blood_alcohol = ?, last_drink_at = unixepoch(), last_decay_at = unixepoch()
    `).run(userId, next, next);
    return { ok: true, bac: next, tier: getTier(next) };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function getTier(bac) {
  if (bac < 0.1) return "sober";
  if (bac < 0.3) return "buzzed";
  if (bac < 0.6) return "drunk";
  return "stumbling";
}

/** Combat damage modulator. Drunk attackers hit less hard. */
export function getCombatAccuracyMultiplier(bac) {
  if (bac < 0.1) return 1.0;
  if (bac < 0.3) return 0.95;
  if (bac < 0.6) return 0.80;
  return 0.50;
}

function _applyDecay(db, userId, currentBac, lastDecayAt) {
  if (currentBac <= 0) return 0;
  const now = Math.floor(Date.now() / 1000);
  const elapsedMin = Math.max(0, (now - (lastDecayAt || now)) / 60);
  const decayed = Math.max(0, currentBac - DECAY_PER_MIN * elapsedMin);
  if (decayed !== currentBac) {
    try {
      db.prepare(`
        UPDATE player_intoxication SET blood_alcohol = ?, last_decay_at = unixepoch()
        WHERE user_id = ?
      `).run(decayed, userId);
    } catch { /* update best-effort */ }
  }
  return decayed;
}

export { PER_DRINK_BAC, DECAY_PER_MIN };
