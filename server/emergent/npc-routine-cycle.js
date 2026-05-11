// server/emergent/npc-routine-cycle.js
//
// Phase 4a — heartbeat that advances NPC daily routines.
//
// Frequency: 5 ticks (~75s). Per pass:
//   1. Pick the most-active worlds (those with player presence).
//   2. For each world, walk the chunks closest to a player first
//      (NPCs the player can see should move first).
//   3. For each NPC: ensure today's schedule exists, then advance.
//
// Bounded at MAX_NPCS_PER_PASS to keep tick cost predictable.
// Kill-switch: CONCORD_NPC_ROUTINES=0.
//
// Returns { ok, advanced, transitioned, arrived, signalsWritten, reason? }.
// Never throws.

import logger from "../logger.js";
import {
  advanceRoutine,
  persistScheduleForNpc,
  currentDaySeed,
} from "../lib/npc-routines.js";
import { decayStress } from "../lib/npc-stress.js";
import { decayOpinions } from "../lib/npc-opinions.js";

const MAX_NPCS_PER_PASS = 200;

export async function runNpcRoutineCycle({ db, state: _state, tickCount: _t } = {}) {
  if (process.env.CONCORD_NPC_ROUTINES === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  const stats = { ok: true, advanced: 0, transitioned: 0, arrived: 0, signalsWritten: 0, scheduled: 0 };
  const daySeed = currentDaySeed();

  let activeWorlds = [];
  try {
    activeWorlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits
      WHERE departed_at IS NULL
      LIMIT 10
    `).all().map(r => r.world_id).filter(Boolean);
  } catch { /* world_visits optional */ }
  if (activeWorlds.length === 0) {
    // Fallback: pick any world with NPCs.
    try {
      activeWorlds = db.prepare(`
        SELECT DISTINCT world_id FROM world_npcs
        WHERE COALESCE(is_dead, 0) = 0
        LIMIT 5
      `).all().map(r => r.world_id).filter(Boolean);
    } catch { return { ok: true, advanced: 0, reason: "no_npc_table" }; }
  }
  if (activeWorlds.length === 0) return { ok: true, advanced: 0 };

  // Look up Phase 2 preoccupations once per faction visited (per-pass cache).
  const preoccByFaction = new Map();
  function preoccFor(factionId) {
    if (!factionId) return null;
    if (preoccByFaction.has(factionId)) return preoccByFaction.get(factionId);
    let p = null;
    try {
      // Most recent active faction_phase preoccupation, any NPC in faction.
      p = db.prepare(`
        SELECT pp.kind, pp.narrative, pp.established_at FROM npc_preoccupations pp
        JOIN world_npcs n ON n.id = pp.npc_id
        WHERE n.faction = ? AND pp.kind = 'faction_phase' AND pp.fades_at IS NULL
        ORDER BY pp.established_at DESC LIMIT 1
      `).get(factionId) || null;
    } catch { /* table optional */ }
    preoccByFaction.set(factionId, p);
    return p;
  }

  for (const worldId of activeWorlds) {
    if (stats.advanced >= MAX_NPCS_PER_PASS) break;
    let npcs = [];
    try {
      npcs = db.prepare(`
        SELECT id, archetype, faction, current_location, spawn_location, world_id
        FROM world_npcs
        WHERE world_id = ? AND COALESCE(is_dead, 0) = 0
        LIMIT ?
      `).all(worldId, MAX_NPCS_PER_PASS - stats.advanced);
    } catch { continue; }

    for (const npc of npcs) {
      if (stats.advanced >= MAX_NPCS_PER_PASS) break;
      try {
        // Ensure today's schedule exists. Cheap upsert via UNIQUE constraint.
        const has = db.prepare(`
          SELECT 1 FROM npc_schedules WHERE npc_id = ? AND day_seed = ? LIMIT 1
        `).get(npc.id, daySeed);
        if (!has) {
          const w = persistScheduleForNpc(db, npc, daySeed, preoccFor(npc.faction));
          if (w > 0) stats.scheduled++;
        }

        const r = await advanceRoutine(db, npc, { daySeed });
        if (r?.ok) {
          stats.advanced++;
          if (r.transitioned) stats.transitioned++;
          if (r.arrived) stats.arrived++;
          stats.signalsWritten += r.signalsWritten || 0;
          // Sprint 8 — broadcast routine-block transitions so the timeline
          // lens + DistrictActivityFeed surfaces NPC activity in real time.
          // Skipped for routine pass-throughs (only fired on transitions).
          if (r.transitioned) {
            try {
              const re = globalThis._concordRealtimeEmit;
              if (typeof re === "function") {
                re("npc:activity", {
                  world_id: worldId,
                  actor_kind: "npc",
                  actor_id: npc.id,
                  activity: r.currentActivity || r.activity || null,
                  faction: npc.faction || null,
                });
              }
            } catch { /* never block tick */ }
          }
        }
      } catch (err) {
        try { logger.debug?.("npc-routine-cycle", "advance_failed", { npcId: npc.id, error: err?.message }); }
        catch { /* ignore */ }
      }
    }
  }

  // Sprint C / Track A1 — daily stress decay sweep. Cheap batch UPDATE,
  // safe to call every routine pass (the WHERE clause filters on
  // last_decay_at < now-24h so most calls are no-ops).
  try { decayStress(db); } catch { /* table absent on minimal builds */ }
  // Sprint C / Track A2 — same pattern for opinions.
  try { decayOpinions(db); } catch { /* table absent on minimal builds */ }

  return stats;
}
