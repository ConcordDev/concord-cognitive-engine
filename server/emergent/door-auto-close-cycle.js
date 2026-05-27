// server/emergent/door-auto-close-cycle.js
//
// Wave G6 — closes doors that have been open >60s.
//
// Heartbeat invariant: never throws. Kill switch: CONCORD_DOOR_AUTO_CLOSE=0.

import logger from "../logger.js";
import { autoCloseSweep } from "../lib/world-doors.js";

const MAX_PER_PASS = 500;

export async function runDoorAutoCloseCycle({ db } = {}) {
  if (process.env.CONCORD_DOOR_AUTO_CLOSE === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const r = autoCloseSweep(db, { maxRows: MAX_PER_PASS });
    if (r.closed > 0) {
      // Notify each world that a batch of doors closed. Coalesced single
      // emit rather than one per door to avoid socket spam.
      try {
        globalThis._concordRealtimeEmit?.("door:auto-closed", { count: r.closed });
      } catch { /* ok */ }
    }
    return { ok: true, closed: r.closed };
  } catch (err) {
    logger?.warn?.("door-auto-close", "cycle_failed", { error: err?.message });
    return { ok: false, reason: "exception", error: err?.message };
  }
}
