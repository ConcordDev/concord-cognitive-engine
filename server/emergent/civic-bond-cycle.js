// server/emergent/civic-bond-cycle.js
//
// Civic Capital heartbeat — auto-pause the stalled drives (the policy's
// participation-collapse / overdue-funding safeguard). Frequency ~60 ticks
// (~15 min). Cheap; bounded. Never throws.
//
// Kill-switch: CONCORD_CIVIC_BONDS (off → no-op, same as the rest of the
// civic-bonds surface). Milestone-deadline + maturity closeout are ruler-
// triggered (macros), so the cycle's job is the auto-pause safeguard.

import logger from "../logger.js";
import { sweepStalledBonds, civicBondsEnabled } from "../lib/civic-bonds.js";

export const CIVIC_BOND_CYCLE_FREQUENCY = 60;

export async function runCivicBondCycle({ db } = {}) {
  if (!civicBondsEnabled()) return { ok: true, reason: "disabled", paused: 0 };
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const r = sweepStalledBonds(db, {});
    if (r.paused > 0) {
      logger.info?.("civic-bond-cycle", "auto_paused_stalled_bonds", { paused: r.paused });
    }
    return { ok: true, paused: r.paused || 0 };
  } catch (err) {
    try { logger.debug?.("civic-bond-cycle", "sweep_failed", { error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: String(err?.message || err) };
  }
}
