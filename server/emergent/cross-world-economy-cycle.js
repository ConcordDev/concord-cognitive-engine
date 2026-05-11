// server/emergent/cross-world-economy-cycle.js
//
// Heartbeat that refreshes world_economy_state for every authored
// world. Frequency 240 ticks (~1 hour in-game). Called from the
// governorTick() registry pattern. Does no cross-world enforcement
// itself — just keeps the snapshot fresh so the arbitrage engine has
// recent prices + wages + velocity to work from.
//
// Boundary discipline (per the multi-world rule of thumb):
//   This function operates EXCLUSIVELY at the world-snapshot layer.
//   It never crosses world boundaries. Per-world recomputation is
//   independent and idempotent. The kill switch is consulted by the
//   trade engine, not here — snapshot refresh is always safe even when
//   inter-world transactions are paused.

import { recomputeAllWorlds } from "../lib/cross-world-economy.js";

export async function runCrossWorldEconomyCycle({ db }) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const r = recomputeAllWorlds(db);
    return r;
  } catch (err) {
    return { ok: false, reason: "cycle_threw", error: String(err?.message || err) };
  }
}
