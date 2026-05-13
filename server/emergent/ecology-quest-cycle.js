// server/emergent/ecology-quest-cycle.js
//
// Phase 6 — drains ecology_imbalance_log rows into procedural quests via
// the existing lattice-quest-composer. Each unresolved imbalance row
// becomes a synthesized alert with type matching the imbalance kind
// (predator_excess / prey_collapse), and the lattice composer spawns
// the quest, picks a host NPC, and persists it.
//
// Frequency: 240 (~60 min) — slower than drift-quest cycle. Ecology
// imbalance is a slower-moving signal.
//
// Kill-switch: CONCORD_ECOLOGY_QUESTS=0.
//
// Per heartbeat invariant: never throws.

import logger from "../logger.js";

const MAX_QUESTS_PER_PASS = 4;

export async function runEcologyQuestCycle({ db, state: _state, tickCount: _t } = {}) {
  if (process.env.CONCORD_ECOLOGY_QUESTS === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let rows = [];
  try {
    rows = db.prepare(`
      SELECT * FROM ecology_imbalance_log
      WHERE resolved_at IS NULL
      ORDER BY created_at ASC
      LIMIT ?
    `).all(MAX_QUESTS_PER_PASS);
  } catch {
    return { ok: true, scanned: 0, spawned: 0, reason: "no_imbalance_table" };
  }

  if (rows.length === 0) return { ok: true, scanned: 0, spawned: 0 };

  // Lazy-import the composer so this module is cheap to load on every
  // boot even if quests aren't authored yet.
  const { spawnQuestFromAlert } = await import("../lib/lattice-quest-composer.js");

  let spawned = 0;
  for (const row of rows) {
    try {
      const alert = {
        type: row.kind,
        severity: row.severity >= 4 ? "critical" : row.severity >= 2 ? "alert" : "warning",
        message: row.summary,
        detected_at: (row.created_at || Math.floor(Date.now() / 1000)) * 1000,
        ecology_signature: row.signature,
      };
      const r = await spawnQuestFromAlert(db, alert, row.world_id);
      if (r?.ok && r.action === "inserted") {
        spawned++;
        // Mark the imbalance row resolved so we don't re-spawn each pass.
        // The actual ecology rebalance is a separate concern — fauna-spawner
        // will re-emit a fresh imbalance row if the situation persists.
        try {
          db.prepare(`
            UPDATE ecology_imbalance_log SET resolved_at = unixepoch() WHERE id = ?
          `).run(row.id);
        } catch { /* best-effort */ }
        // Emit so EmergentEventFeed surfaces the quest spawn.
        try {
          if (globalThis?.__CONCORD_REALTIME__?.io) {
            globalThis.__CONCORD_REALTIME__.io.to(`world:${row.world_id}`).emit("quest:ecology-born", {
              questId: r.questId,
              hostNpcId: r.hostNpcId,
              title: r.title,
              ecologyKind: row.kind,
              biome: row.biome,
              ts: Date.now(),
            });
          }
        } catch { /* socket emit best-effort */ }
      }
    } catch (err) {
      logger?.warn?.("ecology-quest-cycle: row failed", { id: row.id, err: err?.message });
    }
  }

  return { ok: true, scanned: rows.length, spawned };
}
