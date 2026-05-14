// server/lib/player-dynasty.js
//
// Concordia Phase 12 — player dynasty + heir takeover.
//
// A dynasty is a persistent identity that survives individual player
// avatars dying. Founding a dynasty fixes a house_name + records the
// founder. When the current_head_user_id avatar dies, an heir option
// is surfaced — the player accepts a new avatar (a fresh user record
// or a multi-avatar slot), and the dynasty's current_head_user_id is
// updated.
//
// renown accumulates from in-world reputation. Each generation, the
// previous head's renown is multiplied by a small attrition factor
// (0.7) so houses can rise or fade with their successors.

import crypto from "node:crypto";

const RENOWN_INHERITANCE_FACTOR = 0.7;

function makeDynastyId() {
  return `dyn_${crypto.randomUUID().slice(0, 16)}`;
}

/**
 * Found a new dynasty. Idempotent on founder_user_id (one dynasty
 * per founder). Returns the dynasty row.
 */
export function foundDynasty(db, founderUserId, houseName) {
  if (!db || !founderUserId || !houseName) return { ok: false, reason: "missing_inputs" };
  try {
    const existing = db.prepare(`SELECT id FROM player_dynasties WHERE founder_user_id = ?`).get(founderUserId);
    if (existing) return { ok: true, action: "exists", dynastyId: existing.id };
    const id = makeDynastyId();
    db.prepare(`
      INSERT INTO player_dynasties (id, founder_user_id, current_head_user_id, house_name)
      VALUES (?, ?, ?, ?)
    `).run(id, founderUserId, founderUserId, houseName);
    return { ok: true, action: "founded", dynastyId: id, houseName };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

export function getDynastyForUser(db, userId) {
  if (!db || !userId) return null;
  try {
    return db.prepare(`
      SELECT id, founder_user_id, current_head_user_id, house_name, renown, founded_at, generations
      FROM player_dynasties
      WHERE current_head_user_id = ? OR founder_user_id = ?
      ORDER BY (current_head_user_id = ?) DESC, founded_at DESC LIMIT 1
    `).get(userId, userId, userId) || null;
  } catch { return null; }
}

export function getDynasty(db, dynastyId) {
  if (!db || !dynastyId) return null;
  try {
    return db.prepare(`
      SELECT id, founder_user_id, current_head_user_id, house_name, renown, founded_at, generations
      FROM player_dynasties WHERE id = ?
    `).get(dynastyId) || null;
  } catch { return null; }
}

/**
 * Accept an heir — current_head_user_id dies, heir_user_id takes
 * over. Records the takeover in player_heir_takeovers. Renown
 * attrites by RENOWN_INHERITANCE_FACTOR.
 */
export function acceptHeir(db, dynastyId, heirUserId, { cause = "natural_death" } = {}) {
  if (!db || !dynastyId || !heirUserId) return { ok: false, reason: "missing_inputs" };
  const dyn = getDynasty(db, dynastyId);
  if (!dyn) return { ok: false, reason: "dynasty_not_found" };
  if (dyn.current_head_user_id === heirUserId) return { ok: false, reason: "heir_is_current_head" };
  const newRenown = Math.floor(dyn.renown * RENOWN_INHERITANCE_FACTOR);
  try {
    db.prepare(`
      INSERT INTO player_heir_takeovers (dynasty_id, predecessor_user_id, heir_user_id, cause)
      VALUES (?, ?, ?, ?)
    `).run(dynastyId, dyn.current_head_user_id, heirUserId, cause);
    db.prepare(`
      UPDATE player_dynasties
      SET current_head_user_id = ?,
          renown = ?,
          generations = generations + 1
      WHERE id = ?
    `).run(heirUserId, newRenown, dynastyId);
    return { ok: true, action: "heir_accepted", dynastyId, predecessor: dyn.current_head_user_id, heir: heirUserId, generation: dyn.generations + 1, newRenown };
  } catch (err) {
    return { ok: false, reason: "update_failed", error: err?.message };
  }
}

export function bumpRenown(db, dynastyId, delta) {
  if (!db || !dynastyId || !Number.isFinite(delta)) return { ok: false, reason: "missing_inputs" };
  const dyn = getDynasty(db, dynastyId);
  if (!dyn) return { ok: false, reason: "dynasty_not_found" };
  const next = Math.max(0, Math.min(1000, dyn.renown + Math.round(delta)));
  db.prepare(`UPDATE player_dynasties SET renown = ? WHERE id = ?`).run(next, dynastyId);
  return { ok: true, action: "renown_bumped", renown: next };
}

export function listHeirTakeoverLog(db, dynastyId) {
  if (!db || !dynastyId) return [];
  try {
    return db.prepare(`
      SELECT id, predecessor_user_id, heir_user_id, cause, taken_at
      FROM player_heir_takeovers
      WHERE dynasty_id = ?
      ORDER BY taken_at DESC LIMIT 50
    `).all(dynastyId);
  } catch { return []; }
}

export const DYNASTY_CONSTANTS = Object.freeze({
  RENOWN_INHERITANCE_FACTOR,
});
