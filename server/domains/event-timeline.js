// server/domains/event-timeline.js
//
// Sprint 8 — macro surface for the unified event timeline.
//
// The original surface (recent + stats) is read-only and plugged into
// publicReadDomains so the lens can poll without bearer auth. The
// activity-feed-parity sprint adds an investigable read surface:
//   - search       — full-text search across channel + payload
//   - range        — events for an arbitrary [from, to] window
//   - detail       — single-event drill-in (full payload + linked entities)
//   - timeseries   — per-channel time-bucketed counts (for sparklines)
//   - channels     — distinct channels seen in a window (filter chips)
//   - exportEvents — filtered events serialised to CSV / JSON
//   - saved views  — per-user persisted filter presets
//
// The lib helpers (listRecent / stats) only cover the first two macros;
// everything else queries event_timeline_log directly through ctx.db.
// All handlers are try/catch wrapped and return { ok: boolean, ... };
// they never throw.

const EXPORT_MAX_ROWS = 5000;
const SEARCH_MAX_ROWS = 500;

// Per-user saved filter presets live on the shared runtime STATE so they
// survive across macro calls within a process lifetime.
function savedViewsMap() {
  const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
  if (!STATE.eventTimelineViews) STATE.eventTimelineViews = new Map();
  return STATE.eventTimelineViews;
}

function persistState() {
  if (typeof globalThis._concordSaveStateDebounced === "function") {
    try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
  }
}

function userIdOf(ctx) {
  return ctx?.actor?.userId || ctx?.userId || "anon";
}

