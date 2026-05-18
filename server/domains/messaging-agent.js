// server/domains/messaging-agent.js
//
// Sprint C #24 — channel-bound agent macros. Reuses agent_marathon_
// sessions (migration 171) for session state + heartbeat tick pattern
// from the whiteboard canvas-agent (which mirrors the code lens
// background agent). Publishable as kind='agent_spec' via Phase 13.

import { randomUUID } from "node:crypto";
import { runChannelAgentStep } from "../lib/messaging/channel-agent.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

export default function registerMessagingAgentMacros(register) {
  register("messaging", "agent_start", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = String(input.conversationId || "");
    const task = String(input.task || "").trim();
    if (!conversationId || !task) return { ok: false, reason: "conversationId_and_task_required" };
    const maxSteps = Math.min(15, Math.max(1, Number(input.maxSteps) || 6));
    const id = `msg_agent:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO agent_marathon_sessions (id, user_id, title, goal, status, max_turns, meta_json, next_tick_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, unixepoch())
      `).run(id, userId, task.slice(0, 200), task, maxSteps, JSON.stringify({
        kind: "channel_agent_session", conversationId, history: [],
      }));
      try {
        globalThis._concordREALTIME?.io?.to(`conversation:${conversationId}`).emit("messaging:agent-start", {
          conversationId, sessionId: id, userId, task, ts: Date.now(),
        });
      } catch { /* best effort */ }
      return { ok: true, sessionId: id, conversationId, maxSteps };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Start a channel-bound agent (heartbeat frequency 4 = ~1min/step)" });

  register("messaging", "agent_status", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const id = String(input.sessionId || input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    let meta = {}; try { meta = JSON.parse(row.meta_json || "{}"); } catch { /* ok */ }
    const turns = db.prepare(`SELECT turn_index, role, content, created_at FROM agent_marathon_turns WHERE session_id = ? ORDER BY turn_index ASC LIMIT 100`).all(id);
    return { ok: true, session: { ...row, meta }, turns };
  }, { note: "Read a channel agent session + its turn log" });

  register("messaging", "agent_cancel", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.sessionId || input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const r = db.prepare(`UPDATE agent_marathon_sessions SET status = 'abandoned', completed_at = unixepoch() WHERE id = ? AND user_id = ? AND status IN ('pending','running','paused')`).run(id, userId);
    return { ok: true, cancelled: r.changes };
  }, { destructive: true, note: "Cancel a running channel agent" });

  register("messaging", "agent_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const conversationId = input.conversationId ? String(input.conversationId) : null;
    const sql = conversationId
      ? `SELECT id, title, goal, status, total_turns, max_turns, created_at FROM agent_marathon_sessions WHERE user_id = ? AND meta_json LIKE '%"kind":"channel_agent_session"%' AND meta_json LIKE ? ORDER BY created_at DESC LIMIT 50`
      : `SELECT id, title, goal, status, total_turns, max_turns, created_at FROM agent_marathon_sessions WHERE user_id = ? AND meta_json LIKE '%"kind":"channel_agent_session"%' ORDER BY created_at DESC LIMIT 50`;
    const rows = conversationId
      ? db.prepare(sql).all(userId, `%"conversationId":"${conversationId}"%`)
      : db.prepare(sql).all(userId);
    return { ok: true, sessions: rows };
  }, { note: "List the caller's channel agent sessions (optionally scoped)" });

  register("messaging", "agent_publish", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.sessionId || input.id || "");
    const priceCents = Math.max(0, Math.min(10000, Number(input.priceCents) || 0));
    const license = String(input.license || "proprietary");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ? AND user_id = ?`).get(id, userId);
    if (!row) return { ok: false, reason: "not_found" };
    let meta = {}; try { meta = JSON.parse(row.meta_json || "{}"); } catch { /* ok */ }
    const agentSpecId = `agent_spec:${randomUUID()}`;
    const spec = {
      type: "agent_spec",
      title: row.title,
      origin_session_id: row.id,
      capabilities: [
        { domain: "_llm", macros: [] },
        { domain: "messaging", macros: ["msg_post", "msg_react", "msg_list"] },
      ],
      consent: { allowCitations: true },
      price_cents: priceCents, license,
    };
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
        VALUES (?, 'agent_spec', ?, ?, ?, 1, 0, unixepoch())
      `).run(agentSpecId, `Channel agent · ${row.title}`.slice(0, 200), userId, JSON.stringify(spec));
      return { ok: true, agentSpecDtuId: agentSpecId, priceCents, license };
    } catch (err) {
      return { ok: false, reason: "publish_failed", error: err?.message };
    }
  }, { destructive: true, note: "Publish a channel agent as kind='agent_spec' for the Phase 13 marketplace" });

  // Heartbeat-driven step tick.
  register("messaging", "agent_tick", async (ctx) => {
    const db = _resolveDb(ctx);
    if (!db) return { ok: false, reason: "no_db" };
    const due = db.prepare(`
      SELECT id, user_id, goal, total_turns, max_turns, meta_json
      FROM agent_marathon_sessions
      WHERE status IN ('pending','running')
        AND next_tick_at <= unixepoch()
        AND meta_json LIKE '%"kind":"channel_agent_session"%'
      LIMIT 5
    `).all();
    const results = [];
    for (const row of due) {
      try {
        let meta = {}; try { meta = JSON.parse(row.meta_json || "{}"); } catch { meta = {}; }
        const conversationId = meta.conversationId;
        const history = Array.isArray(meta.history) ? meta.history : [];
        db.prepare(`UPDATE agent_marathon_sessions SET status = 'running', updated_at = unixepoch() WHERE id = ?`).run(row.id);
        const stepCtx = { ...ctx, actor: { userId: row.user_id } };
        const step = await runChannelAgentStep({ ctx: stepCtx, conversationId, task: row.goal, sessionId: row.id, history });
        const turn = row.total_turns + 1;
        history.push({ turn, toolCalled: step.toolCalled, observation: step.observation, ok: !!step.ok });
        meta.history = history.slice(-20);
        meta.lastStep = step;
        db.prepare(`
          INSERT INTO agent_marathon_turns (session_id, turn_index, role, content, artifacts_json, created_at)
          VALUES (?, ?, 'tool', ?, ?, unixepoch())
        `).run(row.id, turn, JSON.stringify({ tool: step.toolCalled, observation: step.observation }).slice(0, 4000), JSON.stringify(step).slice(0, 16_000));
        const reachedMax = turn >= row.max_turns;
        const newStatus = step.done || reachedMax ? "completed" : (step.ok ? "running" : "failed");
        const nextTick = ["completed", "failed", "abandoned"].includes(newStatus) ? 999_999_999 : Math.floor(Date.now() / 1000) + 60;
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
  }, { destructive: true, note: "Advance one step per due channel agent (heartbeat dispatcher)" });
}
