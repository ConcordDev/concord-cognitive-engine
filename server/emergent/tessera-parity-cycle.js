// server/emergent/tessera-parity-cycle.js
//
// Heartbeat for the Tessera's managed parity (Sere). Each pass: ensure the
// canonical funding is seeded, then clamp the funded belligerents' momentum so
// their war can never reach the truce threshold. The war stays lit until the
// main arc cuts the funding (endFunding) — then it finally resolves.
//
// Scoped to world_id='sere'; never throws; kill-switched (CONCORD_TESSERA_PARITY=0).

import { seedManagedParity, clampParity, enabled } from "../lib/tessera-parity.js";
import logger from "../logger.js";

export async function runTesseraParity({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!enabled()) return { ok: true, reason: "disabled", clamped: 0 };
  try {
    seedManagedParity(db);                 // idempotent
    const r = clampParity(db, "sere");
    return { ok: true, clamped: r.clamped?.length || 0 };
  } catch (e) {
    logger.warn?.("tessera-parity", "cycle_error", { error: e?.message });
    return { ok: false, reason: e?.message };
  }
}

export default runTesseraParity;
