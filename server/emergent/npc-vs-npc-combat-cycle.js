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

  for (const worldId of allWorlds) {
    const npcs = db.prepare(`
      SELECT id, current_location, archetype
        FROM world_npcs
       WHERE world_id = ?
       LIMIT 500
    `).all(worldId);
    if (npcs.length < 2) continue;

    // Bucket by cell.
    const byCell = new Map();
    for (const n of npcs) {
      const cell = _cellOf(n.current_location);
      if (!byCell.has(cell)) byCell.set(cell, []);
      byCell.get(cell).push(n);
    }

    for (const [, occupants] of byCell) {
      if (occupants.length < 2) continue;
      // Check pairs.
      for (let i = 0; i < occupants.length; i++) {
        for (let j = i + 1; j < occupants.length; j++) {
          const a = occupants[i], b = occupants[j];
          const grudge = _mutualGrudge(db, a.id, b.id);
          if (grudge < GRUDGE_FLOOR) continue;

          // Resolve.
          const aPower = _powerOf(db, a);
          const bPower = _powerOf(db, b);
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
            db.prepare(`
              INSERT INTO npc_ambition_log (id, npc_id, move_kind, target_kind, target_id, world_id, outcome)
              VALUES (?, ?, 'combat', 'npc', ?, ?, ?)
            `).run(`ambm_${crypto.randomUUID()}`, winner.id, loser.id, worldId, `damage=${damage}`);
          } catch { /* table may not exist */ }
          resolved++;
        }
      }
    }
  }

  return { ok: true, resolved };
}

function _mutualGrudge(db, aId, bId) {
  try {
    const a = db.prepare(`SELECT severity FROM npc_grudges WHERE npc_id = ? AND target_kind = 'npc' AND target_id = ?`).get(aId, bId);
    const b = db.prepare(`SELECT severity FROM npc_grudges WHERE npc_id = ? AND target_kind = 'npc' AND target_id = ?`).get(bId, aId);
    return Math.min(a?.severity ?? 0, b?.severity ?? 0);
  } catch { return 0; }
}

function _powerOf(db, npc) {
  try {
    const row = db.prepare(`SELECT SUM(level) as total FROM npc_skills WHERE npc_id = ?`).get(npc.id);
    return Number(row?.total ?? 1);
  } catch { return 1; }
}
