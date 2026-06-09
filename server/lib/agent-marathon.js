// server/lib/agent-marathon.js
//
// Sprint 12 — long-running marathon agent sessions.
//
// Marathon sessions persist across requests/restarts. Each call to
// `tickMarathon` advances the session by N turns (default 5) using
// the same brainChat() + tool loop as chat_agent.do, then returns
// the updated state. A heartbeat module auto-ticks running sessions
// so they make progress even when the user closes the tab.
//
// Tools available in marathon mode = SAME tools as chat_agent.do
// (web_search, run_compute, browse_url, run_lens_action, create_dtu,
// expert_mode, generate_image, mcp_call, mcp_list).
//
// Termination: the brain ends a session by emitting [TASK_COMPLETE]
// or [TASK_BLOCKED: reason] markers in its final reply. The session
// flips status to 'completed' or 'paused' respectively. max_turns
// is a hard ceiling (default 200).

import crypto from "node:crypto";
import { runAgentLoop } from "./chat-agent.js";

const DEFAULT_TICK_TURNS = 5;
const DEFAULT_MAX_TURNS = 200;
const DEFAULT_TICK_INTERVAL_S = 60; // 1 min between auto-ticks for running sessions

const COMPLETE_MARKER = /\[TASK_COMPLETE\]/i;
const BLOCKED_MARKER = /\[TASK_BLOCKED:\s*([^\]]*)\]/i;

export function startMarathon(db, userId, opts = {}) {
  if (!db || !userId) return { ok: false, reason: "missing_inputs" };
  const { goal, title, maxTurns } = opts || {};
  if (!goal) return { ok: false, reason: "missing_goal" };
  const id = `mar_${crypto.randomUUID().slice(0, 16)}`;
  db.prepare(`
    INSERT INTO agent_marathon_sessions
      (id, user_id, title, goal, status, max_turns)
    VALUES (?, ?, ?, ?, 'pending', ?)
  `).run(id, userId, title || goal.slice(0, 80), goal, Math.min(2000, maxTurns || DEFAULT_MAX_TURNS));
  // Seed the user-goal turn so resume sees it.
  db.prepare(`
    INSERT INTO agent_marathon_turns
      (session_id, turn_index, role, content)
    VALUES (?, 0, 'user', ?)
  `).run(id, goal);
  return { ok: true, sessionId: id };
}

