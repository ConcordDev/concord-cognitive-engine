// server/domains/ghost-hunt.js — Phase V ghost-tracker surface for the
// ghost-hunt game-mode lens.
//
// Macros:
//   ghost-hunt.residues  — list spectral drift_alerts in the player's world
//   ghost-hunt.confront  — mark a residue confronted; logs to npc_ambition_log

import crypto from "node:crypto";

export default function registerGhostHuntMacros(register) {
  register("ghost-hunt", "residues", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const { worldId, limit = 30 } = input || {};
    try {
      // drift_alerts may scope by world via a context_json field.
      // Filter to spectral / ghost / refusal drift types.
      const rows = db.prepare(`
        SELECT id, drift_type, severity, signature, context_json, detected_at
          FROM drift_alerts
         WHERE drift_type IN ('spectral', 'echo_chamber', 'self_reference', 'memetic_drift')
         ORDER BY detected_at DESC
         LIMIT ?
      `).all(Math.min(100, Math.max(1, Number(limit))));
      const filtered = worldId
        ? rows.filter(r => {
            try { return JSON.parse(r.context_json || '{}')?.worldId === worldId; }
            catch { return false; }
          })
        : rows;
      return { ok: true, residues: filtered };
    } catch (err) {
      return { ok: false, reason: "query_failed", err: String(err?.message || err) };
    }
  }, { note: "List spectral drift residues — feed for the ghost-tracker lens." });

  register("ghost-hunt", "confront", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!db || !userId) return { ok: false, reason: "no_db_or_actor" };
    const { residueId, worldId } = input || {};
    if (!residueId) return { ok: false, reason: "missing_residue_id" };
    try {
      // Append to npc_ambition_log as the audit trail; the residue
      // doesn't get deleted (drift_alerts are append-only) but the
      // confrontation is a recorded action.
      try {
        db.prepare(`
          INSERT INTO npc_ambition_log (id, npc_id, move_kind, target_kind, target_id, world_id, outcome)
          VALUES (?, ?, 'confront', 'ghost_residue', ?, ?, ?)
        `).run(`ambm_${crypto.randomUUID()}`, userId, residueId, worldId ?? null, 'player_confront');
      } catch { /* table may not exist on minimal builds */ }
      try {
        if (globalThis?.__CONCORD_REALTIME__?.io) {
          globalThis.__CONCORD_REALTIME__.io.emit("ghost-hunt:residue-confronted", { residueId, userId, worldId });
        }
      } catch { /* sockets optional */ }
      return { ok: true, residueId, confrontedBy: userId };
    } catch (err) {
      return { ok: false, reason: "log_failed", err: String(err?.message || err) };
    }
  }, { note: "Record a player's confrontation with a spectral drift residue." });
}
