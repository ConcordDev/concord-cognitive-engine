// server/emergent/combat-recovery-cycle.js
//
// Phase 8 heartbeat — gas recovery + rocked-state expiry + combo decay.
//
// Frequency: 2 ticks (~30s). Cheap; bounded.
//
// Per pass:
//   1. Recover gas for actors in 'idle'/'patrol'/'alert' (not 'combat')
//      at the profile's gas_recovery_per_s × elapsed since updated_at.
//   2. Decay stale combos: any combo_count > 0 whose combo_last_at_ms
//      is older than profile.combo_decay_after_ms gets reset to 0
//      with a 'combo_break' event.
//
// Kill-switch: CONCORD_COMBAT_RECOVERY=0.

import logger from "../logger.js";
import { COMBAT_PROFILES, recoverGas } from "../lib/combat-polish.js";

export async function runCombatRecoveryCycle({ db } = {}) {
  if (process.env.CONCORD_COMBAT_RECOVERY === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };

  const stats = { ok: true, recovered: 0, combos_decayed: 0, scanned: 0 };
  const now = Date.now();
  const nowSec = Math.floor(now / 1000);

  let actors = [];
  try {
    actors = db.prepare(`
      SELECT actor_kind, actor_id, profile_id, gas, max_gas,
             combo_count, combo_last_at_ms, awareness, world_id, updated_at
      FROM combat_actor_state
      WHERE gas < max_gas OR combo_count > 0
      LIMIT 1000
    `).all();
  } catch { return { ok: true, recovered: 0, reason: "no_table" }; }

  stats.scanned = actors.length;

  for (const a of actors) {
    const profile = COMBAT_PROFILES[a.profile_id] || COMBAT_PROFILES.street_freeroam;

    // Gas recovery — skip in active combat (recoverGas halves it itself).
    if (a.gas < a.max_gas) {
      const dt = Math.max(0, nowSec - (a.updated_at || nowSec));
      if (dt > 0) {
        try {
          const r = recoverGas(db, { actorKind: a.actor_kind, actorId: a.actor_id, dtSeconds: dt });
          if (r?.ok && r.gas_after !== a.gas) stats.recovered++;
        } catch (err) {
          try { logger.debug?.("combat-recovery", "gas_recover_failed", { id: a.actor_id, error: err?.message }); }
          catch { /* ignore */ }
        }
      }
    }

    // Combo decay — if last strike is older than the decay window, reset.
    if (a.combo_count > 0 && (now - a.combo_last_at_ms) > profile.combo_decay_after_ms) {
      try {
        db.prepare(`
          UPDATE combat_actor_state SET combo_count = 0, updated_at = unixepoch()
          WHERE actor_kind = ? AND actor_id = ?
        `).run(a.actor_kind, a.actor_id);
        // Use a single insert; don't import insertEvent (private to combat-polish).
        db.prepare(`
          INSERT INTO combat_events (id, world_id, actor_kind, actor_id, event_kind, detail_json, occurred_at)
          VALUES (?, ?, ?, ?, 'combo_break', ?, unixepoch())
        `).run(`ce_${a.actor_id}_${now}`, a.world_id, a.actor_kind, a.actor_id, JSON.stringify({ previous: a.combo_count, reason: "decay" }));
        stats.combos_decayed++;
      } catch { /* per-row skip */ }
    }
  }

  return stats;
}
