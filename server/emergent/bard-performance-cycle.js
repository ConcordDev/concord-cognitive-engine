// server/emergent/bard-performance-cycle.js
//
// Wave D / D1 — bards perform legends to nearby NPCs. Each bard's
// highest-severity legend in their repertoire is sung; listeners
// within 25m get an opinion delta toward the legend's subject scaled
// by the legend's sentiment.
//
// Heartbeat invariant: never throws.
// Kill switch: CONCORD_BARD_PERFORMANCE=0.

import logger from "../logger.js";

const MAX_BARDS_PER_PASS = 12;
const LISTENING_RADIUS_M = 25;
const PERFORMANCE_COOLDOWN_S = 600;  // 10min between performances per bard
const OPINION_DELTA_PER_SENTIMENT = 8; // sentiment=-1 → -8 opinion delta on listeners

export async function runBardPerformanceCycle({ db } = {}) {
  if (process.env.CONCORD_BARD_PERFORMANCE === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let bards = [];
  try {
    bards = db.prepare(`
      SELECT DISTINCT br.bard_npc_id
      FROM bard_repertoire br
      LEFT JOIN world_npcs n ON n.id = br.bard_npc_id
      WHERE COALESCE(n.is_dead, 0) = 0
        AND (br.last_performed_at IS NULL OR br.last_performed_at < ?)
      LIMIT ?
    `).all(Math.floor(Date.now() / 1000) - PERFORMANCE_COOLDOWN_S, MAX_BARDS_PER_PASS);
  } catch {
    return { ok: true, reason: "no_repertoire_table", performed: 0 };
  }
  if (bards.length === 0) return { ok: true, performed: 0 };

  const stats = { ok: true, evaluated: bards.length, performed: 0, listenersTouched: 0, errored: 0 };

  for (const { bard_npc_id: bardId } of bards) {
    try {
      // Pick the highest-severity legend in this bard's repertoire.
      const legend = db.prepare(`
        SELECT l.* FROM bard_repertoire br
        JOIN world_legends l ON l.id = br.legend_id
        WHERE br.bard_npc_id = ?
        ORDER BY l.severity DESC, l.composed_at DESC
        LIMIT 1
      `).get(bardId);
      if (!legend) continue;

      // Bard position.
      const bard = db.prepare(`SELECT id, world_id, x, z FROM world_npcs WHERE id = ?`).get(bardId);
      if (!bard) continue;

      // Listeners: other NPCs within radius.
      const listeners = db.prepare(`
        SELECT id FROM world_npcs
        WHERE world_id = ? AND id != ?
          AND COALESCE(is_dead, 0) = 0
          AND ((x - ?) * (x - ?) + (z - ?) * (z - ?)) <= (? * ?)
        LIMIT 30
      `).all(bard.world_id, bardId, bard.x ?? 0, bard.x ?? 0, bard.z ?? 0, bard.z ?? 0,
            LISTENING_RADIUS_M, LISTENING_RADIUS_M);

      let propagated = 0;
      if (listeners.length > 0) {
        const { recordOpinionEvent } = await import("../lib/npc-opinions.js");
        const delta = legend.sentiment * OPINION_DELTA_PER_SENTIMENT;
        for (const l of listeners) {
          try {
            recordOpinionEvent?.(db, {
              npcId: l.id,
              targetKind: legend.subject_kind,
              targetId: legend.subject_id,
            }, delta, `bard_legend:${legend.id}`);
            propagated++;
          } catch { /* ok */ }
        }
      }

      // Mark performed.
      db.prepare(`
        UPDATE bard_repertoire
        SET performed_count = performed_count + 1, last_performed_at = unixepoch()
        WHERE bard_npc_id = ? AND legend_id = ?
      `).run(bardId, legend.id);

      // Realtime — a BardSongOverlay in the player's client picks it up
      // when the player is within radius.
      try {
        globalThis._concordRealtimeEmit?.("bard:performance", {
          worldId: bard.world_id,
          bardId,
          legendId: legend.id,
          legendTitle: legend.title,
          legendBody: legend.body,
          subjectKind: legend.subject_kind,
          subjectId: legend.subject_id,
          sentiment: legend.sentiment,
          position: { x: bard.x ?? 0, z: bard.z ?? 0 },
          listenerCount: listeners.length,
        });
      } catch { /* ok */ }

      stats.performed++;
      stats.listenersTouched += propagated;
    } catch (err) {
      stats.errored++;
      logger?.warn?.("bard-performance-cycle", "bard_failed", { bardId, error: err?.message });
    }
  }

  return stats;
}
