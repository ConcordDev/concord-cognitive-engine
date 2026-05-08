// server/emergent/faction-strategy-cycle.js
//
// Layer 11 heartbeat: faction emergent strategy.
//
// Frequency: every 200 ticks (~50 minutes). Each pass:
//   1. Reads all faction_strategy_state rows whose next_move_at <= now.
//   2. For each, snapshots peer states, asks pickMove() for the move
//      and applyMove() to persist + log + update relations.
//   3. Wraps each faction in try/catch — one failure doesn't stop others.
//
// Discovery: factions are file-driven (content/world/**/factions.json).
// We don't enumerate them here — instead we trust that ensureFactionState
// has been called by some external seeder OR by an explicit /admin/
// endpoint when worlds are seeded. The cycle only advances factions
// that already have a strategy_state row, which is the right behaviour
// for builds without seeded factions: zero work, zero error.

import logger from "../logger.js";
import { pickMove, applyMove } from "../lib/embodied/faction-strategy.js";

export async function runFactionStrategyCycle({ db, state: _state, tickCount: _tickCount } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const now = Math.floor(Date.now() / 1000);

  let pending;
  try {
    pending = db.prepare(`
      SELECT * FROM faction_strategy_state WHERE next_move_at <= ?
    `).all(now);
  } catch {
    return { ok: false, reason: "faction_strategy_state_missing" };
  }
  if (!pending || pending.length === 0) return { ok: true, advanced: 0 };

  // Snapshot all peer states once (small list — 7 authored factions).
  let allStates;
  try {
    allStates = db.prepare(`SELECT * FROM faction_strategy_state`).all();
  } catch {
    allStates = [];
  }

  let advanced = 0;
  const moves = [];
  for (const f of pending) {
    try {
      const peers = allStates.filter(s => s.faction_id !== f.faction_id);
      const picked = pickMove(f, peers);
      const applied = applyMove(db, f.faction_id, picked, allStates);
      if (applied) {
        advanced++;
        moves.push({ factionId: f.faction_id, move: applied.move, target: applied.target });
      }
    } catch (err) {
      try { logger.warn("faction-strategy-cycle", "faction_failed", { factionId: f.faction_id, error: err?.message }); } catch { /* ignore */ }
    }
  }

  return { ok: true, advanced, total: pending.length, moves };
}
