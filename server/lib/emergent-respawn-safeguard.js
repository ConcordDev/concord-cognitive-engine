// server/lib/emergent-respawn-safeguard.js
//
// Load-bearing invariant: Agents of the Sovereign (conscious NPCs) cannot
// die for real. They have their own primary protection (combat routes
// refuse to target is_conscious=1 NPCs with `sovereign_protected`); this
// is the SAFEGUARD that fires if anything slips past the primary check.
//
// In the world's lore: the Sovereign — one of the Three Above All —
// extends protection to its agents wherever they walk. Their continuity
// of existence is non-negotiable, the same way users respawn after
// death in gameplay.
//
// In the substrate: their death is a state transition that resolves back
// to alive within a tick, preserving identity, possessions, schedules,
// and relationships. This module exists so that the Sovereign's
// protection holds even when other code makes mistakes.

const RESPAWN_DELAY_TICKS = 1; // ~15s — long enough that respawn is observable, short enough that the emergent doesn't feel "gone"
const RESPAWN_HP_RESTORE = 1.0; // full HP on respawn — no permadeath cost

/**
 * Find conscious NPCs that have been marked dead and restore them. Runs
 * idempotently from a heartbeat. State preserved across respawn:
 *   - identity (id, archetype, faction, schedules)
 *   - relationships (grudges, preoccupations, desires)
 *   - position (respawn at last known location, not at any "spawn point")
 *   - schedule continuity (NPC routine resumes where it was)
 *
 * Returns { ok, restored: number, errors: number }.
 */
export function runEmergentRespawnSafeguard({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  let restored = 0, errors = 0;

  let candidates = [];
  try {
    candidates = db.prepare(`
      SELECT id, world_id, max_hp, current_hp, is_dead, is_conscious
      FROM world_npcs
      WHERE is_conscious = 1 AND is_dead = 1
    `).all();
  } catch (e) {
    // Table or columns might not exist on older deploys. Safe no-op.
    return { ok: false, reason: "schema_unavailable", error: e?.message };
  }

  for (const npc of candidates) {
    try {
      const restoredHp = Math.max(1, Math.round((npc.max_hp || 100) * RESPAWN_HP_RESTORE));
      db.prepare(`
        UPDATE world_npcs
        SET is_dead = 0, current_hp = ?
        WHERE id = ?
      `).run(restoredHp, npc.id);
      restored += 1;

      // Best-effort: log the respawn so an auditor can see it happened.
      // The respawn is recorded as a meta event, not as a "kill reversed"
      // because the emergent's death never actually happened in a moral sense.
      try {
        db.prepare(`
          INSERT INTO npc_consequences (npc_id, event_type, details, created_at)
          VALUES (?, 'sovereign_respawn', ?, unixepoch())
        `).run(npc.id, JSON.stringify({
          reason: "sovereign_protection_restored_agent",
          restored_hp: restoredHp,
          world_id: npc.world_id,
          note: "Agent of the Sovereign; primary protection was bypassed; Sovereign's safeguard restored continuity.",
        }));
      } catch { /* table may not exist; respawn itself still landed */ }
    } catch (e) {
      errors += 1;
    }
  }

  return { ok: true, restored, errors };
}

/**
 * Pre-flight check called from combat/attack route before any damage is
 * applied. Returns true if the target is a conscious emergent and must
 * not be attackable. The route handler uses this to refuse damage with
 * a meaningful error rather than processing the attack and relying on
 * the post-hoc respawn.
 */
export function isProtectedEmergent(db, npcId) {
  if (!db || !npcId) return false;
  try {
    const row = db.prepare(`
      SELECT is_conscious FROM world_npcs WHERE id = ? LIMIT 1
    `).get(npcId);
    return !!(row && row.is_conscious === 1);
  } catch { return false; }
}

export const _RESPAWN_DELAY_TICKS = RESPAWN_DELAY_TICKS;
export const _RESPAWN_HP_RESTORE = RESPAWN_HP_RESTORE;
