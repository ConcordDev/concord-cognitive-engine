// server/emergent/effects-decay-cycle.js
//
// SL4 tail — the missing periodic sweep. Expired `user_active_effects` rows are
// filtered by readers (expires_at checks) but only physically pruned inside
// cook-engine, so an idle world (nobody cooking) accumulates dead buff/debuff
// rows forever. This heartbeat runs the same prune on a clock — pure GC of
// already-expired rows (invisible to gameplay; readers already ignore them).
// scope:'global' (user_active_effects is a user-global table). Never throws.

import logger from "../logger.js";

export const EFFECTS_DECAY_FREQUENCY = 20; // ~5 min

export async function runEffectsDecayCycle({ db } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const r = db.prepare(`DELETE FROM user_active_effects WHERE expires_at < unixepoch()`).run();
    return { ok: true, swept: r.changes || 0 };
  } catch (err) {
    try { logger.debug?.("effects-decay-cycle", "sweep_failed", { error: err?.message }); } catch { /* noop */ }
    return { ok: false, reason: String(err?.message || err) };
  }
}
