// server/domains/code-background.js
//
// Code Sprint C Item #11 — async background coding agents.
//
// Matches Cursor 3 Agents Window + Zed Parallel Agents + OpenAI
// Codex cloud's flagship "fire-and-forget refactor running in the
// background while you work on other things" UX.
//
// Implementation: reuses the existing agent_marathon_sessions
// schema (migration 171) for state + turn log. A heartbeat
// drives one step per tick at frequency 4 (~1 min). Each step
// calls the existing code.agent_loop with maxIterations=1, so a
// 5-step background agent = 5 inner edit→test→fix cycles spread
// across ~5 minutes.
//
// Published as kind='agent_spec' DTUs via the existing Phase 13
// marketplace so other devs hire your background coder.

import { randomUUID } from "node:crypto";

function _runMacro(ctx, domain, name, input) {
  if (typeof ctx?.runMacro === "function") return ctx.runMacro(domain, name, input);
  if (typeof globalThis._concordRunMacro === "function") {
    return globalThis._concordRunMacro(domain, name, input, ctx);
  }
  throw new Error("no_macro_dispatcher");
}

function _ensureBgState(STATE) {
  if (!STATE) return null;
  if (!STATE._codeBgAgents) STATE._codeBgAgents = { running: new Set(), lastTick: 0 };
  return STATE._codeBgAgents;
}

function _emitRealtime(event, payload) {
  try {
    const io = globalThis._concordREALTIME?.io;
    if (io) io.emit(event, payload);
  } catch { /* best effort */ }
}

