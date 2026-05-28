// server/emergent/npc-economy-cycle.js
//
// Phase 4b heartbeat — NPCs at their workplaces actually do economic
// work. Frequency: 8 ticks (~2min), staggered just behind the routine
// cycle (frequency 5) so most NPCs have already arrived at their target
// by the time this fires.
//
// Per pass:
//   1. For each active world, walk arrived NPCs in routine_state.
//   2. dispatchEconomicAction by activity_kind: gather / craft / trade
//      / rest (eats personal-needs items).
//   3. After per-NPC actions, refresh the regional_scarcity cache for
//      that world.
//
// Bounded MAX_ACTIONS_PER_PASS to keep tick cost predictable.
// Kill-switch: CONCORD_NPC_ECONOMY=0.
//
// Returns { ok, actions, byKind, scarcityRefreshed, reason? } never throws.

import logger from "../logger.js";
import {
  dispatchEconomicAction,
  refreshScarcityCache,
} from "../lib/npc-economy.js";

const MAX_ACTIONS_PER_PASS = 200;

export async function runNpcEconomyCycle({ db, state: _state, tickCount: _t } = {}) {
  if (process.env.CONCORD_NPC_ECONOMY === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  const stats = {
    ok: true,
    actions: 0,
    byKind: { gather: 0, craft: 0, trade: 0, rest: 0, skipped: 0 },
    scarcityRefreshed: 0,
  };

  let activeWorlds = [];
  try {
    activeWorlds = db.prepare(`
      SELECT DISTINCT world_id FROM world_visits
      WHERE departed_at IS NULL LIMIT 10
    `).all().map(r => r.world_id).filter(Boolean);
  } catch { /* world_visits optional */ }
  if (activeWorlds.length === 0) {
    try {
      activeWorlds = db.prepare(`
        SELECT DISTINCT world_id FROM world_npcs
        WHERE COALESCE(is_dead, 0) = 0 LIMIT 5
      `).all().map(r => r.world_id).filter(Boolean);
    } catch { return { ok: true, actions: 0, reason: "no_npc_table" }; }
  }
  if (activeWorlds.length === 0) return { ok: true, actions: 0 };

  // Phase G1.3 — aggregate notable actions per world; emit one batch
  // per (world, pass) instead of fanning out ~40 per-action emits.
  const notableByWorld = new Map(); // worldId -> { gathers, crafts, trades, rests, notable: [...] }

  for (const worldId of activeWorlds) {
    if (stats.actions >= MAX_ACTIONS_PER_PASS) break;
    let arrived = [];
    try {
      // Pull NPCs whose routine_state shows arrived AND world matches.
      arrived = db.prepare(`
        SELECT n.id, n.archetype, n.faction, n.world_id, rs.activity_kind
        FROM world_npcs n
        JOIN npc_routine_state rs ON rs.npc_id = n.id
        WHERE n.world_id = ?
          AND COALESCE(n.is_dead, 0) = 0
          AND rs.arrived_at IS NOT NULL
        LIMIT ?
      `).all(worldId, MAX_ACTIONS_PER_PASS - stats.actions);
    } catch { continue; }

    let worldBucket = notableByWorld.get(worldId);
    if (!worldBucket) {
      worldBucket = { gathers: 0, crafts: 0, trades: 0, rests: 0, notable: [] };
      notableByWorld.set(worldId, worldBucket);
    }

    for (const npc of arrived) {
      if (stats.actions >= MAX_ACTIONS_PER_PASS) break;
      try {
        const r = dispatchEconomicAction(db, npc, npc.activity_kind);
        if (r?.ok) {
          stats.actions++;
          if (npc.activity_kind in stats.byKind) stats.byKind[npc.activity_kind]++;
          // Bucket counts by kind for the batch payload.
          if (npc.activity_kind === "gather") worldBucket.gathers++;
          else if (npc.activity_kind === "craft") worldBucket.crafts++;
          else if (npc.activity_kind === "trade") worldBucket.trades++;
          else if (npc.activity_kind === "rest") worldBucket.rests++;
          // Notable actions go into a bounded highlight list (top 5 by
          // magnitude or just first 5 — magnitude is per-outcome and
          // we don't always have a numeric, so we use first-arrived).
          if (r.notable && worldBucket.notable.length < 5) {
            worldBucket.notable.push({
              actorId: npc.id,
              kind: npc.activity_kind,
              outcome: r.outcome || null,
              magnitude: r.magnitude ?? null,
            });
          }
        } else {
          stats.byKind.skipped++;
        }
      } catch (err) {
        try { logger.debug?.("npc-economy-cycle", "action_failed", { npcId: npc.id, error: err?.message }); }
        catch { /* ignore */ }
      }
    }

    // Refresh scarcity cache for this world (cheap aggregate read).
    try {
      const r = refreshScarcityCache(db, worldId);
      if (r?.ok) stats.scarcityRefreshed++;
    } catch { /* table may not exist */ }
  }

  // Phase G1.3 — one batch emit per world.
  try {
    const re = globalThis._concordRealtimeEmit;
    if (typeof re === "function") {
      for (const [worldId, b] of notableByWorld) {
        if (b.gathers === 0 && b.crafts === 0 && b.trades === 0 && b.rests === 0) continue;
        re("npc:economy-batch", {
          worldId,
          gathers: b.gathers, crafts: b.crafts, trades: b.trades, rests: b.rests,
          notable: b.notable,
        });
      }
    }
  } catch { /* emit failures never affect tick */ }

  return stats;
}
