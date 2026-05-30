// server/lib/friend-presence.js
//
// Joins the friendship graph with the city-presence runtime so the user
// can see at a glance: "Alex is in cyber right now" + "click join".
//
// Pure function — no caching beyond what city-presence already has.

import { listFriends } from "./friendships.js";
import { getUserPosition } from "./city-presence.js";
import { getActiveTitlesForUsers } from "./player-titles.js";

/**
 * @param {object} db
 * @param {string} userId
 * @returns {Array<{ friendUserId, online: boolean, worldId?: string, since?: number, friendshipId: string }>}
 */
export function getFriendsPresence(db, userId) {
  const friends = listFriends(db, userId);
  return friends.map(f => {
    const pos = getUserPosition(f.friendUserId);
    if (!pos) {
      return {
        friendUserId: f.friendUserId,
        friendshipId: f.friendshipId,
        online: false,
        since: f.since,
      };
    }
    return {
      friendUserId: f.friendUserId,
      friendshipId: f.friendshipId,
      online: true,
      worldId: pos.worldId || null,
      cityId: pos.cityId || null,
      districtId: pos.districtId || null,
      lastUpdate: pos.lastUpdate,
      since: f.since,
    };
  });
}

/**
 * Resolve a list of user_ids to display names — used by the friends
 * panel so the UI shows "Alex" instead of "user_abc123". Falls back to
 * the truncated id if no display name is set.
 *
 * @returns {Record<string, { displayName: string, avatarId?: string }>}
 */
export function resolveUserDisplay(db, userIds) {
  const out = {};
  if (!Array.isArray(userIds) || userIds.length === 0) return out;
  try {
    const placeholders = userIds.map(() => "?").join(",");
    const rows = db.prepare(`
      SELECT id, COALESCE(display_name, username, id) AS displayName
      FROM users WHERE id IN (${placeholders})
    `).all(...userIds);
    for (const r of rows) {
      out[r.id] = { displayName: r.displayName };
    }
  } catch { /* users table shape may vary */ }
  for (const id of userIds) {
    if (!out[id]) out[id] = { displayName: id.slice(0, 8) };
  }
  // Phase U3 — also attach active title so the friends panel renders
  // "Marcus the Healer" instead of just "Marcus".
  try {
    const titles = getActiveTitlesForUsers(db, userIds);
    for (const id of userIds) {
      if (titles[id]) out[id].activeTitle = titles[id];
    }
  } catch { /* title lookup best-effort */ }
  // Universal Move System — opt-in verified-human badge (display = verified AND
  // opted to show). Goes through this resolver like titles (never queried direct
  // from the frontend). Best-effort: column may not exist on minimal DBs.
  try {
    const ph = userIds.map(() => "?").join(",");
    const rows = db.prepare(
      `SELECT id, verified_human, badge_visible FROM users WHERE id IN (${ph})`
    ).all(...userIds);
    const on = process.env.CONCORD_VERIFIED_HUMAN_BADGE !== "0";
    for (const r of rows) {
      if (on && r.verified_human && r.badge_visible && out[r.id]) out[r.id].verifiedHuman = true;
    }
  } catch { /* column absent / badge disabled — omit silently (default state) */ }
  return out;
}
