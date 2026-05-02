// server/lib/world-travel.js
// World-travel substrate. Reads/writes users.current_world (migration 077),
// validates destination against the registered world set (cross-world-
// effectiveness registry), and writes an audit row to user_world_travel_log.
//
// Travel is gated to known worlds. The hub ("concordia") is always allowed.
// All other worlds must have been registered by the content-seeder via a
// meta.json file. Unknown destinations are rejected.
//
// Anchor validation is best-effort: if an anchor_id is supplied we verify it
// belongs to the destination world, but worlds without authored anchors
// (e.g. brand-new user-created worlds) skip the anchor check.

import crypto from "crypto";
import { listKnownWorlds, getWorldMeta } from "./cross-world-effectiveness.js";

export const HUB_WORLD = "concordia";

export function getCurrentWorld(db, userId) {
  if (!userId) return HUB_WORLD;
  try {
    const row = db.prepare(`SELECT current_world FROM users WHERE id = ?`).get(userId);
    return row?.current_world || HUB_WORLD;
  } catch {
    return HUB_WORLD;
  }
}

/**
 * Travel a user to a destination world. Atomic: updates users.current_world
 * and inserts a user_world_travel_log row in a single transaction.
 *
 * @returns {{ ok: true, fromWorld, toWorld, travelId }} on success
 *          {{ ok: false, reason }} on failure
 */
export function travelTo(db, userId, toWorld, { anchorId = null } = {}) {
  if (!userId) return { ok: false, reason: "no_user" };
  if (!toWorld || typeof toWorld !== "string") return { ok: false, reason: "no_destination" };

  const known = new Set([HUB_WORLD, ...listKnownWorlds()]);
  if (!known.has(toWorld)) return { ok: false, reason: "unknown_world" };

  const fromWorld = getCurrentWorld(db, userId);
  if (fromWorld === toWorld) {
    return { ok: true, fromWorld, toWorld, travelId: null, noop: true };
  }

  if (anchorId) {
    try {
      const anchor = db.prepare(`SELECT world_id FROM concord_link_anchors WHERE id = ?`).get(anchorId);
      if (anchor && anchor.world_id !== toWorld) {
        return { ok: false, reason: "anchor_mismatch" };
      }
    } catch { /* anchor validation best-effort */ }
  }

  const travelId = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);

  const tx = db.transaction(() => {
    db.prepare(`UPDATE users SET current_world = ? WHERE id = ?`).run(toWorld, userId);
    db.prepare(`
      INSERT INTO user_world_travel_log (id, user_id, from_world, to_world, anchor_id, traveled_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(travelId, userId, fromWorld, toWorld, anchorId, now);
  });
  try { tx(); }
  catch (_e) { return { ok: false, reason: "travel_failed" }; }

  return { ok: true, fromWorld, toWorld, travelId };
}

export function listAvailableWorlds() {
  const ids = new Set([HUB_WORLD, ...listKnownWorlds()]);
  const out = [];
  for (const id of ids) {
    const meta = getWorldMeta(id);
    out.push({
      world_id: id,
      name: meta?.name ?? id,
      description: meta?.description ?? null,
      tagline: meta?.tagline ?? null,
      is_hub: id === HUB_WORLD,
      skill_affinity: meta?.skill_affinity ?? null,
    });
  }
  return out;
}

export function listRecentTravel(db, userId, { limit = 20 } = {}) {
  try {
    return db.prepare(`
      SELECT id, from_world, to_world, anchor_id, traveled_at
      FROM user_world_travel_log
      WHERE user_id = ?
      ORDER BY traveled_at DESC
      LIMIT ?
    `).all(userId, Math.max(1, Math.min(100, Number(limit) || 20)));
  } catch {
    return [];
  }
}
