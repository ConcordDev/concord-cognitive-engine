/**
 * Apply unread world_consequences into schedules, memory, and relationship axes.
 * Idempotent via world_consequences.immediate_json.applied = true
 */
import { recordMemory } from "./npc-memory.js";
import { applyAxes } from "./npc-relation-axes.js";
import { regenerateSchedulesForFaction, currentDaySeed } from "./npc-routines.js";

function parse(v) {
  if (v == null || v === "") return {};
  if (typeof v === "object") return v;
  try { return JSON.parse(v) || {}; } catch { return {}; }
}

export function applyConsequence(db, row) {
  if (!db || !row?.id) return { ok: false };
  const immediate = parse(row.immediate_json ?? row.immediate);
  if (immediate.applied) return { ok: true, action: "already" };

  const action = row.action;
  const worldId = row.world_id || row.worldId;
  let rewritten = 0;
  let memories = 0;

  if (action === "kill" || action === "succession") {
    const factionId = immediate.factionId || parse(row.long_term_json ?? row.longTerm)?.factionId;
    if (factionId) {
      const r = regenerateSchedulesForFaction(db, factionId, {
        kind: "personal_loss",
        narrative: "leader_dead",
      });
      rewritten = r.regenerated || 0;
    }
  }

  if (row.target_id || row.targetId) {
    const npcId = row.target_id || row.targetId;
    const cat = action === "kindness" ? "KINDNESS"
      : action === "kill" ? "LOSS"
      : action === "crime" ? "CRIME"
      : action === "betrayal" ? "BETRAYAL"
      : "WORLD_EVENT";
    try {
      const m = recordMemory(db, {
        npcId,
        category: cat,
        subjectKind: row.actor_kind || row.actorKind,
        subjectId: row.actor_id || row.actorId,
        importance: Number(row.importance) || 0.5,
        text: action,
        consequenceId: row.id,
      });
      if (m.ok) memories++;
    } catch { /* table optional */ }
  }

  if ((action === "kindness" || action === "gift") && (row.target_id || row.targetId)) {
    try {
      applyAxes(db, {
        npcId: row.target_id || row.targetId,
        targetKind: row.actor_kind || row.actorKind || "player",
        targetId: row.actor_id || row.actorId,
      }, { gratitude: 0.35, trust: 0.15, respect: 0.1 });
    } catch { /* optional */ }
  }
  if (action === "kill" && (row.target_id || row.targetId) === undefined) {
    /* actor kill of npc: kin fear handled by opinions cascade already */
  }
  if (action === "insult" && (row.target_id || row.targetId)) {
    try {
      applyAxes(db, {
        npcId: row.target_id || row.targetId,
        targetKind: row.actor_kind || "player",
        targetId: row.actor_id || row.actorId,
      }, { hatred: 0.2, respect: -0.1, fear: 0.05 });
    } catch { /* optional */ }
  }

  const next = { ...immediate, applied: true, applied_at: Date.now(), schedules_rewritten: rewritten };
  try {
    db.prepare(`UPDATE world_consequences SET immediate_json = ? WHERE id = ?`)
      .run(JSON.stringify(next), row.id);
  } catch { /* */ }

  return { ok: true, rewritten, memories, worldId };
}

export function applyPendingConsequences(db, { limit = 40 } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT * FROM world_consequences
      WHERE immediate_json IS NULL
         OR immediate_json NOT LIKE '%"applied":true%'
      ORDER BY created_at ASC LIMIT ?
    `).all(limit);
  } catch {
    return { ok: false, reason: "no_table" };
  }
  let applied = 0;
  let rewritten = 0;
  for (const row of rows) {
    const r = applyConsequence(db, row);
    if (r.ok && r.action !== "already") {
      applied++;
      rewritten += r.rewritten || 0;
    }
  }
  return { ok: true, applied, rewritten, pending: rows.length };
}

export { currentDaySeed };