function safeParse(s) {
  if (s == null) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// Flatten a payload object to a single lowercase search haystack.
function payloadHaystack(payloadJson) {
  if (!payloadJson) return "";
  return String(payloadJson).toLowerCase();
}

export default function registerEventTimelineMacros(register, deps) {
  const { listRecent, stats } = deps;

  // ── recent ──────────────────────────────────────────────────────────
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

  // ── stats ───────────────────────────────────────────────────────────
  register("event_timeline", "stats", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const sinceTs = input?.sinceTs || (Math.floor(Date.now() / 1000) - 24 * 3600);
    return stats(db, { sinceTs });
  }, { note: "Per-channel event counts in the given window (default last 24h)." });

  // ── channels ────────────────────────────────────────────────────────
  // Distinct channels seen in the window, with a count + the most recent
  // timestamp. Powers the channel-filter chips so the UI doesn't have to
  // hard-code a channel list.
  register("event_timeline", "channels", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    try {
      const sinceTs = Number(input?.sinceTs) ||
        (Math.floor(Date.now() / 1000) - 7 * 24 * 3600);
      const rows = db.prepare(`
        SELECT channel,
               COUNT(*) AS count,
               MAX(created_at) AS last_seen
        FROM event_timeline_log
        WHERE created_at >= ?
        GROUP BY channel
        ORDER BY count DESC
      `).all(sinceTs);
      return { ok: true, sinceTs, channels: rows };
    } catch (err) {
      return { ok: false, reason: "channels_failed", error: String(err?.message || err) };
    }
  }, { note: "Distinct channels in a window with counts + last-seen timestamp." });

  // ── search ──────────────────────────────────────────────────────────
  // Full-text search across the channel name + serialised payload. SQLite
  // LIKE on payload_json — adequate for the substrate log scale.
  register("event_timeline", "search", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    try {
      const q = String(input?.query || "").trim();
      if (q.length < 2) {
        return { ok: false, reason: "query_too_short", minLength: 2 };
      }
      const limit = Math.min(SEARCH_MAX_ROWS, Math.max(1, Number(input?.limit) || 100));
      const like = `%${q.toLowerCase()}%`;
      const where = [`(LOWER(channel) LIKE ? OR LOWER(IFNULL(payload_json,'')) LIKE ? OR LOWER(IFNULL(actor_id,'')) LIKE ?)`];
      const params = [like, like, like];
      if (Array.isArray(input?.channels) && input.channels.length) {
        where.push(`channel IN (${input.channels.map(() => "?").join(",")})`);
        for (const c of input.channels) params.push(c);
      }
      if (input?.worldId) { where.push(`world_id = ?`); params.push(input.worldId); }
      if (input?.fromTs) { where.push(`created_at >= ?`); params.push(Number(input.fromTs)); }
      if (input?.toTs) { where.push(`created_at <= ?`); params.push(Number(input.toTs)); }
      params.push(limit);
      const rows = db.prepare(`
        SELECT id, channel, world_id, actor_kind, actor_id, payload_json, created_at
        FROM event_timeline_log
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(...params);
      return {
        ok: true,
        query: q,
        count: rows.length,
        truncated: rows.length >= limit,
        rows: rows.map(r => ({ ...r, payload: safeParse(r.payload_json) })),
      };
    } catch (err) {
      return { ok: false, reason: "search_failed", error: String(err?.message || err) };
    }
  }, { note: "Full-text search across channel + payload + actor. query >= 2 chars." });

  // ── range ───────────────────────────────────────────────────────────
  // Events within an arbitrary [fromTs, toTs] window (unix seconds).
  register("event_timeline", "range", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    try {
      const fromTs = Number(input?.fromTs);
      const toTs = Number(input?.toTs) || Math.floor(Date.now() / 1000);
      if (!Number.isFinite(fromTs) || fromTs <= 0) {
        return { ok: false, reason: "invalid_from" };
      }
      if (toTs < fromTs) {
        return { ok: false, reason: "invalid_range" };
      }
      const limit = Math.min(500, Math.max(1, Number(input?.limit) || 200));
      const where = [`created_at >= ?`, `created_at <= ?`];
      const params = [fromTs, toTs];
      if (Array.isArray(input?.channels) && input.channels.length) {
        where.push(`channel IN (${input.channels.map(() => "?").join(",")})`);
        for (const c of input.channels) params.push(c);
      }
      if (input?.worldId) { where.push(`world_id = ?`); params.push(input.worldId); }
      params.push(limit);
      const rows = db.prepare(`
        SELECT id, channel, world_id, actor_kind, actor_id, payload_json, created_at
        FROM event_timeline_log
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(...params);
      return {
        ok: true,
        fromTs, toTs,
        count: rows.length,
        truncated: rows.length >= limit,
        rows: rows.map(r => ({ ...r, payload: safeParse(r.payload_json) })),
      };
    } catch (err) {
      return { ok: false, reason: "range_failed", error: String(err?.message || err) };
    }
  }, { note: "Events within an arbitrary [fromTs, toTs] unix-second window." });

  // ── detail ──────────────────────────────────────────────────────────
  // Single-event drill-in — full payload plus a "linked entities" pass
  // that pulls candidate identity references out of the payload and the
  // surrounding events in the same world within ±30s.
  register("event_timeline", "detail", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    try {
      const id = Number(input?.id);
      if (!Number.isFinite(id) || id <= 0) return { ok: false, reason: "invalid_id" };
      const row = db.prepare(`
        SELECT id, channel, world_id, actor_kind, actor_id, payload_json, created_at
        FROM event_timeline_log WHERE id = ?
      `).get(id);
      if (!row) return { ok: false, reason: "not_found" };
      const payload = safeParse(row.payload_json);

      // Extract linked entity references from the payload: any string
      // value whose key looks like an id reference.
      const linked = [];
      if (payload && typeof payload === "object") {
        for (const [k, v] of Object.entries(payload)) {
          if (/id$/i.test(k) && (typeof v === "string" || typeof v === "number")) {
            linked.push({ field: k, value: String(v) });
          }
        }
      }

      // Nearby context — events in the same world within ±30s.
      let nearby = [];
      try {
        const lo = row.created_at - 30;
        const hi = row.created_at + 30;
        nearby = db.prepare(`
          SELECT id, channel, actor_kind, actor_id, created_at
          FROM event_timeline_log
          WHERE created_at BETWEEN ? AND ?
            AND id != ?
            AND (world_id IS ? OR world_id = ?)
          ORDER BY created_at ASC, id ASC
          LIMIT 20
        `).all(lo, hi, id, row.world_id, row.world_id);
      } catch { nearby = []; }

      return {
        ok: true,
        event: { ...row, payload },
        linkedEntities: linked,
        nearby,
      };
    } catch (err) {
      return { ok: false, reason: "detail_failed", error: String(err?.message || err) };
    }
  }, { note: "Single-event drill-in: full payload, linked entity refs, ±30s nearby events." });

  // ── timeseries ──────────────────────────────────────────────────────
  // Per-channel time-bucketed counts — the input for trend sparklines.
  // Returns one series row per channel with an array of bucket counts.
  register("event_timeline", "timeseries", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    try {
      const now = Math.floor(Date.now() / 1000);
      const windowSec = Math.min(30 * 24 * 3600, Math.max(3600, Number(input?.windowSec) || 24 * 3600));
      const buckets = Math.min(96, Math.max(6, Number(input?.buckets) || 24));
      const fromTs = now - windowSec;
      const bucketSec = Math.ceil(windowSec / buckets);
      const channelFilter = Array.isArray(input?.channels) && input.channels.length
        ? input.channels : null;

      const where = [`created_at >= ?`];
      const params = [fromTs];
      if (channelFilter) {
        where.push(`channel IN (${channelFilter.map(() => "?").join(",")})`);
        for (const c of channelFilter) params.push(c);
      }
      if (input?.worldId) { where.push(`world_id = ?`); params.push(input.worldId); }

      const rows = db.prepare(`
        SELECT channel,
               CAST((created_at - ?) / ? AS INTEGER) AS bucket,
               COUNT(*) AS count
        FROM event_timeline_log
        WHERE ${where.join(" AND ")}
        GROUP BY channel, bucket
      `).all(fromTs, bucketSec, ...params);

      // Pivot into per-channel arrays.
      const byChannel = new Map();
      for (const r of rows) {
        if (!byChannel.has(r.channel)) {
          byChannel.set(r.channel, new Array(buckets).fill(0));
        }
        const idx = Math.min(buckets - 1, Math.max(0, r.bucket));
        byChannel.get(r.channel)[idx] += r.count;
      }
      const bucketStarts = [];
      for (let i = 0; i < buckets; i++) bucketStarts.push(fromTs + i * bucketSec);

      const series = Array.from(byChannel.entries())
        .map(([channel, counts]) => ({
          channel,
          counts,
          total: counts.reduce((s, n) => s + n, 0),
        }))
        .sort((a, b) => b.total - a.total);

      return {
        ok: true,
        fromTs, toTs: now,
        bucketSec, buckets,
        bucketStarts,
        series,
      };
    } catch (err) {
      return { ok: false, reason: "timeseries_failed", error: String(err?.message || err) };
    }
  }, { note: "Per-channel time-bucketed counts for trend sparklines." });

  // ── exportEvents ────────────────────────────────────────────────────
  // Serialise a filtered slice of the log to CSV or JSON. Returns the
  // text body + a suggested filename; the client triggers the download.
  register("event_timeline", "exportEvents", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    try {
      const format = input?.format === "json" ? "json" : "csv";
      const limit = Math.min(EXPORT_MAX_ROWS, Math.max(1, Number(input?.limit) || EXPORT_MAX_ROWS));
      const where = [];
      const params = [];
      if (Array.isArray(input?.channels) && input.channels.length) {
        where.push(`channel IN (${input.channels.map(() => "?").join(",")})`);
        for (const c of input.channels) params.push(c);
      }
      if (input?.worldId) { where.push(`world_id = ?`); params.push(input.worldId); }
      if (input?.fromTs) { where.push(`created_at >= ?`); params.push(Number(input.fromTs)); }
      if (input?.toTs) { where.push(`created_at <= ?`); params.push(Number(input.toTs)); }
      const q = String(input?.query || "").trim();
      if (q.length >= 2) {
        const like = `%${q.toLowerCase()}%`;
        where.push(`(LOWER(channel) LIKE ? OR LOWER(IFNULL(payload_json,'')) LIKE ?)`);
        params.push(like, like);
      }
      params.push(limit);
      const rows = db.prepare(`
        SELECT id, channel, world_id, actor_kind, actor_id, payload_json, created_at
        FROM event_timeline_log
        ${where.length ? "WHERE " + where.join(" AND ") : ""}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(...params);

      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      let body, filename, mime;
      if (format === "json") {
        body = JSON.stringify(
          rows.map(r => ({ ...r, payload: safeParse(r.payload_json), payload_json: undefined })),
          null, 2,
        );
        filename = `event-timeline-${stamp}.json`;
        mime = "application/json";
      } else {
        const esc = (v) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const header = ["id", "channel", "world_id", "actor_kind", "actor_id", "created_at", "iso_time", "payload"];
        const lines = [header.join(",")];
        for (const r of rows) {
          lines.push([
            r.id, r.channel, r.world_id, r.actor_kind, r.actor_id, r.created_at,
            new Date(r.created_at * 1000).toISOString(),
            r.payload_json || "",
          ].map(esc).join(","));
        }
        body = lines.join("\n");
        filename = `event-timeline-${stamp}.csv`;
        mime = "text/csv";
      }
      return { ok: true, format, count: rows.length, filename, mime, body };
    } catch (err) {
      return { ok: false, reason: "export_failed", error: String(err?.message || err) };
    }
  }, { note: "Export a filtered slice of the event log to CSV or JSON text." });

  // ── saveView ────────────────────────────────────────────────────────
  // Persist a per-user named filter preset (channels + worldId + query).
  register("event_timeline", "saveView", async (ctx, input = {}) => {
    try {
      const name = String(input?.name || "").trim();
      if (!name) return { ok: false, reason: "name_required" };
      if (name.length > 60) return { ok: false, reason: "name_too_long" };
      const uid = userIdOf(ctx);
      const map = savedViewsMap();
      const list = map.get(uid) || [];
      const view = {
        id: `view_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        channels: Array.isArray(input?.channels) ? input.channels.slice(0, 50) : [],
        worldId: input?.worldId || null,
        query: String(input?.query || "").slice(0, 200),
        createdAt: Math.floor(Date.now() / 1000),
      };
      const next = list.filter(v => v.name !== name);
      next.unshift(view);
      map.set(uid, next.slice(0, 30));
      persistState();
      return { ok: true, view, total: map.get(uid).length };
    } catch (err) {
      return { ok: false, reason: "save_view_failed", error: String(err?.message || err) };
    }
  }, { note: "Persist a per-user named filter preset." });

  // ── listViews ───────────────────────────────────────────────────────
  register("event_timeline", "listViews", async (ctx) => {
    try {
      const uid = userIdOf(ctx);
      const views = savedViewsMap().get(uid) || [];
      return { ok: true, count: views.length, views };
    } catch (err) {
      return { ok: false, reason: "list_views_failed", error: String(err?.message || err) };
    }
  }, { note: "List the caller's saved filter presets." });

  // ── deleteView ──────────────────────────────────────────────────────
  register("event_timeline", "deleteView", async (ctx, input = {}) => {
    try {
      const id = String(input?.id || "").trim();
      if (!id) return { ok: false, reason: "id_required" };
      const uid = userIdOf(ctx);
      const map = savedViewsMap();
      const list = map.get(uid) || [];
      const next = list.filter(v => v.id !== id);
      map.set(uid, next);
      persistState();
      return { ok: true, removed: list.length - next.length, total: next.length };
    } catch (err) {
      return { ok: false, reason: "delete_view_failed", error: String(err?.message || err) };
    }
  }, { note: "Delete one of the caller's saved filter presets." });
}
