// server/domains/crisis.js — Phase V crisis-ops surface for the
// crisis-response game-mode lens.
//
// Macros:
//   crisis.active_for_player  — list active crises in the player's current world
//   crisis.resolve            — mark a crisis resolved by player action

import crypto from "node:crypto";

export default function registerCrisisMacros(register) {
  register("crisis", "active_for_player", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    const { worldId } = input || {};
    if (!worldId) return { ok: false, reason: "missing_world_id" };
    try {
      const rows = db.prepare(`
        SELECT id, type, description, origin_world_id, started_at
          FROM world_crises
         WHERE origin_world_id = ?
           AND (resolved_at IS NULL OR resolved_at = 0)
         ORDER BY started_at DESC
         LIMIT 25
      `).all(worldId);
      // Pull a tiny skill suggestion list for the player so the lens
      // can hint "use Frost Blast / Field Triage" — best-effort.
      let suggestions = [];
      try {
        if (userId) {
          suggestions = db.prepare(`
            SELECT skill_id, level FROM user_skills
             WHERE user_id = ? ORDER BY level DESC LIMIT 6
          `).all(userId);
        }
      } catch { /* table may not exist */ }
      return { ok: true, crises: rows, suggestions };
    } catch (err) {
      return { ok: false, reason: "query_failed", err: String(err?.message || err) };
    }
  }, { note: "List active crises in the player's current world plus skill suggestions." });

  register("crisis", "resolve", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_db_or_actor" };
    const { crisisId } = input || {};
    if (!crisisId) return { ok: false, reason: "missing_crisis_id" };
    try {
      const result = db.prepare(`
        UPDATE world_crises
           SET resolved_at = unixepoch(),
               resolved_by = ?
         WHERE id = ? AND (resolved_at IS NULL OR resolved_at = 0)
      `).run(userId, crisisId);
      if (!result.changes) return { ok: false, reason: "not_found_or_already_resolved" };
      try {
        if (globalThis?.__CONCORD_REALTIME__?.io) {
          globalThis.__CONCORD_REALTIME__.io.emit("world:crisis-resolved", { crisisId, userId });
        }
      } catch { /* sockets optional */ }
      return { ok: true, crisisId, resolvedBy: userId };
    } catch (err) {
      return { ok: false, reason: "update_failed", err: String(err?.message || err) };
    }
  }, { note: "Mark a crisis resolved by the calling player." });
}
