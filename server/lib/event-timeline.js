// server/lib/event-timeline.js
//
// Unified event timeline — sprint 8.
//
// Persists every realtime event to event_timeline_log (mig 169) so the
// new /lenses/timeline lens can show the full firehose with channel
// filter chips. Storage is async-best-effort — recording a timeline
// entry MUST NEVER throw inside an emit path.
//
// Read API:
//   listRecent(db, opts)  — paged list with optional channel/world filter
//   stats(db, opts)       — per-channel counts (last 24h by default)
//
// Write API:
//   recordEvent(db, channel, payload, opts)
//     channel:  socket event name (e.g. "npc:activity", "combat:hit")
//     payload:  any JSON-serialisable object (clamped to 8KB)
//     opts:     { worldId?, actorKind?, actorId? } — surface columns
//               for the index optimiser; payload still carries the
//               full object for the UI.

const MAX_PAYLOAD_BYTES = 8 * 1024;
const PRUNE_OLDER_THAN_SECONDS = 30 * 24 * 3600; // 30 days

export function recordEvent(db, channel, payload, opts = {}) {
  if (!db || !channel) return { ok: false, reason: "missing_inputs" };
  try {
    let payloadJson = "";
    if (payload !== undefined && payload !== null) {
      try {
        payloadJson = JSON.stringify(payload);
        if (payloadJson.length > MAX_PAYLOAD_BYTES) {
          payloadJson = JSON.stringify({ _truncated: true, _len: payloadJson.length });
        }
      } catch {
        payloadJson = JSON.stringify({ _unserialisable: true });
      }
    }
    db.prepare(`
      INSERT INTO event_timeline_log (channel, world_id, actor_kind, actor_id, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(channel, opts.worldId || null, opts.actorKind || null, opts.actorId || null, payloadJson);
    return { ok: true };
  } catch (err) {
    // Best-effort. Never throw upstream — emit path must stay open.
    return { ok: false, reason: "insert_failed", error: String(err?.message || err) };
  }
}

export function listRecent(db, opts = {}) {
  if (!db) return [];
  const limit = Math.min(500, Math.max(1, opts.limit || 100));
  const channels = Array.isArray(opts.channels) && opts.channels.length ? opts.channels : null;
  const worldId = opts.worldId || null;
  const sinceTs = opts.sinceTs || null;
  try {
    const where = [];
    const params = [];
    if (channels) {
      where.push(`channel IN (${channels.map(() => "?").join(",")})`);
      for (const c of channels) params.push(c);
    }
    if (worldId) {
      where.push(`world_id = ?`);
      params.push(worldId);
    }
    if (sinceTs) {
      where.push(`created_at >= ?`);
      params.push(sinceTs);
    }
    const sql = `
      SELECT id, channel, world_id, actor_kind, actor_id, payload_json, created_at
      FROM event_timeline_log
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `;
    params.push(limit);
    const rows = db.prepare(sql).all(...params);
    return rows.map(r => ({
      ...r,
      payload: r.payload_json ? safeParse(r.payload_json) : null,
    }));
  } catch {
    return [];
  }
}

export function stats(db, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const sinceTs = opts.sinceTs || Math.floor(Date.now() / 1000) - 24 * 3600;
  try {
    const rows = db.prepare(`
      SELECT channel, COUNT(*) AS count
      FROM event_timeline_log
      WHERE created_at >= ?
      GROUP BY channel
      ORDER BY count DESC
    `).all(sinceTs);
    const total = rows.reduce((s, r) => s + r.count, 0);
    return { ok: true, sinceTs, total, channels: rows };
  } catch {
    return { ok: false, reason: "stats_failed" };
  }
}

export function pruneOld(db, opts = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const cutoff = Math.floor(Date.now() / 1000) - (opts.olderThanSeconds || PRUNE_OLDER_THAN_SECONDS);
  try {
    const r = db.prepare(`DELETE FROM event_timeline_log WHERE created_at < ?`).run(cutoff);
    return { ok: true, deleted: r.changes };
  } catch {
    return { ok: false, reason: "prune_failed" };
  }
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export const TIMELINE_CONSTANTS = Object.freeze({
  MAX_PAYLOAD_BYTES,
  PRUNE_OLDER_THAN_SECONDS,
});
