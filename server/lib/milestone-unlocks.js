// Content pillar 3 — immutable milestone unlocks. When a player completes a
// legendary task, grantUnlock stamps a permanent record keyed by a deterministic
// ref_id, so the unlock survives restart and can't be double-granted by a replay
// or re-claim (ON CONFLICT(ref_id) DO NOTHING — the economy-ledger idempotency
// pattern). Reads are cheap helpers the loadout/UI consults.
//
// Pure-ish: all DB access is try/catch'd so a minimal build without the table
// degrades to "no unlocks" rather than crashing a quest-claim.

import crypto from "node:crypto";

function tableExists(db) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='player_milestone_unlocks'").get(); }
  catch { return false; }
}

/**
 * Stamp an immutable unlock. `refId` MUST be deterministic for the milestone
 * (e.g. `quest:${questId}:${userId}:${key}`) so re-claiming is a no-op.
 * @returns {{ ok, granted?, alreadyHad?, reason? }}
 */
export function grantUnlock(db, { userId, kind, key, amount = null, source = null, refId }) {
  if (!db || !userId || !kind || !key || !refId) return { ok: false, reason: "missing_fields" };
  if (!tableExists(db)) return { ok: false, reason: "no_table" };
  try {
    const r = db.prepare(`
      INSERT INTO player_milestone_unlocks (id, user_id, kind, unlock_key, amount, source, ref_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ref_id) DO NOTHING
    `).run(crypto.randomUUID(), userId, kind, key, amount, source, refId);
    return r.changes === 1
      ? { ok: true, granted: true }
      : { ok: true, granted: false, alreadyHad: true };
  } catch (e) {
    return { ok: false, reason: e?.message || "db_error" };
  }
}

/** True if the player holds an unlock of (kind, key). */
export function hasUnlock(db, userId, kind, key) {
  if (!db || !userId || !tableExists(db)) return false;
  try {
    return !!db.prepare(
      "SELECT 1 FROM player_milestone_unlocks WHERE user_id = ? AND kind = ? AND unlock_key = ? LIMIT 1"
    ).get(userId, kind, key);
  } catch { return false; }
}

/** All of a player's unlocks (optionally filtered by kind). */
export function listUnlocks(db, userId, kind = null) {
  if (!db || !userId || !tableExists(db)) return [];
  try {
    return kind
      ? db.prepare("SELECT * FROM player_milestone_unlocks WHERE user_id = ? AND kind = ? ORDER BY unlocked_at").all(userId, kind)
      : db.prepare("SELECT * FROM player_milestone_unlocks WHERE user_id = ? ORDER BY unlocked_at").all(userId);
  } catch { return []; }
}
