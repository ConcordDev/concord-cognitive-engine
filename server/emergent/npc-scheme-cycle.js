// server/emergent/npc-scheme-cycle.js
//
// Sprint C / Track A4 — heartbeat that advances NPC schemes.
//
// Frequency: 30 ticks (~7.5 min). Per pass:
//   1. Pull all schemes whose next_tick_at <= now AND phase is non-terminal.
//   2. Per scheme: try advanceScheme; wrap in try/catch.
//   3. Bounded MAX_PER_PASS so a flood of schemes can't starve the tick.
//
// Kill-switch: CONCORD_NPC_SCHEMES=0.
// Returns { ok, advanced, transitioned, reason? }. Never throws.

import logger from "../logger.js";
import { advanceScheme, proposeScheme } from "../lib/npc-schemes.js";

const MAX_PER_PASS = 60;
const MAX_PROPOSE_PER_PASS = 8;

export async function runNpcSchemeCycle({ db, state: _state, tickCount: _t } = {}) {
  if (process.env.CONCORD_NPC_SCHEMES === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  const stats = { ok: true, advanced: 0, transitioned: 0, proposed: 0, exposed: 0, completed: 0 };

  // 1) Advance phase for ready schemes.
  let pending = [];
  try {
    pending = db.prepare(`
      SELECT id FROM npc_schemes
      WHERE next_tick_at <= unixepoch() AND phase NOT IN ('complete','abandoned','exposed')
      ORDER BY next_tick_at ASC LIMIT ?
    `).all(MAX_PER_PASS);
  } catch { return { ok: true, ...stats, reason: "no_table" }; }

  for (const row of pending) {
    try {
      const r = advanceScheme(db, row.id);
      if (r?.ok) {
        stats.advanced++;
        if (r.transitioned) stats.transitioned++;
        if (r.toPhase === "complete") stats.completed++;
        if (r.toPhase === "exposed") stats.exposed++;
      }
    } catch (err) {
      try { logger.debug?.("scheme_advance_failed", { id: row.id, error: err?.message }); } catch { /* noop */ }
    }
  }

  // 2) Propose new schemes for high-stress / low-opinion plotters. Cheap
  //    candidate scan via npc_stress + character_opinions join — only NPCs with
  //    stress ≥ 60 are considered.
  let proposers = [];
  try {
    proposers = db.prepare(`
      SELECT s.npc_id, s.coping_trait FROM npc_stress s
      WHERE s.stress >= 60
      ORDER BY s.stress DESC LIMIT ?
    `).all(MAX_PROPOSE_PER_PASS);
  } catch { /* npc_stress optional */ }

  for (const p of proposers) {
    try {
      // Find their lowest-opinion NPC target (the most-hated). Skip if no row.
      const target = db.prepare(`
        SELECT target_kind, target_id FROM character_opinions
        WHERE npc_id = ? AND target_kind IN ('npc','player') AND score <= -50
        ORDER BY score ASC LIMIT 1
      `).get(p.npc_id);
      if (!target) continue;
      const r = proposeScheme(db, {
        plotterNpcId: p.npc_id,
        targetKind: target.target_kind,
        targetId: target.target_id,
      });
      if (r?.action === "proposed") stats.proposed++;
    } catch { /* noop */ }
  }

  return stats;
}
