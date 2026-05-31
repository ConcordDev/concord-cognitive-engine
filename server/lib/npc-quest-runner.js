// server/lib/npc-quest-runner.js
//
// Phase T — NPCs accept and pursue authored quests autonomously.
//
// API:
//   tryAcceptQuestForNpc(db, npc, quest)  — gate by archetype + ambition
//   advanceNpcQuest(db, activeQuestId, evidence) — bump current_step, complete on done
//   getActiveQuestsForNpc(db, npcId)
//   listOpenAcceptable(db)                — quests no NPC has accepted yet

import crypto from 'node:crypto';

/** Returns activeQuestId on accept, null on reject. */
export function tryAcceptQuestForNpc(db, npc, quest) {
  if (!db || !npc?.id || !quest?.id) return null;
  // Skip if NPC already has 3+ active quests.
  const active = db.prepare(`SELECT COUNT(*) as n FROM npc_active_quests WHERE npc_id = ? AND status = 'active'`).get(npc.id);
  if ((active?.n || 0) >= 3) return null;
  // Skip if this NPC already has THIS quest active.
  const dup = db.prepare(`SELECT id FROM npc_active_quests WHERE npc_id = ? AND quest_id = ? AND status = 'active'`).get(npc.id, quest.id);
  if (dup) return null;

  // Archetype gate: warriors take combat-flavoured quests; scholars take
  // investigation; mystics take ritual; etc. If quest has no archetype
  // hint or NPC has none, accept by default.
  if (quest.archetype_hint && npc.archetype && quest.archetype_hint !== npc.archetype) return null;

  const id = `naq_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO npc_active_quests (id, npc_id, quest_id, accepted_at, current_step, status, origin_world_id, payload_json)
    VALUES (?, ?, ?, unixepoch(), 0, 'active', ?, ?)
  `).run(id, npc.id, quest.id, npc.current_world_id || npc.world_id || null, JSON.stringify(quest.payload || {}));

  try {
    if (globalThis?.__CONCORD_REALTIME__?.io) {
      globalThis.__CONCORD_REALTIME__.io.emit('npc:quest-accepted', { npcId: npc.id, questId: quest.id, activeQuestId: id });
    }
  } catch { /* sockets optional */ }

  return id;
}

/** Advance one step. evidence is an opaque object the caller can use
 *  to record what triggered the advance (combat:hit / dialogue / item-handover).
 *  When current_step reaches step_count - 1, marks complete. */
export function advanceNpcQuest(db, activeQuestId, evidence = {}) {
  if (!db || !activeQuestId) return null;
  const row = db.prepare(`SELECT * FROM npc_active_quests WHERE id = ? AND status = 'active'`).get(activeQuestId);
  if (!row) return null;
  const stepCount = Number(JSON.parse(row.payload_json || '{}').step_count || 4);
  const next = (row.current_step || 0) + 1;
  if (next >= stepCount) {
    db.prepare(`UPDATE npc_active_quests SET status = 'completed', current_step = ? WHERE id = ?`).run(next, activeQuestId);
    try {
      if (globalThis?.__CONCORD_REALTIME__?.io) {
        globalThis.__CONCORD_REALTIME__.io.emit('npc:quest-completed', { activeQuestId, npcId: row.npc_id, questId: row.quest_id });
      }
    } catch { /* sockets optional */ }
    return { completed: true, step: next };
  }
  db.prepare(`UPDATE npc_active_quests SET current_step = ? WHERE id = ?`).run(next, activeQuestId);
  return { completed: false, step: next, evidenceRecorded: !!evidence };
}

export function getActiveQuestsForNpc(db, npcId) {
  return db.prepare(`SELECT * FROM npc_active_quests WHERE npc_id = ? AND status = 'active'`).all(npcId);
}

/** Return up to N quests in the global pool that have no NPC accepter yet
 *  (so the routine cycle can hand them to high-ambition NPCs). */
export function listOpenAcceptable(db, limit = 20) {
  // Looks for lattice-born + ecology-born quests in the existing tables.
  // Fallback: just the lattice_born_quests table.
  try {
    return db.prepare(`
      SELECT q.id, q.drift_type AS title, q.target_npc_id AS host_npc_id, q.drift_alert_signature AS signature
        FROM lattice_born_quests q
        LEFT JOIN npc_active_quests a ON a.quest_id = q.id AND a.status IN ('active','completed')
       WHERE a.id IS NULL
       LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}
