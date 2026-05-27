// server/emergent/npc-bark-cycle.js
//
// Wave G2 — scans NPCs within ~8m of any player and fires occasional
// barks. Rate-limited 90s per (npc, player) via npc_player_memories.
//
// Heartbeat invariant: never throws. Kill switch: CONCORD_NPC_BARKS=0.

import logger from "../logger.js";
import {
  composeBarkContext,
  pickBarkTopic,
  composeBarkLine,
  composeBarkLineLLM,
  recordBark,
  isOnCooldown,
} from "../lib/npc-barks.js";

const PROXIMITY_M = 8;
const PROXIMITY_M2 = PROXIMITY_M * PROXIMITY_M;
const MAX_PER_PASS = 30;
const FIRE_PROBABILITY = 0.35; // even when not on cooldown, only fire 35% of opportunities

export async function runNpcBarkCycle({ db, brain } = {}) {
  if (process.env.CONCORD_NPC_BARKS === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  const stats = { ok: true, scanned: 0, fired: 0, cooldowns: 0, errored: 0 };

  // Find players currently in any world via city_presence (recent rows).
  let players = [];
  try {
    players = db.prepare(`
      SELECT user_id, world_id, x, z FROM city_presence
      WHERE updated_at > unixepoch() - 60
      LIMIT 200
    `).all();
  } catch { /* missing table — no players */ }
  if (players.length === 0) return stats;

  // For each player, find NPCs in the same world near them.
  for (const player of players) {
    if (stats.fired >= MAX_PER_PASS) break;
    let nearbyNpcs = [];
    try {
      // world_npc_xyz is the per-world live position table (Concordia
      // Phase 12). Fall back to world_npcs.x/z if missing.
      try {
        nearbyNpcs = db.prepare(`
          SELECT n.id, n.name, n.archetype, x.x, x.z FROM world_npcs n
          JOIN world_npc_xyz x ON x.npc_id = n.id
          WHERE n.world_id = ?
            AND COALESCE(n.is_dead, 0) = 0
            AND x.x BETWEEN ? AND ?
            AND x.z BETWEEN ? AND ?
          LIMIT 30
        `).all(player.world_id, player.x - PROXIMITY_M, player.x + PROXIMITY_M, player.z - PROXIMITY_M, player.z + PROXIMITY_M);
      } catch {
        nearbyNpcs = db.prepare(`
          SELECT id, name, archetype, x, z FROM world_npcs
          WHERE world_id = ?
            AND COALESCE(is_dead, 0) = 0
            AND x BETWEEN ? AND ?
            AND z BETWEEN ? AND ?
          LIMIT 30
        `).all(player.world_id, player.x - PROXIMITY_M, player.x + PROXIMITY_M, player.z - PROXIMITY_M, player.z + PROXIMITY_M);
      }
    } catch { /* skip player on table missing */ }

    for (const npc of nearbyNpcs) {
      stats.scanned++;
      const dx = (npc.x ?? 0) - player.x;
      const dz = (npc.z ?? 0) - player.z;
      if (dx * dx + dz * dz > PROXIMITY_M2) continue;
      if (isOnCooldown(db, npc.id, player.user_id)) { stats.cooldowns++; continue; }
      // Probability gate so dense crowds don't all bark at once.
      if (Math.random() > FIRE_PROBABILITY) continue;

      try {
        const ctx = composeBarkContext(db, npc, player.user_id);
        if (!ctx) continue;
        // Determine recent topics from npc_player_memories.
        let recent = [];
        try {
          const row = db.prepare(`
            SELECT recent_bark_topics_json FROM npc_player_memories
            WHERE npc_id = ? AND player_id = ?
          `).get(npc.id, player.user_id);
          if (row?.recent_bark_topics_json) recent = JSON.parse(row.recent_bark_topics_json) || [];
        } catch { /* ok */ }
        const topic = pickBarkTopic(ctx, recent);

        // Try LLM if env says so; otherwise deterministic template.
        let composed = await composeBarkLineLLM(ctx, topic, brain, npc);
        if (!composed) composed = composeBarkLine(ctx, topic);
        if (!composed?.line) continue;

        recordBark(db, { npcId: npc.id, playerId: player.user_id, topic });

        try {
          globalThis._concordRealtimeEmit?.("npc:bark", {
            worldId: player.world_id,
            npcId: npc.id,
            npcName: npc.name,
            playerId: player.user_id,
            line: composed.line,
            tone: composed.tone,
            topic: composed.topic,
            llm: composed.llm === true,
            position: { x: npc.x, z: npc.z },
          });
        } catch { /* ok */ }
        stats.fired++;
        if (stats.fired >= MAX_PER_PASS) break;
      } catch (err) {
        stats.errored++;
        logger?.warn?.("npc-barks", "bark_failed", { npcId: npc.id, error: err?.message });
      }
    }
  }

  return stats;
}
