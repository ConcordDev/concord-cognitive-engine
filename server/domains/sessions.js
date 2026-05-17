// server/domains/sessions.js
//
// Phase 5 of the UX completeness sprint — multi-step workflow sessions.
//
// Six macros powering the useLensSession hook:
//
//   sessions.start          — create a session, return id + initial state.
//   sessions.advance        — transition current_step; append 'advanced' event.
//   sessions.update_state   — deep-merge into state_json; append 'state_merged' event.
//   sessions.get            — load one session + most recent N events.
//   sessions.list_mine      — caller's sessions, status-filtered.
//   sessions.close          — transition to 'completed' or 'abandoned'.
//
// Authorisation: every macro requires ctx.actor.userId. Anonymous calls
// return {ok:false, reason:'no_user'}. The handlers self-scope so the
// public-read gate doesn't leak anyone's session state.
//
// State JSON is opaque to the server (lens-defined). Hard-capped at
// 1 MiB to prevent runaway growth.

import { randomUUID } from "node:crypto";

const MAX_STATE_BYTES = 1024 * 1024;
const MAX_EVENT_PAYLOAD_BYTES = 64 * 1024;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 25;
const DEFAULT_EVENT_LIMIT = 50;

function payloadByteLength(json) {
  try { return Buffer.byteLength(json, "utf8"); }
  catch { return Infinity; }
}

/**
 * Recursive deep-merge for plain objects. Arrays + non-object values
 * are replaced (not merged). null in patch deletes the key.
 */
