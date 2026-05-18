// server/domains/whiteboard-agent.js
//
// Whiteboard Sprint B Item #9 — agent-on-canvas macros.
//
// Reuses the agent_marathon_sessions schema (migration 171) for state
// + the heartbeat-tick pattern from code-background. Each session is
// kind='whiteboard_agent_session' in the marathon meta; publishable as
// agent_spec via Phase 13 marketplace.

import { randomUUID } from "node:crypto";
import { runAgentStep } from "../lib/whiteboard/canvas-agent.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

export default function registerWhiteboardAgentMacros(register) {
  register("whiteboard", "agent_start", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    const task = String(input.task || "").trim();
    if (!boardId || !task) return { ok: false, reason: "boardId_and_task_required" };
    const maxSteps = Math.min(15, Math.max(1, Number(input.maxSteps) || 6));
    const id = `wb_agent:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO agent_marathon_sessions (id, user_id, title, goal, status, max_turns, meta_json, next_tick_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, unixepoch())
      `).run(id, userId, task.slice(0, 200), task, maxSteps, JSON.stringify({
        kind: "whiteboard_agent_session", boardId, history: [],
      }));
      try {
        globalThis._concordREALTIME?.io?.to(`whiteboard:${boardId}`).emit("whiteboard:agent-start", {
          boardId, sessionId: id, userId, task, ts: Date.now(),
        });
      } catch { /* best-effort */ }
      return { ok: true, sessionId: id, boardId, maxSteps };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Start a canvas agent (one step per heartbeat tick at frequency 4)" });

  register("whiteboard", "agent_status", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const id = String(input.sessionId || input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    let meta = {}; try { meta = JSON.parse(row.meta_json || "{}"); } catch { /* ok */ }
    const turns = db.prepare(`SELECT turn_index, role, content, created_at FROM agent_marathon_turns WHERE session_id = ? ORDER BY turn_index ASC LIMIT 100`).all(id);
    return { ok: true, session: { ...row, meta }, turns };
  }, { note: "Read a canvas agent's status + turn log" });

  register("whiteboard", "agent_cancel", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.sessionId || input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const r = db.prepare(`UPDATE agent_marathon_sessions SET status = 'abandoned', completed_at = unixepoch() WHERE id = ? AND user_id = ? AND status IN ('pending','running','paused')`).run(id, userId);
    return { ok: true, cancelled: r.changes };
  }, { destructive: true, note: "Cancel a running canvas agent" });

  register("whiteboard", "agent_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = input.boardId ? String(input.boardId) : null;
    const rows = boardId
      ? db.prepare(`SELECT id, title, goal, status, total_turns, max_turns, created_at FROM agent_marathon_sessions WHERE user_id = ? AND meta_json LIKE '%"kind":"whiteboard_agent_session"%' AND meta_json LIKE ? ORDER BY created_at DESC LIMIT 50`).all(userId, `%"boardId":"${boardId}"%`)
      : db.prepare(`SELECT id, title, goal, status, total_turns, max_turns, created_at FROM agent_marathon_sessions WHERE user_id = ? AND meta_json LIKE '%"kind":"whiteboard_agent_session"%' ORDER BY created_at DESC LIMIT 50`).all(userId);
    return { ok: true, sessions: rows };
  }, { note: "List the user's canvas agent sessions" });

  // Heartbeat-driven step tick. Picks up to 5 due sessions, runs one
  // agent step each. Try/catch isolated per session.
  register("whiteboard", "agent_tick", async (ctx) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const due = db.prepare(`
      SELECT id, user_id, goal, total_turns, max_turns, meta_json
      FROM agent_marathon_sessions
      WHERE status IN ('pending','running')
        AND next_tick_at <= unixepoch()
        AND meta_json LIKE '%"kind":"whiteboard_agent_session"%'
      LIMIT 5
    `).all();
    const results = [];
    for (const row of due) {
      try {
        let meta = {}; try { meta = JSON.parse(row.meta_json || "{}"); } catch { meta = {}; }
        const boardId = meta.boardId;
        const history = Array.isArray(meta.history) ? meta.history : [];
        db.prepare(`UPDATE agent_marathon_sessions SET status = 'running', updated_at = unixepoch() WHERE id = ?`).run(row.id);
        const stepCtx = { ...ctx, actor: { userId: row.user_id } };
        const step = await runAgentStep({ ctx: stepCtx, boardId, task: row.goal, sessionId: row.id, history });
        const turn = row.total_turns + 1;
        history.push({ turn, toolCalled: step.toolCalled, observation: step.observation, ok: !!step.ok });
        meta.history = history.slice(-20); // bound for token budget
        meta.lastStep = step;
        db.prepare(`
          INSERT INTO agent_marathon_turns (session_id, turn_index, role, content, artifacts_json, created_at)
          VALUES (?, ?, 'tool', ?, ?, unixepoch())
        `).run(row.id, turn, JSON.stringify({ tool: step.toolCalled, observation: step.observation }).slice(0, 4000), JSON.stringify(step).slice(0, 16_000));
        const reachedMax = turn >= row.max_turns;
        const newStatus = step.done || reachedMax ? "completed" : (step.ok ? "running" : "failed");
        const nextTick = ["completed", "failed", "abandoned"].includes(newStatus) ? 999_999_999 : Math.floor(Date.now() / 1000) + 30;
        db.prepare(`
          UPDATE agent_marathon_sessions
          SET total_turns = ?, status = ?, updated_at = unixepoch(),
              completed_at = CASE WHEN ? IS NOT NULL THEN unixepoch() ELSE completed_at END,
              next_tick_at = ?,
              meta_json = ?
          WHERE id = ?
        `).run(turn, newStatus, newStatus === "completed" || newStatus === "failed" ? 1 : null, nextTick, JSON.stringify(meta), row.id);
        results.push({ sessionId: row.id, toolCalled: step.toolCalled, status: newStatus });
      } catch (err) {
        try { db.prepare(`UPDATE agent_marathon_sessions SET status = 'failed', updated_at = unixepoch() WHERE id = ?`).run(row.id); }
        catch { /* ignore */ }
        results.push({ sessionId: row.id, error: err?.message });
      }
    }
    return { ok: true, advanced: results.length, results };
  }, { destructive: true, note: "Advance one step per due whiteboard agent (heartbeat dispatcher)" });
}
