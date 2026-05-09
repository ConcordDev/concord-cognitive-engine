// server/emergent/mount-care-cycle.js
//
// Concordia Procedural Mount System Phase B4 — care heartbeat.
//
// Periodically applies decay across all mountable companions. Cap the
// per-cycle work at MAX_PER_PASS so a server with thousands of mounts
// doesn't spike the heartbeat budget. Wrapped in try/catch — never
// throws (CLAUDE.md heartbeat invariant).
//
// Frequency: 60 ticks (~15 min). Tunable via CONCORD_MOUNT_CARE_BATCH.
//
// Events emitted via realtime (best-effort):
//   mount:hungry       { companionId, hunger }    when hunger ≥ 70
//   mount:loyalty-low  { companionId, loyalty }   when loyalty < threshold
//
// Kill-switch: FF_MOUNT_CARE=0 → handler returns {ok:true, reason:'flag_off'}.

import { decayCare, getCareState, LOYALTY_RIDE_THRESHOLD } from "../lib/mount-care.js";
import { getFlag, getFlagNumber } from "../lib/feature-flags.js";

function maxPerPass() {
  return getFlagNumber("CONCORD_MOUNT_CARE_BATCH", 200);
}

/**
 * Heartbeat handler. Lazy decay path — most decay actually flows
 * through `getCareState` / `decayCare` on the player's read path
 * (the mount HUD), so this cycle is a backstop for offline mounts
 * the player hasn't visited recently.
 */
export async function runMountCareCycle({ db, state: _state } = {}) {
  if (!getFlag("FF_MOUNT_CARE", 1)) return { ok: true, reason: "flag_off", processed: 0 };
  if (!db) return { ok: true, reason: "no_db", processed: 0 };

  let processed = 0;
  let neglectful = 0;
  const hungry = [];
  const loyaltyLow = [];

  try {
    const candidates = db.prepare(`
      SELECT id, owner_id, world_id, last_action_at, loyalty
      FROM player_companions
      WHERE mount_eligible = 1
      ORDER BY COALESCE(last_action_at, 0) ASC
      LIMIT ?
    `).all(maxPerPass());

    for (const c of candidates) {
      try {
        const r = decayCare(db, c.id);
        if (!r.ok) continue;
        processed++;
        if (!r.applied) continue;
        neglectful++;
        // Re-read post-decay state for the threshold checks.
        const cs = getCareState(db, c.id);
        if (cs?.state?.hunger >= 70) {
          hungry.push({ companionId: c.id, ownerId: c.owner_id, hunger: cs.state.hunger });
        }
        if (cs && cs.loyalty < LOYALTY_RIDE_THRESHOLD) {
          loyaltyLow.push({ companionId: c.id, ownerId: c.owner_id, loyalty: cs.loyalty });
        }
      } catch { /* per-mount failure never breaks the cycle */ }
    }

    // Emit best-effort realtime notifications.
    const REALTIME = globalThis._concordREALTIME;
    if (REALTIME?.io) {
      for (const h of hungry) {
        try { REALTIME.io.to(`user:${h.ownerId}`).emit("mount:hungry", h); } catch { /* ignore */ }
      }
      for (const l of loyaltyLow) {
        try { REALTIME.io.to(`user:${l.ownerId}`).emit("mount:loyalty-low", l); } catch { /* ignore */ }
      }
    }
  } catch (err) {
    return { ok: false, reason: err.message, processed };
  }

  return { ok: true, processed, neglectful, hungry: hungry.length, loyaltyLow: loyaltyLow.length };
}
