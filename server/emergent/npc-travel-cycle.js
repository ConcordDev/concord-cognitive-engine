// server/emergent/npc-travel-cycle.js
//
// Phase T — drains npc_travel_intents and moves NPCs cross-world.
//
// Frequency: 60 ticks (~15 min). Picks all pending intents whose
// executes_at <= now, updates npc_residency.current_world_id +
// world_npcs.world_id, invalidates the NPC's routine cache (so the
// NPC re-schedules at the destination), and emits a npc:travelled
// socket event so any open world client can refresh meshes.

import { chooseTravelGoal, queueIntent, getOpenIntent } from '../lib/npc-ambition.js';

export async function runNpcTravelCycle(STATE) {
  const db = STATE?.db;
  if (!db) return { ok: false, reason: 'no_db' };

  const now = Math.floor(Date.now() / 1000);
  let executed = 0;
  let queued = 0;

  // 1. Execute pending intents whose time has come.
  const pending = db.prepare(`SELECT * FROM npc_travel_intents WHERE status = 'pending' AND executes_at <= ?`).all(now);
  // Hoist the per-intent statements (constant SQL) out of the loop — prepared
  // once, reused per intent (was an N+1 re-preparing five statements per row).
  const updResidencyStmt = db.prepare(`
        UPDATE npc_residency
           SET current_world_id = ?, arrived_at = unixepoch(), total_worlds_visited = total_worlds_visited + 1
         WHERE npc_id = ?
      `);
  const selOldWorldStmt = db.prepare(`SELECT world_id FROM world_npcs WHERE id = ?`);
  const updNpcWorldStmt = db.prepare(`UPDATE world_npcs SET world_id = ?, current_location = ? WHERE id = ?`);
  const delRoutineStmt = db.prepare(`DELETE FROM npc_routine_state WHERE npc_id = ?`);
  const markExecutedStmt = db.prepare(`UPDATE npc_travel_intents SET status = 'executed' WHERE id = ?`);
  for (const intent of pending) {
    try {
      // Update residency.
      updResidencyStmt.run(intent.destination_world_id, intent.npc_id);

      // Update world_npcs.world_id (current location).
      const old = selOldWorldStmt.get(intent.npc_id);
      updNpcWorldStmt.run(intent.destination_world_id, '{"x":0,"z":0}', intent.npc_id);

      // Invalidate routine state — the NPC needs a new schedule for the new world.
      try { delRoutineStmt.run(intent.npc_id); } catch { /* table may not exist */ }

      // Mark the intent executed.
      markExecutedStmt.run(intent.id);
      executed++;

      // Realtime: tell active world clients.
      try {
        if (globalThis?.__CONCORD_REALTIME__?.io) {
          const io = globalThis.__CONCORD_REALTIME__.io;
          io.to(`world:${old?.world_id || ''}`).emit('npc:travelled', {
            npcId: intent.npc_id, fromWorldId: old?.world_id, toWorldId: intent.destination_world_id, reason: intent.reason,
          });
          io.to(`world:${intent.destination_world_id}`).emit('npc:travelled', {
            npcId: intent.npc_id, fromWorldId: old?.world_id, toWorldId: intent.destination_world_id, reason: intent.reason,
          });
        }
      } catch { /* sockets optional */ }
    } catch (err) {
      console.warn('[npc-travel-cycle] failed to execute intent', intent.id, String(err?.message || err));
    }
  }

  // 2. Pick fresh travel intents for ambitious NPCs that don't have one open.
  const ambitious = db.prepare(`
    SELECT n.id, n.world_id, n.archetype, n.ambition_score, r.current_world_id, r.home_world_id
      FROM world_npcs n
      LEFT JOIN npc_residency r ON r.npc_id = n.id
     WHERE n.ambition_score >= 0.4
     LIMIT 200
  `).all();
  for (const npc of ambitious) {
    if (getOpenIntent(db, npc.id)) continue;
    const intent = chooseTravelGoal(npc, db);
    if (!intent) continue;
    queueIntent(db, intent);
    queued++;
  }

  return { ok: true, executed, queued };
}
