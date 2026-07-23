// server/emergent/npc-building-affinity-cycle.js
//
// Audit item #16 — heartbeat that connects three real-but-previously-
// unwired systems: an NPC's daily schedule (server/lib/npc-routines.js),
// the authored purposeful-building layout (server/lib/building-purpose.js),
// and DTU world-props (server/lib/dtu-props.js). Per pass: for a bounded
// set of NPCs whose current schedule activity has a real building-purpose
// match, pick that building (server/lib/npc-building-affinity.js#
// pickBuildingForNpc); for NPCs who have actually arrived, look for a real
// DTU-prop there and record an honest "using it" interaction
// (#npcUseProp). Never fabricates a building or a prop — see that module's
// header for the three honesty guarantees.
//
// Frequency: 10 ticks (~150s) — half the cadence of npc-routine-cycle
// (freq 5), since this only needs to notice a schedule the routine cycle
// already advanced, not drive movement itself.
// Kill-switch: CONCORD_NPC_BUILDING_AFFINITY=0.
// Never throws — every per-NPC step is try/caught individually so one bad
// row can't cost the rest of the pass.
//
// ── Registration (NOT done by this unit — see CLAUDE.md's "Wire-the-
// unwired pattern": lazy-import + registerHeartbeat, never edit
// governorTick/server.js directly) ──────────────────────────────────────
//
// Every OTHER heartbeat in this codebase (npc-routine-cycle, world-boss-
// cycle, lattice-orchestrator's three cycles, etc.) is registered via a
// two-line `import { runX } from "./emergent/x-cycle.js"; registerHeartbeat
// ("x-cycle", {...})` pair placed directly in server.js — there is no
// self-registering / module-registry.js-driven alternative path in this
// codebase (module-registry.js is auto-generated static dependency
// metadata for `npm run check-deps`, unrelated to runtime dispatch). This
// unit's instructions were explicit that server.js must not be touched, so
// — mirroring the documented "built, NOT mounted" precedent in
// server/domains/dtu-props.js's own header — the registration is written
// here for an orchestrator to add, not performed by this unit:
//
//   import { runNpcBuildingAffinityCycle } from "./emergent/npc-building-affinity-cycle.js";
//   registerHeartbeat("npc-building-affinity-cycle", {
//     frequency: 10,
//     handler: runNpcBuildingAffinityCycle,
//   });
//
// (Placed anywhere after the existing `registerHeartbeat("npc-routine-
// cycle", ...)` block is fine — no ordering dependency between the two;
// this cycle only READS npc_routine_state, it never writes it.)

import logger from "../logger.js";
import { pickBuildingForNpc, npcUseProp } from "../lib/npc-building-affinity.js";
import { CITY_LAYOUT_WORLD_ID } from "../lib/building-purpose.js";

const MAX_NPCS_PER_PASS = 100;

export async function runNpcBuildingAffinityCycle({ db } = {}) {
  if (process.env.CONCORD_NPC_BUILDING_AFFINITY === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  const stats = { ok: true, evaluated: 0, buildingsPicked: 0, propsUsed: 0 };

  // The authored purpose layout only exists for concordia-hub today (see
  // building-purpose.js's own header) — never guess a purpose mapping for
  // another world. Confirm the world is actually active before doing work.
  let hasActiveHub = false;
  try {
    hasActiveHub = !!db.prepare(`
      SELECT 1 FROM world_npcs WHERE world_id = ? AND COALESCE(is_dead, 0) = 0 LIMIT 1
    `).get(CITY_LAYOUT_WORLD_ID);
  } catch {
    return { ok: true, evaluated: 0, reason: "no_npc_table" };
  }
  if (!hasActiveHub) return { ok: true, evaluated: 0, reason: "no_hub_npcs" };

  let npcs = [];
  try {
    // Only NPCs with a live routine_state row whose activity has a
    // purposeful-building mapping are worth evaluating — everyone else
    // (asleep with no purpose match, wandering, mid-combat, etc.) is
    // correctly skipped rather than forced through a fabricated pick.
    npcs = db.prepare(`
      SELECT n.id, n.faction, n.world_id, s.activity_kind, s.arrived_at
      FROM world_npcs n
      JOIN npc_routine_state s ON s.npc_id = n.id
      WHERE n.world_id = ? AND COALESCE(n.is_dead, 0) = 0
        AND s.activity_kind IN ('trade','socialize','commune','craft','gather','train','patrol','rest','sleep')
      LIMIT ?
    `).all(CITY_LAYOUT_WORLD_ID, MAX_NPCS_PER_PASS);
  } catch (err) {
    try { logger.debug?.("npc-building-affinity-cycle", "query_failed", { error: err?.message }); } catch { /* ignore */ }
    return { ok: true, evaluated: 0, reason: "query_failed" };
  }

  for (const npc of npcs) {
    stats.evaluated++;
    try {
      const pick = pickBuildingForNpc(db, CITY_LAYOUT_WORLD_ID, npc);
      if (!pick.ok || !pick.buildingId) continue;
      stats.buildingsPicked++;

      // Only attempt the prop interaction once the NPC has actually
      // arrived at the station (npc_routine_state.arrived_at is set by
      // npc-routines.js#advanceRoutine on arrival) — "heading to" is a
      // real building pick, but using a prop there before arriving would
      // be exactly the kind of fabricated interaction this is built to
      // avoid.
      if (npc.arrived_at) {
        const used = npcUseProp(db, CITY_LAYOUT_WORLD_ID, npc, pick.buildingId);
        if (used.ok) stats.propsUsed++;
      }
    } catch (err) {
      try { logger.debug?.("npc-building-affinity-cycle", "npc_failed", { npcId: npc.id, error: err?.message }); } catch { /* ignore */ }
    }
  }

  return stats;
}
