// server/domains/event-timeline.js
//
// Sprint 8 — macro surface for the unified event timeline.
//
// All read-only. Plugged into publicReadDomains so the
// /lenses/timeline lens can poll without bearer auth.

export default function registerEventTimelineMacros(register, deps) {
  const { listRecent, stats } = deps;

  register("event_timeline", "recent", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const rows = listRecent(db, {
      limit: Math.min(500, input?.limit || 100),
      channels: Array.isArray(input?.channels) ? input.channels : null,
      worldId: input?.worldId || null,
      sinceTs: input?.sinceTs || null,
    });
    return { ok: true, count: rows.length, rows };
  }, { note: "Recent timeline rows. Filter by channels[] / worldId / sinceTs." });

  register("event_timeline", "stats", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const sinceTs = input?.sinceTs || (Math.floor(Date.now() / 1000) - 24 * 3600);
    return stats(db, { sinceTs });
  }, { note: "Per-channel event counts in the given window (default last 24h)." });
}
