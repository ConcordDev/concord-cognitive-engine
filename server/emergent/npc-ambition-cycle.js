// server/emergent/npc-ambition-cycle.js
//
// Phase T — picks unilateral high-stakes moves for ambitious NPCs +
// hands authored / lattice-born quests to NPCs that don't have one.
//
// Frequency: 80 ticks (~20 min). Three sub-passes per cycle:
//   1. Pick an ambition move per qualifying NPC (≥0.4 ambition).
//   2. Try to attach an open lattice-born quest to a high-ambition
//      NPC who's idle.
//   3. Bump ambition_score for NPCs that completed a quest in the
//      last hour (success → more confidence → higher ambition next
//      cycle).

import { pickAmbitionMove, recordAmbitionMove } from '../lib/npc-ambition.js';
import { tryAcceptQuestForNpc, listOpenAcceptable } from '../lib/npc-quest-runner.js';

const MIN_AMBITION = 0.4;

export async function runNpcAmbitionCycle(STATE) {
  const db = STATE?.db;
  if (!db) return { ok: false, reason: 'no_db' };

  const ambitious = db.prepare(`
    SELECT n.id, n.world_id, n.archetype, n.ambition_score, r.current_world_id, r.home_world_id
      FROM world_npcs n
      LEFT JOIN npc_residency r ON r.npc_id = n.id
     WHERE n.ambition_score >= ?
     LIMIT 200
  `).all(MIN_AMBITION);

  let movesPicked = 0;
  let questsAccepted = 0;
  let confidenceBumps = 0;

  // 1. Ambition moves.
  for (const npc of ambitious) {
    const move = pickAmbitionMove(npc, db);
    if (!move) continue;
    recordAmbitionMove(db, {
      npcId: npc.id, moveKind: move.kind, targetKind: move.target_kind, targetId: move.target_id,
      worldId: npc.current_world_id || npc.world_id, outcome: 'queued',
    });
    movesPicked++;
  }

  // 2. Distribute open lattice-born quests to ambitious idle NPCs.
  const openQuests = listOpenAcceptable(db, 30);
  for (const q of openQuests) {
    // Pick a random ambitious NPC who's currently idle for this quest.
    const candidate = ambitious[Math.floor(Math.random() * ambitious.length)];
    if (!candidate) break;
    const accepted = tryAcceptQuestForNpc(db, candidate, { id: q.id, archetype_hint: null, payload: { step_count: 4 } });
    if (accepted) questsAccepted++;
  }

  // 3. Confidence feedback — NPCs that completed a quest in the last
  //    hour bump ambition by +0.05 (capped at 1.0).
  try {
    const recentDone = db.prepare(`
      SELECT npc_id FROM npc_active_quests
       WHERE status = 'completed' AND accepted_at > unixepoch() - 3600
    `).all();
    for (const r of recentDone) {
      db.prepare(`UPDATE world_npcs SET ambition_score = MIN(1.0, ambition_score + 0.05) WHERE id = ?`).run(r.npc_id);
      confidenceBumps++;
    }
  } catch { /* table may not exist */ }

  return { ok: true, movesPicked, questsAccepted, confidenceBumps };
}
