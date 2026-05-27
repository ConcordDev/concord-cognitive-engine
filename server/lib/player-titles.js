// server/lib/player-titles.js
//
// Phase U3 — title equip / unequip / list. The `player_titles` table
// (migration 192) records earned titles; `users.active_title_id`
// (migration 217) tracks which one is currently displayed.

import logger from "../logger.js";

export function equipTitle(db, userId, titleId) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  // Either titleId or the title text — accept both. Find a matching
  // row in player_titles for this user.
  try {
    const row = titleId
      ? db.prepare(`SELECT id, title FROM player_titles WHERE user_id = ? AND (id = ? OR title = ?) LIMIT 1`).get(userId, titleId, titleId)
      : null;
    if (!row) return { ok: false, error: "title_not_owned" };
    db.prepare(`UPDATE users SET active_title_id = ? WHERE id = ?`).run(row.id, userId);
    return { ok: true, titleId: row.id, title: row.title };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function unequipTitle(db, userId) {
  if (!db || !userId) return { ok: false, error: "missing_inputs" };
  try {
    db.prepare(`UPDATE users SET active_title_id = NULL WHERE id = ?`).run(userId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

export function listOwnedTitles(db, userId) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, title, world_id AS worldId, earned_at AS earnedAt
      FROM player_titles WHERE user_id = ?
      ORDER BY earned_at DESC
    `).all(userId);
  } catch {
    return [];
  }
}

export function getActiveTitle(db, userId) {
  if (!db || !userId) return null;
  try {
    const r = db.prepare(`
      SELECT pt.id, pt.title, pt.world_id AS worldId, pt.earned_at AS earnedAt
      FROM users u
      JOIN player_titles pt ON pt.id = u.active_title_id
      WHERE u.id = ?
    `).get(userId);
    return r || null;
  } catch {
    return null;
  }
}

/**
 * Bulk lookup — used by friend-presence to resolve a list of user-ids
 * to their active titles in one query.
 */
export function getActiveTitlesForUsers(db, userIds) {
  if (!db || !Array.isArray(userIds) || userIds.length === 0) return {};
  const out = {};
  try {
    const placeholders = userIds.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT u.id AS userId, pt.title
      FROM users u
      LEFT JOIN player_titles pt ON pt.id = u.active_title_id
      WHERE u.id IN (${placeholders}) AND pt.title IS NOT NULL
    `).all(...userIds);
    for (const r of rows) out[r.userId] = r.title;
  } catch (err) {
    logger.debug?.("player-titles", "bulk_lookup_failed", { error: err?.message });
  }
  return out;
}
