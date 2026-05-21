// server/domains/goddess.js
//
// Goddess lens — interactive surface over Concordia's ambient dispatch
// feed. The base feed (goddess.recent / goddess.compose_now) is an
// inline register() pair in server.js reading the goddess_dispatches
// table. This module adds the buildable feature-parity backlog:
//
//   - detail        — single dispatch drill-in / permalink resolve
//   - archive       — full-text search across the dispatch history
//   - react         — commune (react) on a dispatch, persisted per user
//   - reactions     — read aggregate + own reactions for a dispatch
//   - subscribe     — subscribe to a tone so a tone change notifies you
//   - subscriptions — list own subscriptions + any matched notifications
//   - correlate     — link a dispatch to the world event near its compose
//
// Dispatches themselves live in the goddess_dispatches table (read via
// ctx.db). Reactions + subscriptions are per-user runtime state on
// globalThis._concordSTATE, keyed by ctx.userId — they survive across
// macro calls within a process and persist via _concordSaveStateDebounced.
// Every handler is try/catch wrapped and returns { ok: boolean, ... };
// none throw.

const COMMUNE_KINDS = new Set(["heard", "blessed", "grieved", "questioned", "vowed"]);
const KNOWN_TONES = new Set(["exalted", "warm", "neutral", "cold", "mourning"]);
const SEARCH_MAX_ROWS = 200;

function userIdOf(ctx) {
  return ctx?.actor?.userId || ctx?.userId || "anon";
}

function persistState() {
  if (typeof globalThis._concordSaveStateDebounced === "function") {
    try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
  }
}

function goddessState() {
  const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
  if (!STATE.goddessLens) STATE.goddessLens = {};
  const s = STATE.goddessLens;
  // reactions: dispatchId(string) -> Map(userId -> { kind, note, at })
  if (!(s.reactions instanceof Map)) s.reactions = new Map();
  // subscriptions: userId -> Array<{ id, tone, worldId, createdAt, lastSeenDispatchId }>
  if (!(s.subscriptions instanceof Map)) s.subscriptions = new Map();
  return s;
}

function reactionsFor(s, dispatchId) {
  const key = String(dispatchId);
  if (!s.reactions.has(key)) s.reactions.set(key, new Map());
  return s.reactions.get(key);
}

function subsFor(s, userId) {
  if (!s.subscriptions.has(userId)) s.subscriptions.set(userId, []);
  return s.subscriptions.get(userId);
}

// Resolve a single dispatch row from the dispatch table by id.
function fetchDispatch(db, dispatchId) {
  if (!db) return null;
  try {
    return db.prepare(`
      SELECT id, world_id, tone, ecosystem_score, refusal_strength, drift_kind, body, composed_at
      FROM goddess_dispatches WHERE id = ?
    `).get(Number(dispatchId)) || null;
  } catch { return null; }
}

