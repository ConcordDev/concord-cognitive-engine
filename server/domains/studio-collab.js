// server/domains/studio-collab.js
//
// Studio Sprint C Item #10 — in-instance real-time collaboration.
//
// Two producers on the same Concord instance subscribe to
// `session:${sessionDtuId}` via the existing realtimeEmit room
// pathway. Deltas append to session_deltas (migration 205) and
// fan out via socket so peers see edits within a frame.
//
// Cross-instance federation is deferred to Phase 2 — the
// federation outbox is eventually-consistent (minute-scale) and
// architecturally wrong for sub-second collab.

const VALID_DELTA_KINDS = new Set([
  "track_add", "track_update", "track_delete",
  "clip_add", "clip_update", "clip_delete", "clip_move",
  "effect_add", "effect_update", "effect_remove",
  "tempo_change", "marker_add",
  "transport_play", "transport_stop", "transport_seek",
  "selection_change", "cursor_move",
]);
const MAX_DELTA_BYTES = 8 * 1024;

function realtimeEmit() {
  return globalThis._concordRealtimeEmit || null;
}

export default function registerStudioCollabMacros(register) {
  // Join a session. Returns the last 100 deltas so the joiner can
  // catch up. The actual subscribe happens client-side via the
  // existing socket.io room mechanic.
  register("studio", "session_join", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const sessionDtuId = String(input.session_dtu_id || "").trim();
    if (!sessionDtuId) return { ok: false, reason: "session_dtu_id_required" };

    let deltas = [];
    try {
      deltas = db.prepare(`
        SELECT id, user_id, delta_kind, delta_json, server_ts FROM session_deltas
          WHERE session_dtu_id = ?
          ORDER BY server_ts DESC LIMIT 100
      `).all(sessionDtuId);
    } catch (err) {
      if (err?.message?.includes("no such table")) {
        return { ok: false, reason: "session_deltas_table_missing" };
      }
      return { ok: false, reason: "query_failed", error: err?.message };
    }

    // Fan-out a join announcement to peers in the room.
    const emit = realtimeEmit();
    if (typeof emit === "function") {
      try {
        emit("session:joined", { sessionDtuId, userId }, { sessionId: sessionDtuId });
      } catch { /* emit best-effort */ }
    }

    return {
      ok: true,
      sessionDtuId,
      room: `session:${sessionDtuId}`,
      backlog: deltas.reverse().map(d => ({
        id: d.id, user_id: d.user_id, kind: d.delta_kind,
        delta: safeParse(d.delta_json), server_ts: d.server_ts,
      })),
    };
  }, { note: "join a collaborative studio session, returns last 100 deltas" });

  register("studio", "session_emit_delta", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const sessionDtuId = String(input.session_dtu_id || "").trim();
    if (!sessionDtuId) return { ok: false, reason: "session_dtu_id_required" };
    const kind = String(input.delta?.kind || input.kind || "");
    if (!VALID_DELTA_KINDS.has(kind)) return { ok: false, reason: "invalid_delta_kind", valid: [...VALID_DELTA_KINDS] };
    const deltaPayload = input.delta?.payload ?? input.payload ?? {};
    const deltaJson = JSON.stringify(deltaPayload);
    if (deltaJson.length > MAX_DELTA_BYTES) return { ok: false, reason: "delta_too_large" };
    const clientTs = Number.isFinite(Number(input.client_ts)) ? Number(input.client_ts) : null;
    const originInstance = String(input.origin_instance || "").slice(0, 80) || null;

    let insertedId;
    try {
      const r = db.prepare(`
        INSERT INTO session_deltas
          (session_dtu_id, user_id, delta_kind, delta_json, client_ts, origin_instance)
          VALUES (?, ?, ?, ?, ?, ?)
      `).run(sessionDtuId, userId, kind, deltaJson, clientTs, originInstance);
      insertedId = r.lastInsertRowid;
    } catch (err) {
      if (err?.message?.includes("no such table")) {
        return { ok: false, reason: "session_deltas_table_missing" };
      }
      return { ok: false, reason: "insert_failed", error: err?.message };
    }

    // Fan-out to the session room. Each peer's client filters its
    // own emits (userId === self) so it doesn't re-apply.
    const emit = realtimeEmit();
    if (typeof emit === "function") {
      try {
        emit("session:delta", {
          sessionDtuId, userId, kind, payload: deltaPayload, deltaId: insertedId,
        }, { sessionId: sessionDtuId });
      } catch { /* emit best-effort */ }
    }

    return { ok: true, deltaId: insertedId };
  }, { note: "emit a session edit delta to all peers in the room" });

  register("studio", "session_list_deltas", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const sessionDtuId = String(input.session_dtu_id || "").trim();
    if (!sessionDtuId) return { ok: false, reason: "session_dtu_id_required" };
    const since = Math.max(0, parseInt(input.since) || 0);
    const limit = Math.max(1, Math.min(500, parseInt(input.limit) || 200));
    try {
      const rows = db.prepare(`
        SELECT id, user_id, delta_kind, delta_json, server_ts FROM session_deltas
          WHERE session_dtu_id = ? AND server_ts >= ?
          ORDER BY server_ts ASC LIMIT ?
      `).all(sessionDtuId, since, limit);
      return {
        ok: true,
        deltas: rows.map(r => ({
          id: r.id, user_id: r.user_id, kind: r.delta_kind,
          delta: safeParse(r.delta_json), server_ts: r.server_ts,
        })),
      };
    } catch (err) {
      if (err?.message?.includes("no such table")) {
        return { ok: false, reason: "session_deltas_table_missing" };
      }
      return { ok: false, reason: "query_failed", error: err?.message };
    }
  }, { note: "list deltas for a session since a server_ts cutoff" });
}

function safeParse(s) {
  try { return JSON.parse(s ?? "null"); } catch { return null; }
}

export const _internal = { VALID_DELTA_KINDS, MAX_DELTA_BYTES };
