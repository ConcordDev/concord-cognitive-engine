// server/lib/guidance-waypoint.js
//
// Sprint 9 — diegetic waypoint substrate.
//
// Reads the player's active quest objective + returns a structured
// `{ kind, worldPos, hint, npcId?, voiceLineId? }` payload that the
// frontend's QuestWaypointBeacon component renders as a 3D beacon
// (Elden Ring stone-crone style: an unmistakable in-world pointer
// at the next objective).
//
// Sources (in priority order):
//   1. quest-engine.activeQuests — players' real authored quest chains
//   2. forward-sim premonitions — speculative "you should look here"
//   3. lattice-quest-composer drift-spawned objectives
//   4. fall-through: null (no active guidance)
//
// The "next-objective" determination is conservative: we only point
// at things the substrate is reasonably sure about. If multiple
// objectives are tied, return the most recently created.

export function getActiveObjective(db, userId, worldId) {
  if (!db || !userId) return null;

  // Quest engine — start with this, it's the highest-confidence source.
  try {
    const row = db.prepare(`
      SELECT id, title, objectives_json, world_id, status
      FROM quest_state
      WHERE user_id = ?
        AND world_id = ?
        AND status = 'active'
      ORDER BY started_at DESC LIMIT 1
    `).get(userId, worldId);
    if (row) {
      const objectives = safeParse(row.objectives_json) || [];
      const nextObj = objectives.find(o => !o.complete);
      if (nextObj) {
        return {
          kind: "quest_step",
          questId: row.id,
          questTitle: row.title,
          step: nextObj.id || nextObj.description || "next_step",
          description: nextObj.description || "Reach the next objective",
          worldId: row.world_id,
          worldPos: nextObj.position || null,
          npcId: nextObj.npc_id || null,
          voiceLineId: nextObj.voice_line || null,
        };
      }
    }
  } catch { /* quest_state table optional */ }

  // Forward-sim premonition — second-tier, only if no quest active.
  try {
    const row = db.prepare(`
      SELECT id, subject_kind, subject_id, anticipated_prose
      FROM forward_predictions
      WHERE user_id = ?
        AND realised_at IS NULL
        AND expires_at > unixepoch()
      ORDER BY composed_at DESC LIMIT 1
    `).get(userId);
    if (row && row.subject_kind === "npc") {
      const npcPos = db.prepare(`SELECT x, z FROM world_npcs WHERE id = ? AND world_id = ?`)
        .get(row.subject_id, worldId);
      return {
        kind: "premonition",
        questId: null,
        step: row.subject_id,
        description: row.anticipated_prose || "A feeling pulls you toward someone…",
        worldId,
        worldPos: npcPos ? { x: npcPos.x, y: 0, z: npcPos.z } : null,
        npcId: row.subject_id,
        voiceLineId: null,
      };
    }
  } catch { /* forward_predictions table optional */ }

  // Lattice-born quest — drift-spawned, last priority.
  try {
    // lattice_born_quests is world-scoped (not user-scoped); 'open' = not yet
    // realised; the anchor position lives in procgen_regions keyed by signature.
    const row = db.prepare(`
      SELECT q.id, q.target_npc_id AS host_npc_id,
             COALESCE(r.anchor_x, 0) AS anchor_x, COALESCE(r.anchor_z, 0) AS anchor_z
      FROM lattice_born_quests q
      LEFT JOIN procgen_regions r ON r.drift_alert_signature = q.drift_alert_signature
      WHERE q.world_id = ? AND q.realised_at IS NULL
      ORDER BY q.composed_at DESC LIMIT 1
    `).get(worldId);
    if (row) {
      return {
        kind: "lattice_born",
        questId: row.id,
        step: row.host_npc_id || "anchor",
        description: "Something is wrong in this region. Investigate.",
        worldId,
        worldPos: { x: row.anchor_x, y: 0, z: row.anchor_z },
        npcId: row.host_npc_id || null,
        voiceLineId: null,
      };
    }
  } catch { /* lattice-born table optional */ }

  return null;
}

/**
 * Build a hint-text string for the recovery `?` button. Genre-aware,
 * gentle, never breaks the fourth wall.
 */
export function buildHintText(objective) {
  if (!objective) {
    return "The world is quiet. Wander; ask an NPC about themselves; pick up a recipe at the market. Something will arrive.";
  }
  switch (objective.kind) {
    case "quest_step":
      if (objective.npcId) {
        return `Concordia: "Find ${objective.npcId}. The thread runs through them. ${objective.description || ''}"`;
      }
      return `Concordia: "The next step waits there. ${objective.description || ''}"`;
    case "premonition":
      return `Concordia: "You have a feeling about ${objective.npcId}. Follow it."`;
    case "lattice_born":
      return `Concordia: "A region near here resists itself. The lattice marks it for you."`;
    default:
      return "Concordia: \"Look where the light bends.\"";
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}
