// server/emergent/capture-cycle.js
//
// Temperament P5 driver — advances active NPC captures through the
// carry → load → transport haul and rolls an escape attempt each pass. The
// resolver functions (advanceCapture / attemptEscape) were built + tested but had
// no clock; this is that clock. Delivery to jail/ransom stays a deliberate
// player/route action (the captor decides), so the cycle hauls but never
// auto-delivers. Behind CONCORD_TEMPERAMENT; never throws.

import { advanceCapture, attemptEscape } from "../lib/capture-transport.js";
import { temperamentEnabled } from "../lib/npc-temperament.js";
import logger from "../logger.js";

const HAUL_ORDER = ["captured", "carried", "loaded", "transported"];

export async function runCaptureCycle({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!temperamentEnabled()) return { ok: true, reason: "disabled", processed: 0 };

  const REALTIME = globalThis._concordREALTIME || globalThis.__CONCORD_REALTIME__;
  const emit = (worldId, event, payload) => {
    try { REALTIME?.io?.to?.(`world:${worldId}`)?.emit?.(event, payload); } catch { /* best-effort */ }
  };

  let rows = [];
  try {
    rows = db.prepare(
      `SELECT id, npc_id, captor_id, world_id, stage FROM npc_captures
       WHERE stage IN ('captured','carried','loaded','transported')`
    ).all();
  } catch {
    // npc_captures table absent (migration 318 not applied) — nothing to do.
    return { ok: true, reason: "no_table", processed: 0 };
  }

  let advanced = 0, escaped = 0;
  for (const c of rows) {
    try {
      // 1) Escape roll first — a captive that breaks free this tick isn't hauled.
      const esc = attemptEscape(db, c.id);
      if (esc.ok && esc.escaped) {
        escaped += 1;
        emit(c.world_id, "capture:escaped", { captureId: c.id, npcId: c.npc_id, chance: esc.chance });
        continue;
      }
      // 2) Otherwise haul one stage toward 'transported' (delivery is manual).
      const next = HAUL_ORDER[HAUL_ORDER.indexOf(c.stage) + 1];
      if (next) {
        const a = advanceCapture(db, c.id, next);
        if (a.ok) {
          advanced += 1;
          emit(c.world_id, "capture:advanced", { captureId: c.id, npcId: c.npc_id, stage: next });
        }
      }
    } catch (e) {
      logger.warn?.("capture-cycle", "capture_error", { captureId: c.id, error: e?.message });
    }
  }
  return { ok: true, processed: rows.length, advanced, escaped };
}

export default runCaptureCycle;
