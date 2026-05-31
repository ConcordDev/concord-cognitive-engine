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
import { ethicsEnabled, getSharedValueRuleIndex } from "../lib/viability/value-rule-index.js";

const MAX_PER_PASS = 60;
const MAX_PROPOSE_PER_PASS = 8;

export async function runNpcSchemeCycle({ db, state: _state, tickCount: _t } = {}) {
  if (process.env.CONCORD_NPC_SCHEMES === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  const stats = { ok: true, advanced: 0, transitioned: 0, proposed: 0, exposed: 0, completed: 0 };

  // Wave 4 — build the value-rule index once per pass (memoized) so charity-laden
  // NPCs refuse borderline schemes. Only when CONCORD_VIABILITY_ETHICS is on and
  // the corpus is loaded; otherwise null → proposeScheme behaves exactly as today.
  const valueRuleIndex = (ethicsEnabled() && _state?.dtus) ? getSharedValueRuleIndex(_state.dtus) : null;

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
        valueRuleIndex,
      });
      if (r?.action === "proposed") stats.proposed++;
    } catch { /* noop */ }
  }

  // 3) T2.1 — NPC-autonomous secret weaponisation. Holders that hold a secret
  //    against a live NPC subject and have a hostile disposition open a
  //    blackmail scheme along that secret-edge (the secret is the motive).
  //    Fires once per secret. Best-effort — never blocks the cycle.
  try {
    const { weaponiseHeldSecrets } = await import("../lib/secrets.js");
    const w = weaponiseHeldSecrets(db, { proposeScheme, io: _state?.io || globalThis.__CONCORD_IO__ || null });
    stats.secretsWeaponised = (w?.weaponised || []).length;
    stats.proposed += stats.secretsWeaponised;
  } catch { /* secrets substrate optional */ }

  return stats;
}