export default function registerGoddessActions(registerLensAction) {
  /**
   * detail — resolve a single dispatch by id (permalink target). Also
   * returns the immediately-prior and immediately-next dispatch in the
   * same world so the permalink view can offer prev/next navigation.
   *   params.dispatchId (required)
   */
  registerLensAction("goddess", "detail", (ctx, _artifact, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const dispatchId = Number(params.dispatchId);
    if (!Number.isFinite(dispatchId) || dispatchId <= 0) {
      return { ok: false, error: "dispatchId required" };
    }
    try {
      const dispatch = fetchDispatch(db, dispatchId);
      if (!dispatch) return { ok: false, error: "dispatch not found" };
      const prev = db.prepare(`
        SELECT id, tone, body, composed_at FROM goddess_dispatches
        WHERE world_id = ? AND composed_at < ?
        ORDER BY composed_at DESC LIMIT 1
      `).get(dispatch.world_id, dispatch.composed_at) || null;
      const next = db.prepare(`
        SELECT id, tone, body, composed_at FROM goddess_dispatches
        WHERE world_id = ? AND composed_at > ?
        ORDER BY composed_at ASC LIMIT 1
      `).get(dispatch.world_id, dispatch.composed_at) || null;
      const s = goddessState();
      const reactionCount = reactionsFor(s, dispatchId).size;
      return { ok: true, result: { dispatch, prev, next, reactionCount } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * archive — full-text search across the dispatch history for a world.
   * Filters by free-text query (body LIKE), tone, and an optional
   * [fromTs, toTs] unix-second window. Real rows only — empty result
   * when nothing matches.
   *   params.worldId (default concordia-hub)
   *   params.query? (matched against body)
   *   params.tone?  (one of the known tones)
   *   params.fromTs? params.toTs? (unix seconds)
   *   params.limit? (1..200)
   */
  registerLensAction("goddess", "archive", (ctx, _artifact, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const worldId = String(params.worldId || "concordia-hub");
    const query = String(params.query || "").trim();
    const tone = params.tone ? String(params.tone) : null;
    if (tone && !KNOWN_TONES.has(tone)) return { ok: false, error: "unknown tone" };
    const limit = Math.min(SEARCH_MAX_ROWS, Math.max(1, Number(params.limit) || 50));
    const fromTs = Number.isFinite(Number(params.fromTs)) ? Number(params.fromTs) : null;
    const toTs = Number.isFinite(Number(params.toTs)) ? Number(params.toTs) : null;
    try {
      const where = ["world_id = ?"];
      const args = [worldId];
      if (query) { where.push("body LIKE ?"); args.push(`%${query.replace(/[%_]/g, "")}%`); }
      if (tone) { where.push("tone = ?"); args.push(tone); }
      if (fromTs != null) { where.push("composed_at >= ?"); args.push(fromTs); }
      if (toTs != null) { where.push("composed_at <= ?"); args.push(toTs); }
      const rows = db.prepare(`
        SELECT id, tone, ecosystem_score, refusal_strength, drift_kind, body, composed_at
        FROM goddess_dispatches WHERE ${where.join(" AND ")}
        ORDER BY composed_at DESC LIMIT ?
      `).all(...args, limit);
      // Aggregate tone counts across the (unbounded) world history so the
      // archive UI can show a tone distribution chart.
      const toneRows = db.prepare(`
        SELECT tone, COUNT(*) AS n FROM goddess_dispatches
        WHERE world_id = ? GROUP BY tone
      `).all(worldId);
      const toneCounts = {};
      for (const r of toneRows) toneCounts[r.tone] = r.n;
      return {
        ok: true,
        result: { worldId, dispatches: rows, count: rows.length, toneCounts },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });

  /**
   * react — commune on a dispatch. Records (or replaces) the calling
   * user's reaction to one dispatch with a commune kind + optional note.
   *   params.dispatchId (required)
   *   params.kind (one of COMMUNE_KINDS; default "heard")
   *   params.note? (optional, <= 280 chars)
   */
  registerLensAction("goddess", "react", (ctx, _artifact, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const dispatchId = Number(params.dispatchId);
    if (!Number.isFinite(dispatchId) || dispatchId <= 0) {
      return { ok: false, error: "dispatchId required" };
    }
    const kind = String(params.kind || "heard");
    if (!COMMUNE_KINDS.has(kind)) return { ok: false, error: "invalid commune kind" };
    const dispatch = fetchDispatch(db, dispatchId);
    if (!dispatch) return { ok: false, error: "dispatch not found" };
    const note = String(params.note || "").trim().slice(0, 280);
    const userId = userIdOf(ctx);
    const s = goddessState();
    const map = reactionsFor(s, dispatchId);
    const entry = { kind, note, at: new Date().toISOString() };
    map.set(userId, entry);
    persistState();
    return {
      ok: true,
      result: { dispatchId, kind, note, reactionCount: map.size },
    };
  });

  /**
   * reactions — aggregate reactions for a dispatch: per-kind tallies,
   * the most recent commune notes, and the caller's own reaction.
   *   params.dispatchId (required)
   */
  registerLensAction("goddess", "reactions", (ctx, _artifact, params = {}) => {
    const dispatchId = Number(params.dispatchId);
    if (!Number.isFinite(dispatchId) || dispatchId <= 0) {
      return { ok: false, error: "dispatchId required" };
    }
    const userId = userIdOf(ctx);
    const s = goddessState();
    const map = reactionsFor(s, dispatchId);
    const byKind = {};
    const notes = [];
    for (const [uid, e] of map.entries()) {
      byKind[e.kind] = (byKind[e.kind] || 0) + 1;
      if (e.note) notes.push({ kind: e.kind, note: e.note, at: e.at, mine: uid === userId });
    }
    notes.sort((a, b) => (a.at < b.at ? 1 : -1));
    return {
      ok: true,
      result: {
        dispatchId,
        total: map.size,
        byKind,
        notes: notes.slice(0, 25),
        mine: map.get(userId) || null,
      },
    };
  });

  /**
   * subscribe — subscribe to a tone for a world. When the goddess next
   * speaks in that tone, subscriptions() surfaces it as a notification.
   * Re-subscribing to the same (tone, world) is idempotent.
   *   params.tone (one of KNOWN_TONES; required)
   *   params.worldId (default concordia-hub)
   */
  registerLensAction("goddess", "subscribe", (ctx, _artifact, params = {}) => {
    const tone = String(params.tone || "");
    if (!KNOWN_TONES.has(tone)) return { ok: false, error: "unknown tone" };
    const worldId = String(params.worldId || "concordia-hub");
    const userId = userIdOf(ctx);
    const s = goddessState();
    const list = subsFor(s, userId);
    let sub = list.find((x) => x.tone === tone && x.worldId === worldId);
    if (!sub) {
      sub = {
        id: `gsub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        tone,
        worldId,
        createdAt: new Date().toISOString(),
        lastSeenDispatchId: 0,
      };
      list.push(sub);
      persistState();
    }
    return { ok: true, result: { subscription: sub, count: list.length } };
  });

  /**
   * unsubscribe — remove a tone subscription by id.
   *   params.subscriptionId (required)
   */
  registerLensAction("goddess", "unsubscribe", (ctx, _artifact, params = {}) => {
    const subscriptionId = String(params.subscriptionId || "");
    if (!subscriptionId) return { ok: false, error: "subscriptionId required" };
    const userId = userIdOf(ctx);
    const s = goddessState();
    const list = subsFor(s, userId);
    const idx = list.findIndex((x) => x.id === subscriptionId);
    if (idx < 0) return { ok: false, error: "subscription not found" };
    list.splice(idx, 1);
    persistState();
    return { ok: true, result: { unsubscribed: subscriptionId, count: list.length } };
  });

  /**
   * subscriptions — list the caller's tone subscriptions, and for each
   * one any dispatches in that tone composed since the last poll. Polling
   * marks them seen so a notification fires exactly once per dispatch.
   */
  registerLensAction("goddess", "subscriptions", (ctx, _artifact, _params = {}) => {
    const db = ctx?.db;
    const userId = userIdOf(ctx);
    const s = goddessState();
    const list = subsFor(s, userId);
    const notifications = [];
    if (db) {
      for (const sub of list) {
        try {
          const rows = db.prepare(`
            SELECT id, tone, body, composed_at FROM goddess_dispatches
            WHERE world_id = ? AND tone = ? AND id > ?
            ORDER BY composed_at DESC LIMIT 20
          `).all(sub.worldId, sub.tone, sub.lastSeenDispatchId || 0);
          for (const r of rows) {
            notifications.push({ subscriptionId: sub.id, ...r });
            if (r.id > (sub.lastSeenDispatchId || 0)) sub.lastSeenDispatchId = r.id;
          }
        } catch { /* skip this subscription on db error */ }
      }
      if (notifications.length > 0) persistState();
    }
    notifications.sort((a, b) => b.composed_at - a.composed_at);
    return {
      ok: true,
      result: {
        subscriptions: list,
        count: list.length,
        notifications,
        unseenCount: notifications.length,
      },
    };
  });

  /**
   * correlate — find the world event most likely to have triggered a
   * dispatch: the world_events row in the same world whose start time is
   * closest to (and at or before) the dispatch compose time. Returns the
   * candidate event plus all events inside a configurable window so the
   * UI can show the surrounding context.
   *   params.dispatchId (required)
   *   params.windowSeconds? (default 3600, clamp 60..86400)
   */
  registerLensAction("goddess", "correlate", (ctx, _artifact, params = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, error: "no_db" };
    const dispatchId = Number(params.dispatchId);
    if (!Number.isFinite(dispatchId) || dispatchId <= 0) {
      return { ok: false, error: "dispatchId required" };
    }
    const dispatch = fetchDispatch(db, dispatchId);
    if (!dispatch) return { ok: false, error: "dispatch not found" };
    const windowSeconds = Math.min(86400, Math.max(60, Number(params.windowSeconds) || 3600));
    const composedAt = dispatch.composed_at;
    try {
      // world_events stores time as ISO/epoch depending on origin; we
      // probe for the columns the table actually has and degrade safely.
      const cols = db.prepare(`PRAGMA table_info(world_events)`).all().map((c) => c.name);
      if (cols.length === 0) {
        return { ok: true, result: { dispatch, candidate: null, nearby: [], reason: "no_world_events_table" } };
      }
      const timeCol = cols.includes("starts_at") ? "starts_at"
        : cols.includes("start_time") ? "start_time"
        : cols.includes("created_at") ? "created_at" : null;
      const titleCol = cols.includes("title") ? "title"
        : cols.includes("name") ? "name" : null;
      const typeCol = cols.includes("event_type") ? "event_type"
        : cols.includes("type") ? "type" : null;
      const worldCol = cols.includes("world_id") ? "world_id" : null;
      if (!timeCol) {
        return { ok: true, result: { dispatch, candidate: null, nearby: [], reason: "no_time_column" } };
      }
      const selParts = ["id", `${timeCol} AS event_time`];
      if (titleCol) selParts.push(`${titleCol} AS title`);
      if (typeCol) selParts.push(`${typeCol} AS event_type`);
      const where = [];
      const args = [];
      if (worldCol) { where.push(`${worldCol} = ?`); args.push(dispatch.world_id); }
      const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const rows = db.prepare(`
        SELECT ${selParts.join(", ")} FROM world_events ${whereSql}
        ORDER BY ${timeCol} DESC LIMIT 500
      `).all(...args);
      // Normalise event_time to unix seconds (handles ISO strings and ms).
      const norm = (v) => {
        if (v == null) return null;
        if (typeof v === "number") return v > 1e12 ? Math.floor(v / 1000) : Math.floor(v);
        const t = Date.parse(String(v));
        return Number.isFinite(t) ? Math.floor(t / 1000) : null;
      };
      const events = rows
        .map((r) => ({ ...r, ts: norm(r.event_time) }))
        .filter((r) => r.ts != null);
      const nearby = events
        .filter((r) => Math.abs(r.ts - composedAt) <= windowSeconds)
        .map((r) => ({ ...r, offsetSeconds: r.ts - composedAt }))
        .sort((a, b) => Math.abs(a.offsetSeconds) - Math.abs(b.offsetSeconds));
      // Best candidate: closest event at or before the compose time.
      const candidate = nearby.find((r) => r.offsetSeconds <= 0) || nearby[0] || null;
      return {
        ok: true,
        result: { dispatch, candidate, nearby: nearby.slice(0, 20), windowSeconds },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  });
}
