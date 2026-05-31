// server/emergent/npc-skill-evolve-cycle.js
//
// Phase 1 heartbeat — auto-evolves NPC skills.
//
// Frequency: every 80 ticks (~20 minutes). Each pass:
//   1. Pulls NPCs with pending skill_evolution_unlocks rows.
//   2. For each, calls autoEvolveNpcSkills() which composes a deterministic
//      revision (LLM-opt-in via CONCORD_SKILL_EVOLUTION_LLM=1) and applies
//      it via the same applyEvolution path the player modal uses.
//   3. Wraps each NPC in try/catch — one failure doesn't stop the pass.
//
// Returns { ok, applied, npcsTouched, reason? } never throws.
//
// Kill-switch: CONCORD_NPC_SKILL_EVOLVE=0 disables.

import logger from "../logger.js";
import { autoEvolveNpcSkills, ensureNpcAuthoredSkills } from "../lib/npc-skill-author.js";

const MAX_NPCS_PER_PASS = 50;

export async function runNpcSkillEvolveCycle({ db, state: _state, tickCount: _tickCount } = {}) {
  if (process.env.CONCORD_NPC_SKILL_EVOLVE === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  let totalApplied = 0;
  let touched = 0;

  try {
    // 1. Make sure level-milestoned NPCs have authored their starting recipe.
    let levelMilestoneNpcs = [];
    try {
      levelMilestoneNpcs = db.prepare(`
        SELECT id, json_extract(state, '$.name') AS name, archetype, faction, level
        FROM world_npcs
        WHERE level >= 5
          AND (is_dead IS NULL OR is_dead = 0)
        ORDER BY last_tick_at DESC
        LIMIT ?
      `).all(MAX_NPCS_PER_PASS);
    } catch (_e) {
      // schema variant — skip if columns are missing
      return { ok: true, applied: 0, npcsTouched: 0, reason: "world_npcs_schema_skip" };
    }

    for (const npc of levelMilestoneNpcs) {
      try {
        ensureNpcAuthoredSkills(db, npc);
      } catch (err) {
        try { logger.debug?.("npc-skill-evolve-cycle", "ensure_failed", { npcId: npc.id, error: err?.message }); }
        catch { /* ignore */ }
      }
    }

    // 2. For NPCs with pending unlocks, auto-evolve.
    const pendingNpcs = db.prepare(`
      SELECT DISTINCT entity_id
      FROM skill_evolution_unlocks
      WHERE entity_kind = 'npc' AND completed_at IS NULL
      LIMIT ?
    `).all(MAX_NPCS_PER_PASS);

    for (const row of pendingNpcs) {
      try {
        const r = await autoEvolveNpcSkills(db, row.entity_id);
        totalApplied += r?.applied || 0;
        if ((r?.applied || 0) > 0) touched++;
      } catch (err) {
        try { logger.debug?.("npc-skill-evolve-cycle", "evolve_failed", { npcId: row.entity_id, error: err?.message }); }
        catch { /* ignore */ }
      }
    }

    return { ok: true, applied: totalApplied, npcsTouched: touched };
  } catch (err) {
    try { logger.warn?.("npc-skill-evolve-cycle", "cycle_failed", { error: err?.message }); }
    catch { /* ignore */ }
    return { ok: false, reason: "cycle_threw", error: err?.message };
  }
}
