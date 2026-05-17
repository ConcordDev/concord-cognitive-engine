// server/lib/draft-gc.js
//
// Phase 1 — sweep helper for the draft-gc-cycle heartbeat.
// Hard-deletes lens_drafts rows older than DRAFT_TTL_DAYS.
//
// A draft that hasn't been touched in 30 days is dead intent. We hold
// long enough that a user returning after vacation still finds their
// half-finished work, then reclaim. Tunable via CONCORD_DRAFT_TTL_DAYS.

export const DEFAULT_DRAFT_TTL_DAYS = 30;

export function getDraftTtlDays() {
  const env = parseInt(process.env.CONCORD_DRAFT_TTL_DAYS || "", 10);
  if (Number.isFinite(env) && env > 0 && env < 365) return env;
  return DEFAULT_DRAFT_TTL_DAYS;
}

export function sweepExpiredDrafts(db, { now = Math.floor(Date.now() / 1000), ttlDays = getDraftTtlDays() } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const cutoff = now - ttlDays * 86400;
  const stmt = db.prepare("DELETE FROM lens_drafts WHERE updated_at < ?");
  const info = stmt.run(cutoff);
  return { ok: true, removed: info.changes, cutoff, ttlDays };
}
