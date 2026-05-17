// server/emergent/draft-gc-cycle.js
//
// Phase 1 heartbeat: hard-delete lens_drafts rows whose updated_at is
// older than DRAFT_TTL_DAYS (default 30, env CONCORD_DRAFT_TTL_DAYS).
//
// Frequency 480 (~2h). Cheap; bounded by idx_lens_drafts_updated_at.
//
// Per heartbeat invariant: NEVER throws. Kill-switch:
// CONCORD_DRAFT_GC=0.

import { sweepExpiredDrafts } from "../lib/draft-gc.js";

export async function runDraftGcCycle({ db } = {}) {
  if (process.env.CONCORD_DRAFT_GC === "0") {
    return { ok: false, reason: "disabled" };
  }
  if (!db) return { ok: false, reason: "no_db" };
  try {
    return sweepExpiredDrafts(db);
  } catch (e) {
    return { ok: false, reason: "sweep_failed", error: String(e?.message || e) };
  }
}
