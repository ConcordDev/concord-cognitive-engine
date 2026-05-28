// server/lib/faction-rivalry-schemes.js
//
// T3.2 — translate authored faction rivalries into the NPC↔NPC opinion edges
// the scheme engine needs, so CK3-style plots fire along the lines the author
// drew, with zero invented content.
//
// The gap (audit): authored NPCs carry narrative_context but no `relationships`
// arrays, so T1.3 derives stress/coping but no hate-edges between specific
// rivals — and proposeScheme needs opinion ≤ -50 (or a paranoid/cruel coping
// wildcard) to fire. Factions, however, ALREADY carry `rival_factions` +
// `npc_ids`. This pass reads those: for each faction's lead NPC, it writes a
// hostile opinion toward the lead NPC of each authored rival faction. Every
// edge is grounded in authored data (faction A is authored as B's rival;
// NPC X is authored as a member of A) — no fabricated relationships.
//
// Idempotent: only seeds an edge when none exists yet, so re-boot never stacks
// the delta and never clobbers a gameplay-shifted opinion.

import { getOpinion, recordOpinionEvent } from "./npc-opinions.js";

// Below the -50 scheme-gate so the rivalry is immediately schemeable, but not
// rock-bottom — gameplay can still deepen or soften it.
export const RIVALRY_OPINION = -55;

function npcExists(db, id) {
  try { return !!db.prepare("SELECT 1 FROM world_npcs WHERE id = ?").get(id); }
  catch { return false; }
}

/**
 * Seed hostile NPC↔NPC opinion edges from authored faction rivalries.
 * @param {object} db
 * @param {Array} factions — authored faction objects ({ id, rival_factions, npc_ids })
 * @returns {{ ok: boolean, edges: number }}
 */
export function seedRivalryOpinionEdges(db, factions) {
  if (!db || !Array.isArray(factions)) return { ok: false, edges: 0 };
  const byId = new Map(factions.filter((f) => f?.id).map((f) => [f.id, f]));
  let edges = 0;

  for (const f of factions) {
    const rivals = Array.isArray(f?.rival_factions) ? f.rival_factions : [];
    const leadA = Array.isArray(f?.npc_ids) ? f.npc_ids[0] : null;
    if (!leadA || rivals.length === 0) continue;
    if (!npcExists(db, leadA)) continue;

    for (const rivalId of rivals) {
      const rf = byId.get(rivalId);
      const leadB = rf && Array.isArray(rf.npc_ids) ? rf.npc_ids[0] : null;
      if (!leadB || leadB === leadA) continue;
      if (!npcExists(db, leadB)) continue;
      // Idempotent: skip if any edge already exists in this direction.
      if (getOpinion(db, leadA, "npc", leadB)) continue;
      try {
        recordOpinionEvent(
          db,
          { npcId: leadA, targetKind: "npc", targetId: leadB },
          RIVALRY_OPINION,
          `faction rivalry: ${f.id} vs ${rivalId}`,
        );
        edges++;
      } catch { /* character_opinions optional on minimal builds */ }
    }
  }
  return { ok: true, edges };
}