export function listMarathons(db, userId, opts = {}) {
  if (!db || !userId) return [];
  try {
    return db.prepare(`
      SELECT id, title, goal, status, total_turns, max_turns, created_at, updated_at, completed_at
      FROM agent_marathon_sessions
      WHERE user_id = ?
      ${opts.status ? "AND status = ?" : ""}
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(...(opts.status ? [userId, opts.status, opts.limit || 50] : [userId, opts.limit || 50]));
  } catch {
    return [];
  }
}

export function getMarathon(db, sessionId) {
  if (!db || !sessionId) return null;
  try {
    const session = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(sessionId);
    if (!session) return null;
    const turns = db.prepare(`
      SELECT turn_index, role, content, tool_calls_json, artifacts_json, provider, model, created_at
      FROM agent_marathon_turns
      WHERE session_id = ?
      ORDER BY turn_index ASC
    `).all(sessionId);
    return {
      ...session,
      turns: turns.map(t => ({
        ...t,
        tool_calls: t.tool_calls_json ? safeParse(t.tool_calls_json) : [],
        artifacts: t.artifacts_json ? safeParse(t.artifacts_json) : [],
      })),
    };
  } catch {
    return null;
  }
}

/**
 * Advance a marathon session by up to `tickTurns` brain turns.
 *
 * @param {object} args
 * @param {object} args.db
 * @param {string} args.sessionId
 * @param {Function} args.runMacro
 * @param {Map} args.lensActions
 * @param {object} [args.opts]
 * @returns {Promise<{ok, status, newTurns, totalTurns, error?}>}
 */
export async function tickMarathon({ db, sessionId, runMacro, lensActions, opts = {} }) {
  if (!db || !sessionId) return { ok: false, reason: "missing_inputs" };
  const session = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id = ?`).get(sessionId);
  if (!session) return { ok: false, reason: "session_not_found" };
  if (["completed", "abandoned", "failed"].includes(session.status)) {
    return { ok: true, alreadyTerminal: true, status: session.status };
  }
  if (session.total_turns >= session.max_turns) {
    db.prepare(`UPDATE agent_marathon_sessions SET status = 'failed', updated_at = unixepoch() WHERE id = ?`).run(sessionId);
    return { ok: true, status: "failed", reason: "max_turns_exceeded" };
  }

  // Wave 7 / Track B4 — "feeling decides when to think". If the caller supplies the
  // agent's live self-state (opts.salienceGate), only spend an expensive deliberation
  // turn on a tier-3 wake (a real dilemma / affect spike / human contact); otherwise the
  // agent stays on cheap instinct/routine this tick. Opt-in + reversible
  // (CONCORD_AFFECT_SALIENCE=0) — absent gate → always deliberate (prior behaviour).
  if (opts.salienceGate && process.env.CONCORD_AFFECT_SALIENCE !== "0") {
    try {
      const { decideDeliberation } = await import("./agent-brain-loop.js");
      const g = opts.salienceGate;
      const d = decideDeliberation(g.self, g.world, g.others, g.prior, g.opts);
      if (!d.deliberate) {
        return { ok: true, deliberated: false, reason: `instinct:${d.reason}`, tier: d.tier };
      }
    } catch { /* gate optional → fall through and deliberate */ }
  }

  // Wave 7 / Track B6 — this IS a tier-3 wake (we got past the gate, so the agent is
  // deliberating). Run the awareness loop ONCE: attend → read self-model + interoception
  // → predict-error → write a durable reasoning trace + the awareness-index sample.
  // Env-gated CONCORD_AWARENESS_LOOP; never throws; purely additive to the deliberation.
  if (opts.salienceGate && process.env.CONCORD_AWARENESS_LOOP === "1") {
    try {
      const { runAwarenessLoop } = await import("./awareness-loop.js");
      const g = opts.salienceGate;
      runAwarenessLoop({ force: true, db, agentId: g.agentId || session.user_id, self: g.self, world: g.world, others: g.others, prior: g.prior, system: g.system, prediction: g.prediction, actual: g.actual });
    } catch { /* awareness loop is best-effort — never blocks the marathon */ }
  }

  // Mark running.
  db.prepare(`UPDATE agent_marathon_sessions SET status = 'running', updated_at = unixepoch() WHERE id = ?`).run(sessionId);

  // Build history from prior turns.
  const priorTurns = db.prepare(`
    SELECT role, content FROM agent_marathon_turns
    WHERE session_id = ? AND role IN ('user','assistant')
    ORDER BY turn_index ASC
  `).all(sessionId);

  // The first user-turn is the goal; subsequent are tool-result responses.
  const history = priorTurns.slice(0, -1).map(t => ({ role: t.role, content: t.content }));
  const lastMessage = priorTurns[priorTurns.length - 1]?.content || session.goal;

  const tickTurns = Math.min(opts.tickTurns || DEFAULT_TICK_TURNS, session.max_turns - session.total_turns);

  const result = await runAgentLoop({
    db,
    userId: session.user_id,
    message: lastMessage,
    runMacro,
    lensActions,
    history,
    opts: { maxTurns: tickTurns, slot: opts.slot, sessionId },
  });

  if (!result.ok) {
    db.prepare(`UPDATE agent_marathon_sessions SET status = 'paused', updated_at = unixepoch() WHERE id = ?`).run(sessionId);
    return { ok: false, status: "paused", error: result.error };
  }

  // Persist the new assistant turn (or any tool-call turns the loop emitted).
  let nextTurnIndex = session.total_turns + 1;
  db.prepare(`
    INSERT INTO agent_marathon_turns
      (session_id, turn_index, role, content, tool_calls_json, artifacts_json, provider, model)
    VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)
  `).run(
    sessionId, nextTurnIndex,
    result.answer || "",
    JSON.stringify(result.toolCalls || []),
    JSON.stringify(result.artifacts || []),
    result.provider || null,
    result.model || null,
  );
  nextTurnIndex++;

  const totalTurns = session.total_turns + result.turns;

  // Check for termination markers.
  let nextStatus = "running";
  if (COMPLETE_MARKER.test(result.answer || "")) {
    nextStatus = "completed";
  } else if (BLOCKED_MARKER.test(result.answer || "")) {
    nextStatus = "paused";
  }

  const nextTickAt = nextStatus === "running"
    ? Math.floor(Date.now() / 1000) + (opts.tickIntervalS || DEFAULT_TICK_INTERVAL_S)
    : Math.floor(Date.now() / 1000);

  db.prepare(`
    UPDATE agent_marathon_sessions
    SET total_turns = ?, status = ?, updated_at = unixepoch(),
        completed_at = CASE WHEN ? = 'completed' THEN unixepoch() ELSE completed_at END,
        next_tick_at = ?
    WHERE id = ?
  `).run(totalTurns, nextStatus, nextStatus, nextTickAt, sessionId);

  // Sprint 13 — terminal-status hooks. When a marathon completes or
  // gets blocked, fire an initiative engine event so the user's bell
  // lights up ("your marathon refactor is done" / "I'm blocked on X").
  // Best-effort; the marathon itself succeeds whether or not the
  // initiative engine is wired.
  if (nextStatus === "completed" || nextStatus === "paused") {
    try {
      const re = globalThis._concordRealtimeEmit;
      if (typeof re === "function") {
        re("marathon:status", {
          actor_kind: "marathon",
          actor_id: sessionId,
          session_id: sessionId,
          user_id: session.user_id,
          status: nextStatus,
          total_turns: totalTurns,
          title: session.title,
        });
      }
      // Direct insert into initiative engine table if present — the
      // bell polls /api/initiative/pending which reads from there.
      const trigger = nextStatus === "completed" ? "pending_work" : "reflective_followup";
      const msg = nextStatus === "completed"
        ? `Marathon complete: "${session.title}" finished after ${totalTurns} turns.`
        : `Marathon paused: "${session.title}" hit a block at turn ${totalTurns}. Reason in the answer body.`;
      try {
        const initId = `init_mar_${sessionId.slice(4, 16)}_${Date.now().toString(36)}`;
        db.prepare(`
          INSERT INTO initiatives (id, user_id, trigger_type, priority, message, status, created_at)
          VALUES (?, ?, ?, 'normal', ?, 'pending', unixepoch())
        `).run(initId, session.user_id, trigger, msg);
      } catch { /* initiatives table optional in test setups */ }
    } catch { /* never block on telemetry */ }
  }

  return {
    ok: true,
    sessionId,
    status: nextStatus,
    newTurns: result.turns,
    totalTurns,
    answer: result.answer,
    toolCalls: result.toolCalls,
    artifacts: result.artifacts,
    provider: result.provider,
    model: result.model,
  };
}

/** Find sessions that should auto-tick (status='running' AND next_tick_at <= now). */
export function findDueMarathons(db, opts = {}) {
  if (!db) return [];
  const limit = Math.min(20, opts.limit || 5);
  try {
    return db.prepare(`
      SELECT id FROM agent_marathon_sessions
      WHERE status = 'running' AND next_tick_at <= unixepoch()
      ORDER BY next_tick_at ASC
      LIMIT ?
    `).all(limit);
  } catch {
    return [];
  }
}

export function pauseMarathon(db, sessionId) {
  if (!db || !sessionId) return { ok: false, reason: "missing_inputs" };
  db.prepare(`UPDATE agent_marathon_sessions SET status = 'paused', updated_at = unixepoch() WHERE id = ?`).run(sessionId);
  return { ok: true };
}

export function abandonMarathon(db, sessionId) {
  if (!db || !sessionId) return { ok: false, reason: "missing_inputs" };
  db.prepare(`UPDATE agent_marathon_sessions SET status = 'abandoned', updated_at = unixepoch() WHERE id = ?`).run(sessionId);
  return { ok: true };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return []; }
}

export const MARATHON_CONSTANTS = Object.freeze({
  DEFAULT_TICK_TURNS, DEFAULT_MAX_TURNS, DEFAULT_TICK_INTERVAL_S,
});