export default function registerCodeBackgroundMacros(register) {
  register("code", "bg_start", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const task = String(input.task || "").trim();
    if (!task) return { ok: false, reason: "task_required" };
    const projectPath = String(input.projectPath || input.project_path || "");
    if (!projectPath) return { ok: false, reason: "project_path_required" };
    const files = Array.isArray(input.files) ? input.files : [];
    const runner = String(input.runner || "npm");
    const runnerArgs = Array.isArray(input.runnerArgs) ? input.runnerArgs : ["test"];
    const maxSteps = Math.min(20, Math.max(1, Number(input.maxSteps) || 5));
    const id = `code_bg:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO agent_marathon_sessions (id, user_id, title, goal, status, max_turns, meta_json, next_tick_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, unixepoch())
      `).run(
        id, userId,
        task.slice(0, 200), task, maxSteps,
        JSON.stringify({
          kind: "code_bg", projectPath, files, runner, runnerArgs,
          stepDtuIds: [], lastVerdict: null,
        }),
      );
      _emitRealtime("code:bg:started", { sessionId: id, userId, task });
      return { ok: true, sessionId: id, status: "pending", maxSteps };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Start a background coding agent (runs one step per heartbeat tick)" });

  register("code", "bg_status", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const id = String(input.sessionId || input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    let meta = {};
    try { meta = JSON.parse(row.meta_json || "{}"); } catch { /* ok */ }
    const turns = db.prepare(`SELECT turn_index, role, content, created_at FROM agent_marathon_turns WHERE session_id = ? ORDER BY turn_index ASC LIMIT 100`).all(id);
    return { ok: true, session: { ...row, meta }, turns };
  }, { note: "Read a background agent's current status + turn log" });

  register("code", "bg_list", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const status = input.status ? String(input.status) : null;
    const sql = status
      ? `SELECT id, title, goal, status, total_turns, max_turns, created_at, updated_at FROM agent_marathon_sessions WHERE user_id = ? AND status = ? AND meta_json LIKE '%"kind":"code_bg"%' ORDER BY created_at DESC LIMIT 50`
      : `SELECT id, title, goal, status, total_turns, max_turns, created_at, updated_at FROM agent_marathon_sessions WHERE user_id = ? AND meta_json LIKE '%"kind":"code_bg"%' ORDER BY created_at DESC LIMIT 50`;
    const rows = status ? db.prepare(sql).all(userId, status) : db.prepare(sql).all(userId);
    return { ok: true, sessions: rows };
  }, { note: "List background code agents owned by the caller" });

  register("code", "bg_cancel", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.sessionId || input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const r = db.prepare(`UPDATE agent_marathon_sessions SET status = 'abandoned', completed_at = unixepoch() WHERE id = ? AND user_id = ? AND status IN ('pending','running','paused')`).run(id, userId);
    if (r.changes === 0) return { ok: false, reason: "not_found_or_terminal" };
    _emitRealtime("code:bg:cancelled", { sessionId: id });
    return { ok: true, sessionId: id };
  }, { destructive: true, note: "Cancel a running background agent" });

  register("code", "bg_publish", async (ctx, input = {}) => {
    const db = ctx?.db || ctx?.STATE?.db;
    const userId = ctx?.actor?.userId || ctx?.userId;
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.sessionId || input.id || "");
    const priceCents = Math.max(0, Math.min(10000, Number(input.priceCents) || 0));
    const license = String(input.license || "proprietary");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ? AND user_id = ?`).get(id, userId);
    if (!row) return { ok: false, reason: "not_found" };
    let meta = {};
    try { meta = JSON.parse(row.meta_json || "{}"); } catch { /* ok */ }
    const agentSpecId = `agent_spec:${randomUUID()}`;
    const spec = {
      type: "agent_spec",
      title: row.title,
      origin_session_id: row.id,
      capabilities: [
        { domain: "_llm", macros: [] },
        { domain: "code", macros: ["agent_loop", "run_tests", "git_commit", "git_diff", "git_status"] },
      ],
      runner: meta.runner, runnerArgs: meta.runnerArgs,
      price_cents: priceCents, license,
      consent: { allowCitations: true },
    };
    try {
      db.prepare(`
        INSERT INTO dtus (id, kind, title, creator_id, meta_json, skill_level, total_experience, created_at)
        VALUES (?, 'agent_spec', ?, ?, ?, 1, 0, unixepoch())
      `).run(agentSpecId, `Background coder · ${row.title}`.slice(0, 200), userId, JSON.stringify(spec));
      return { ok: true, agentSpecDtuId: agentSpecId, priceCents, license };
    } catch (err) {
      return { ok: false, reason: "publish_failed", error: err?.message };
    }
  }, { destructive: true, note: "Publish a background agent as kind='agent_spec' for the Phase 13 marketplace" });

  // Heartbeat tick — advance one step per due session. Try/catch
  // isolated per session; never crashes the dispatcher.
  register("code", "bg_tick", async (ctx) => {
    const db = ctx?.db || ctx?.STATE?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const due = db.prepare(`
      SELECT id, user_id, goal, total_turns, max_turns, meta_json
      FROM agent_marathon_sessions
      WHERE status IN ('pending','running')
        AND next_tick_at <= unixepoch()
        AND meta_json LIKE '%"kind":"code_bg"%'
      LIMIT 5
    `).all();
    const STATE = ctx?.STATE;
    const bgState = _ensureBgState(STATE);
    const results = [];
    for (const row of due) {
      if (bgState?.running.has(row.id)) continue;
      bgState?.running.add(row.id);
      try {
        let meta = {};
        try { meta = JSON.parse(row.meta_json || "{}"); } catch { /* ok */ }
        db.prepare(`UPDATE agent_marathon_sessions SET status = 'running', updated_at = unixepoch() WHERE id = ?`).run(row.id);
        _emitRealtime("code:bg:step_start", { sessionId: row.id, turn: row.total_turns + 1 });
        // One step = one agent_loop iteration.
        const stepCtx = { ...ctx, actor: { userId: row.user_id } };
        const loopRes = await _runMacro(stepCtx, "code", "agent_loop", {
          task: row.goal,
          files: meta.files || [],
          projectPath: meta.projectPath,
          runner: meta.runner || "npm",
          runnerArgs: meta.runnerArgs || ["test"],
          maxIterations: 1,
        });
        const verdict = loopRes?.verdict || (loopRes?.ok ? "no_op" : "error");
        const newTotal = row.total_turns + 1;
        const stepDtuIds = Array.isArray(meta.stepDtuIds) ? meta.stepDtuIds.slice() : [];
        if (loopRes?.sessionId) stepDtuIds.push(loopRes.sessionId);
        meta.stepDtuIds = stepDtuIds;
        meta.lastVerdict = verdict;
        db.prepare(`
          INSERT INTO agent_marathon_turns (session_id, turn_index, role, content, artifacts_json, created_at)
          VALUES (?, ?, 'tool', ?, ?, unixepoch())
        `).run(row.id, newTotal, JSON.stringify({ verdict, loopOk: !!loopRes?.ok, reason: loopRes?.reason }).slice(0, 4000), JSON.stringify({ loopResult: loopRes }).slice(0, 16_000));
        const reachedMax = newTotal >= row.max_turns;
        const passed = verdict === "pass";
        const newStatus = reachedMax || passed ? "completed" : "running";
        const nextTick = newStatus === "completed" ? null : Math.floor(Date.now() / 1000) + 60;
        db.prepare(`
          UPDATE agent_marathon_sessions
          SET total_turns = ?, status = ?, updated_at = unixepoch(),
              completed_at = CASE WHEN ? IS NOT NULL THEN unixepoch() ELSE completed_at END,
              next_tick_at = COALESCE(?, next_tick_at),
              meta_json = ?
          WHERE id = ?
        `).run(
          newTotal, newStatus, newStatus === "completed" ? 1 : null, nextTick,
          JSON.stringify(meta), row.id,
        );
        _emitRealtime("code:bg:step_done", { sessionId: row.id, turn: newTotal, verdict, status: newStatus });
        results.push({ sessionId: row.id, verdict, status: newStatus });
      } catch (err) {
        try {
          db.prepare(`
            UPDATE agent_marathon_sessions SET status = 'failed', completed_at = unixepoch(),
              updated_at = unixepoch(), meta_json = json_set(COALESCE(meta_json,'{}'), '$.lastError', ?)
            WHERE id = ?
          `).run(String(err?.message || err).slice(0, 500), row.id);
        } catch { /* DB might not support json_set fallback */ }
        results.push({ sessionId: row.id, verdict: "error", error: err?.message });
      } finally {
        bgState?.running.delete(row.id);
      }
    }
    return { ok: true, advanced: results.length, results };
  }, { destructive: true, note: "Advance one step per due background agent — invoked by the heartbeat dispatcher" });
}
