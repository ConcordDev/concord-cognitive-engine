// server/emergent/prop-respawn-cycle.js
//
// Wave G1 — restores prop durability + clears stale state markers.
//
// Heartbeat invariant: never throws. Kill switch: CONCORD_PROP_RESPAWN=0.

import logger from "../logger.js";
import { refillProps } from "../lib/world-props.js";

const MAX_PER_PASS = 200;

export async function runPropRespawnCycle({ db } = {}) {
  if (process.env.CONCORD_PROP_RESPAWN === "0") return { ok: false, reason: "disabled" };
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const r = refillProps(db, { maxRows: MAX_PER_PASS });
    return { ok: true, touched: r.touched };
  } catch (err) {
    logger?.warn?.("prop-respawn", "cycle_failed", { error: err?.message });
    return { ok: false, reason: "exception", error: err?.message };
  }
}