function deepMerge(target, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const out = { ...(target || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) { delete out[k]; continue; }
    if (typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && out[k] !== null && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function safeParseJson(text, fallback) {
  if (!text) return fallback;
  try { return JSON.parse(text); }
  catch { return fallback; }
}

export default function registerSessionsMacros(register) {
  /**
   * sessions.start — create a new session.
   * input: { lensId, title?, initialStep?, initialState? }
   */
  register("sessions", "start", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };

    const lensId = String(input.lensId || "").trim();
    if (!lensId) return { ok: false, reason: "missing_lens_id" };
    if (lensId.length > 64) return { ok: false, reason: "lens_id_too_long" };

    const title = input.title != null ? String(input.title).slice(0, 200) : null;
    const initialStep = input.initialStep != null ? String(input.initialStep).slice(0, 64) : null;
    let stateJson;
    try { stateJson = JSON.stringify(input.initialState ?? {}); }
    catch { return { ok: false, reason: "state_not_serialisable" }; }
    if (payloadByteLength(stateJson) > MAX_STATE_BYTES) {
      return { ok: false, reason: "state_too_large", max_bytes: MAX_STATE_BYTES };
    }

    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    try {
      db.prepare(`
        INSERT INTO lens_sessions
          (id, user_id, lens_id, title, status, current_step, state_json, step_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'open', ?, ?, 0, ?, ?)
      `).run(id, userId, lensId, title, initialStep, stateJson, now, now);

      db.prepare(`
        INSERT INTO lens_session_events
          (session_id, event_kind, from_step, to_step, note, payload_json, created_at)
        VALUES (?, 'started', NULL, ?, ?, NULL, ?)
      `).run(id, initialStep, title, now);
    } catch (e) {
      return { ok: false, reason: "db_error", error: String(e?.message || e) };
    }

    return {
      ok: true,
      session: {
        id, userId, lensId, title, status: "open",
        currentStep: initialStep, state: JSON.parse(stateJson),
        stepCount: 0, createdAt: now, updatedAt: now, closedAt: null,
      },
    };
  }, { note: "create a new multi-step session" });

  /**
   * sessions.advance — transition to a new step.
   * input: { sessionId, toStep, note?, stateMerge? }
   */
  register("sessions", "advance", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };

    const sessionId = String(input.sessionId || "").trim();
    const toStep = input.toStep != null ? String(input.toStep).slice(0, 64) : null;
    if (!sessionId) return { ok: false, reason: "missing_session_id" };
    if (!toStep) return { ok: false, reason: "missing_to_step" };

    const row = db.prepare(`SELECT * FROM lens_sessions WHERE id = ? AND user_id = ?`).get(sessionId, userId);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status !== "open" && row.status !== "paused") {
      return { ok: false, reason: "session_not_active", status: row.status };
    }

    const note = input.note != null ? String(input.note).slice(0, 500) : null;
    let nextState = safeParseJson(row.state_json, {});
    if (input.stateMerge && typeof input.stateMerge === "object") {
      nextState = deepMerge(nextState, input.stateMerge);
    }
    const nextStateJson = JSON.stringify(nextState);
    if (payloadByteLength(nextStateJson) > MAX_STATE_BYTES) {
      return { ok: false, reason: "state_too_large", max_bytes: MAX_STATE_BYTES };
    }

    const now = Math.floor(Date.now() / 1000);
    const newStepCount = (row.step_count || 0) + 1;

    try {
      db.prepare(`
        UPDATE lens_sessions
        SET current_step = ?, state_json = ?, step_count = ?, updated_at = ?, status = 'open'
        WHERE id = ? AND user_id = ?
      `).run(toStep, nextStateJson, newStepCount, now, sessionId, userId);

      db.prepare(`
        INSERT INTO lens_session_events
          (session_id, event_kind, from_step, to_step, note, payload_json, created_at)
        VALUES (?, 'advanced', ?, ?, ?, ?, ?)
      `).run(sessionId, row.current_step, toStep, note, input.stateMerge ? JSON.stringify(input.stateMerge).slice(0, MAX_EVENT_PAYLOAD_BYTES) : null, now);
    } catch (e) {
      return { ok: false, reason: "db_error", error: String(e?.message || e) };
    }

    return {
      ok: true,
      session: {
        id: sessionId, userId, lensId: row.lens_id, title: row.title,
        status: "open", currentStep: toStep, state: nextState,
        stepCount: newStepCount, createdAt: row.created_at, updatedAt: now, closedAt: row.closed_at,
      },
    };
  }, { note: "advance session to next step" });

  /**
   * sessions.update_state — deep-merge a state patch, no step change.
   * input: { sessionId, statePatch }
   */
  register("sessions", "update_state", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };

    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) return { ok: false, reason: "missing_session_id" };
    if (!input.statePatch || typeof input.statePatch !== "object") {
      return { ok: false, reason: "missing_state_patch" };
    }

    const row = db.prepare(`SELECT * FROM lens_sessions WHERE id = ? AND user_id = ?`).get(sessionId, userId);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status !== "open" && row.status !== "paused") {
      return { ok: false, reason: "session_not_active", status: row.status };
    }

    const next = deepMerge(safeParseJson(row.state_json, {}), input.statePatch);
    const nextJson = JSON.stringify(next);
    if (payloadByteLength(nextJson) > MAX_STATE_BYTES) {
      return { ok: false, reason: "state_too_large", max_bytes: MAX_STATE_BYTES };
    }

    const now = Math.floor(Date.now() / 1000);
    try {
      db.prepare(`UPDATE lens_sessions SET state_json = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .run(nextJson, now, sessionId, userId);

      db.prepare(`
        INSERT INTO lens_session_events (session_id, event_kind, from_step, to_step, note, payload_json, created_at)
        VALUES (?, 'state_merged', ?, ?, NULL, ?, ?)
      `).run(sessionId, row.current_step, row.current_step, JSON.stringify(input.statePatch).slice(0, MAX_EVENT_PAYLOAD_BYTES), now);
    } catch (e) {
      return { ok: false, reason: "db_error", error: String(e?.message || e) };
    }

    return { ok: true, state: next, updatedAt: now };
  }, { note: "merge a patch into session state without advancing" });

  /**
   * sessions.get — fetch one session + recent events.
   * input: { sessionId, eventLimit? }
   */
  register("sessions", "get", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };

    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) return { ok: false, reason: "missing_session_id" };

    const row = db.prepare(`SELECT * FROM lens_sessions WHERE id = ? AND user_id = ?`).get(sessionId, userId);
    if (!row) return { ok: false, reason: "not_found" };

    const eventLimit = Math.min(Math.max(Number(input.eventLimit) || DEFAULT_EVENT_LIMIT, 1), 200);
    const events = db.prepare(`
      SELECT id, event_kind, from_step, to_step, note, payload_json, created_at
      FROM lens_session_events
      WHERE session_id = ?
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    `).all(sessionId, eventLimit).map(e => ({
      id: e.id,
      kind: e.event_kind,
      fromStep: e.from_step,
      toStep: e.to_step,
      note: e.note,
      payload: e.payload_json ? safeParseJson(e.payload_json, null) : null,
      createdAt: e.created_at,
    }));

    return {
      ok: true,
      session: {
        id: row.id, userId, lensId: row.lens_id, title: row.title, status: row.status,
        currentStep: row.current_step, state: safeParseJson(row.state_json, {}),
        stepCount: row.step_count, createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at,
      },
      events,
    };
  }, { note: "fetch session + recent events" });

  /**
   * sessions.list_mine — list caller's sessions.
   * input: { lensId?, status?, limit? }
   */
  register("sessions", "list_mine", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };

    const lensId = input.lensId ? String(input.lensId).slice(0, 64) : null;
    const status = input.status ? String(input.status).slice(0, 16) : null;
    const limit = Math.min(Math.max(Number(input.limit) || DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);

    const conds = ["user_id = ?"];
    const args = [userId];
    if (lensId) { conds.push("lens_id = ?"); args.push(lensId); }
    if (status) { conds.push("status = ?"); args.push(status); }

    const rows = db.prepare(`
      SELECT id, lens_id, title, status, current_step, step_count, created_at, updated_at, closed_at
      FROM lens_sessions
      WHERE ${conds.join(" AND ")}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...args, limit);

    return {
      ok: true,
      sessions: rows.map(r => ({
        id: r.id, lensId: r.lens_id, title: r.title, status: r.status,
        currentStep: r.current_step, stepCount: r.step_count,
        createdAt: r.created_at, updatedAt: r.updated_at, closedAt: r.closed_at,
      })),
      total: rows.length,
    };
  }, { note: "list caller's sessions" });

  /**
   * sessions.close — transition to 'completed' or 'abandoned'.
   * input: { sessionId, outcome: 'completed'|'abandoned', note? }
   */
  register("sessions", "close", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_user" };

    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) return { ok: false, reason: "missing_session_id" };
    const outcome = String(input.outcome || "").trim();
    if (outcome !== "completed" && outcome !== "abandoned") {
      return { ok: false, reason: "invalid_outcome" };
    }

    const row = db.prepare(`SELECT id, status, current_step FROM lens_sessions WHERE id = ? AND user_id = ?`).get(sessionId, userId);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status === "completed" || row.status === "abandoned") {
      return { ok: false, reason: "already_closed", status: row.status };
    }

    const note = input.note != null ? String(input.note).slice(0, 500) : null;
    const now = Math.floor(Date.now() / 1000);

    try {
      db.prepare(`UPDATE lens_sessions SET status = ?, closed_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
        .run(outcome, now, now, sessionId, userId);

      db.prepare(`
        INSERT INTO lens_session_events (session_id, event_kind, from_step, to_step, note, payload_json, created_at)
        VALUES (?, ?, ?, NULL, ?, NULL, ?)
      `).run(sessionId, outcome, row.current_step, note, now);
    } catch (e) {
      return { ok: false, reason: "db_error", error: String(e?.message || e) };
    }

    return { ok: true, sessionId, status: outcome, closedAt: now };
  }, { note: "close a session" });
}
