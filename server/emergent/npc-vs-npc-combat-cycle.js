// server/emergent/npc-vs-npc-combat-cycle.js
//
// Phase T — NPC-vs-NPC combat resolution.
//
// Frequency: 8 ticks (~2 min). For each pair of NPCs colocated in the
// same world cell with mutual grudge ≥ 5, roll a damage envelope and
// award the winner skill XP. Damage uses the same _validateDamageCap
// envelope as players (skill.max_damage * 2.5 or 500 hard cap) so the
// math stays symmetric.
//
// Emits `npc:combat-resolved` socket events the EmergentEventFeed picks
// up so players see emergent NPC drama in the world.

import { awardNpcXp } from '../lib/npc-skill-progression.js';
import crypto from 'node:crypto';

const CELL_SIZE_M  = 50;
const GRUDGE_FLOOR = 5;
const HARD_DAMAGE_CAP = 500;

function _cellOf(loc) {
  try {
    const p = typeof loc === 'string' ? JSON.parse(loc) : loc;
    return `${Math.floor((p?.x ?? 0) / CELL_SIZE_M)}::${Math.floor((p?.z ?? 0) / CELL_SIZE_M)}`;
  } catch { return '0::0'; }
}

export async function runNpcVsNpcCombatCycle(STATE) {
  const db = STATE?.db;
  if (!db) return { ok: false, reason: 'no_db' };

  // 1. Build a colocation index per world.
  const allWorlds = db.prepare(`SELECT DISTINCT world_id FROM world_npcs`).all().map(r => r.world_id);
  let resolved = 0;

  // Batch every world's combat resolutions into ONE transaction instead of
  // up to 5 separate synchronous DB calls per resolved pair (2 grudge reads,
  // 2 power reads, an XP write, an audit-log insert), each its own commit.
  // Real production finding, 2026-08-23 (see lib/npc-simulator.js
  // #_flushPendingPersists for the full measured rationale). The per-pair
  // try/catch below is NEW — previously an uncaught throw from awardNpcXp
  // would abort the whole cycle (every remaining world/pair for this tick);
  // now it skips just that one pair, which is strictly safer, and also
  // means nothing here can throw out to the transaction wrapper and roll
  // back pairs already resolved earlier in the same tick.
  // INC-100d (2026-10-19): preload the NPC-vs-NPC grudge graph ONCE per
  // cycle instead of two prepare()+get() calls for every colocated pair.
  // Measured on a prod DB clone: 16 worlds, 37,718 colocated pairs, 876
  // grudge rows -> ~75k synchronous statements, ~590 ms of blocked event
  // loop every ~2 min (event_loop_burst_lag heartbeats[] named this module
  // in every ~480-550 ms burst window). Only NPCs that hold a grudge can
  // ever clear GRUDGE_FLOOR (mutual = min of both directions, missing = 0),
  // so occupants with no outgoing grudge are dropped before pairing.
  const grudgeOf = new Map(); // npc_id -> Map(target_id -> severity)
  try {
    const rows = db.prepare(`SELECT npc_id, target_id, severity FROM npc_grudges WHERE target_kind = 'npc'`).all();
    for (const r of rows) {
      let m = grudgeOf.get(r.npc_id);
      if (!m) { m = new Map(); grudgeOf.set(r.npc_id, m); }
      if (!m.has(r.target_id)) m.set(r.target_id, r.severity);
    }
  } catch { /* table may not exist -> no grudges -> nothing to resolve */ }
  if (grudgeOf.size === 0) return { ok: true, resolved: 0 };

  const mutualGrudge = (aId, bId) =>
    Math.min(grudgeOf.get(aId)?.get(bId) ?? 0, grudgeOf.get(bId)?.get(aId) ?? 0);

  let powerStmt = null, logStmt = null;
  try { powerStmt = db.prepare(`SELECT SUM(level) as total FROM npc_skills WHERE npc_id = ?`); } catch { /* table may not exist */ }
  try {
    logStmt = db.prepare(`
      INSERT INTO npc_ambition_log (id, npc_id, move_kind, target_kind, target_id, world_id, outcome)
      VALUES (?, ?, 'combat', 'npc', ?, ?, ?)
    `);
  } catch { /* table may not exist */ }
  const npcsStmt = db.prepare(`
        SELECT id, current_location, archetype
          FROM world_npcs
         WHERE world_id = ?
         LIMIT 500
      `);

  const resolveAllWorlds = db.transaction((worlds) => {
    for (const worldId of worlds) {
      const npcs = npcsStmt.all(worldId);
      if (npcs.length < 2) continue;

      // Bucket by cell (only NPCs that hold any NPC grudge can fight).
      const byCell = new Map();
      for (const n of npcs) {
        if (!grudgeOf.has(n.id)) continue;
        const cell = _cellOf(n.current_location);
        if (!byCell.has(cell)) byCell.set(cell, []);
        byCell.get(cell).push(n);
      }

      for (const [, occupants] of byCell) {
        if (occupants.length < 2) continue;
        // Check pairs.
        for (let i = 0; i < occupants.length; i++) {
          for (let j = i + 1; j < occupants.length; j++) {
            try {
              const a = occupants[i], b = occupants[j];
              const grudge = mutualGrudge(a.id, b.id);
              if (grudge < GRUDGE_FLOOR) continue;

              // Resolve.
              const aPower = _powerOf(powerStmt, a);
              const bPower = _powerOf(powerStmt, b);
              const aWins  = aPower >= bPower;
              const winner = aWins ? a : b;
              const loser  = aWins ? b : a;
              const damage = Math.min(HARD_DAMAGE_CAP, Math.floor(20 + grudge * 4 + Math.abs(aPower - bPower) * 1.5));

              // Award XP to the winner; fight skill (combat).
              awardNpcXp(db, winner.id, 'combat', Math.floor(damage * 0.4));

              // Emit.
              try {
                if (globalThis?.__CONCORD_REALTIME__?.io) {
                  globalThis.__CONCORD_REALTIME__.io.to(`world:${worldId}`).emit('npc:combat-resolved', {
                    worldId, winnerId: winner.id, loserId: loser.id, damage, grudge,
                  });
                }
              } catch { /* sockets optional */ }

              // Audit-log.
              try {
                logStmt?.run(`ambm_${crypto.randomUUID()}`, winner.id, loser.id, worldId, `damage=${damage}`);
              } catch { /* table may not exist */ }
              resolved++;
            } catch { /* one pair's failure must not abort the rest of the batch */ }
          }
        }
      }
    }
  });
  resolveAllWorlds(allWorlds);

  return { ok: true, resolved };
}

function _powerOf(powerStmt, npc) {
  try {
    const row = powerStmt?.get(npc.id);
    return Number(row?.total ?? 1);
  } catch { return 1; }
}
